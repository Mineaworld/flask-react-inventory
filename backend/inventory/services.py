"""Transactional inventory workflows kept separate from HTTP route handling."""

from __future__ import annotations

from collections.abc import Iterable, Mapping
from datetime import date, datetime, time, timedelta, timezone
from decimal import InvalidOperation, ROUND_HALF_UP, Decimal, localcontext
import re
from typing import Any, TypeVar
from uuid import uuid4
from zoneinfo import ZoneInfo

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import selectinload

from inventory.api_helpers import ApiProblem, decimal_value, optional_text, positive_int, required_text
from inventory.extensions import db
from inventory.models import (
    Category,
    Currency,
    Customer,
    EXCHANGE_RATE,
    MONEY,
    Product,
    Purchase,
    PurchaseItem,
    PurchaseStatus,
    Role,
    Sale,
    SaleItem,
    SaleStatus,
    StockBalance,
    StockMovement,
    StockMovementType,
    Supplier,
    QUANTITY,
    USD_VALUE,
    User,
    utc_now,
)


Model = TypeVar("Model")
CAMBODIA_TIME_ZONE = ZoneInfo("Asia/Phnom_Penh")


def _utc_datetime(value: datetime) -> datetime:
    return value if value.tzinfo is not None else value.replace(tzinfo=timezone.utc)


def cambodia_period_bounds(period_days: int, now: datetime | None = None) -> tuple[date, datetime, datetime]:
    current = _utc_datetime(now or utc_now())
    today = current.astimezone(CAMBODIA_TIME_ZONE).date()
    start_date = today - timedelta(days=period_days - 1)
    start_local = datetime.combine(start_date, time.min, tzinfo=CAMBODIA_TIME_ZONE)
    end_local = datetime.combine(today + timedelta(days=1), time.min, tzinfo=CAMBODIA_TIME_ZONE)
    return today, start_local.astimezone(timezone.utc), end_local.astimezone(timezone.utc)


def _cambodia_date(value: datetime) -> date:
    return _utc_datetime(value).astimezone(CAMBODIA_TIME_ZONE).date()


def _commit() -> None:
    """Commit one workflow and convert database validation into a public error."""
    try:
        db.session.commit()
    except IntegrityError as error:
        db.session.rollback()
        raise ApiProblem("validation_error", "The request conflicts with existing data.") from error


def _get(model: type[Model], entity_id: int, label: str) -> Model:
    entity = db.session.get(model, entity_id)
    if entity is None:
        raise ApiProblem("not_found", f"{label} was not found.", 404)
    return entity


def _get_active(model: type[Model], entity_id: int, label: str, field: str) -> Model:
    """Resolve a master-data record that can still be used in a new document."""
    entity = _get(model, entity_id, label)
    if not getattr(entity, "is_active", True):
        raise ApiProblem(
            "validation_error",
            "Request validation failed.",
            fields={field: f"{label} is archived."},
        )
    return entity


def _optional_bool(payload: Mapping[str, Any], field: str, default: bool | None = None) -> bool | None:
    if field not in payload:
        return default
    value = payload[field]
    if not isinstance(value, bool):
        raise ApiProblem("validation_error", "Request validation failed.", fields={field: "Must be true or false."})
    return value


def _normalise_currency(payload: Mapping[str, Any]) -> tuple[Currency, Decimal]:
    raw_currency = payload.get("currency")
    try:
        currency = Currency(raw_currency)
    except (TypeError, ValueError):
        raise ApiProblem("validation_error", "Request validation failed.", fields={"currency": "Must be USD or KHR."}) from None
    rate = _column_decimal(
        payload.get("exchange_rate_to_usd"), "exchange_rate_to_usd", EXCHANGE_RATE, positive=True
    )
    if currency is Currency.USD and rate != Decimal("1"):
        raise ApiProblem(
            "validation_error",
            "Request validation failed.",
            fields={"exchange_rate_to_usd": "USD exchange rate must be exactly 1."},
        )
    return currency, rate


def _column_decimal(
    value: Any,
    field: str,
    column: Any,
    *,
    positive: bool = False,
    nonnegative: bool = False,
) -> Decimal:
    """Validate a client value against the precision and scale of its model column."""
    return decimal_value(
        value,
        field,
        positive=positive,
        nonnegative=nonnegative,
        precision=column.precision,
        scale=column.scale,
    )


def _calculated_decimal(value: Decimal, field: str, column: Any) -> Decimal:
    """Round a derived amount once, then prove it still fits the destination column."""
    maximum_integer_digits = column.precision - column.scale
    if not value.is_finite() or value < 0 or (value and value.adjusted() + 1 > maximum_integer_digits):
        raise ApiProblem(
            "validation_error",
            "Request validation failed.",
            fields={field: f"Must fit DECIMAL({column.precision}, {column.scale})."},
        )
    try:
        # Derived multiplication can exceed Python's default Decimal precision before storage validation.
        with localcontext() as context:
            context.prec = max(64, value.adjusted() + 1 + column.scale + 1 if value else column.scale + 1)
            rounded = value.quantize(Decimal(1).scaleb(-column.scale), rounding=ROUND_HALF_UP)
    except InvalidOperation:
        raise ApiProblem(
            "validation_error",
            "Request validation failed.",
            fields={field: f"Must fit DECIMAL({column.precision}, {column.scale})."},
        ) from None
    return _column_decimal(rounded, field, column, nonnegative=True)


def _calculation_precision(*values: Decimal) -> int:
    """Keep intermediate arithmetic exact for all currently supported DECIMAL columns."""
    return max(64, sum(len(value.as_tuple().digits) for value in values) + 8)


def _calculated_product(left: Decimal, right: Decimal, field: str, column: Any) -> Decimal:
    with localcontext() as context:
        context.prec = _calculation_precision(left, right)
        result = left * right
    return _calculated_decimal(result, field, column)


def _calculated_quotient(numerator: Decimal, denominator: Decimal, field: str, column: Any) -> Decimal:
    with localcontext() as context:
        context.prec = _calculation_precision(numerator, denominator)
        result = numerator / denominator
    return _calculated_decimal(result, field, column)


def _calculated_total(values: Iterable[Decimal], field: str, column: Any) -> Decimal:
    amounts = list(values)
    with localcontext() as context:
        context.prec = _calculation_precision(*amounts) if amounts else 64
        result = sum(amounts, Decimal("0"))
    return _calculated_decimal(result, field, column)


def _quantized_product_total(factors: Iterable[tuple[Decimal, Decimal]], scale: int) -> Decimal:
    """Sum products exactly enough for an aggregate that is not persisted in a column."""
    pairs = list(factors)
    operands = [value for pair in pairs for value in pair]
    with localcontext() as context:
        context.prec = _calculation_precision(*operands) if operands else 64
        total = sum((left * right for left, right in pairs), Decimal("0"))
        return total.quantize(Decimal(1).scaleb(-scale), rounding=ROUND_HALF_UP)


def _line_items(payload: Mapping[str, Any], field_name: str, rate: Decimal, document: str) -> list[PurchaseItem | SaleItem]:
    raw_items = payload.get("items")
    if not isinstance(raw_items, list) or not raw_items:
        raise ApiProblem("validation_error", "Request validation failed.", fields={"items": "At least one line item is required."})
    product_ids: set[int] = set()
    items: list[PurchaseItem | SaleItem] = []
    for index, raw_item in enumerate(raw_items):
        if not isinstance(raw_item, Mapping):
            raise ApiProblem("validation_error", "Request validation failed.", fields={f"items.{index}": "Must be an object."})
        product_id = positive_int(raw_item.get("product_id"), f"items.{index}.product_id")
        if product_id in product_ids:
            raise ApiProblem("validation_error", "Request validation failed.", fields={"items": "Products may appear only once per document."})
        product_ids.add(product_id)
        product = _get_active(Product, product_id, "Product", f"items.{index}.product_id")
        value_field = f"items.{index}.{field_name}"
        quantity = _column_decimal(raw_item.get("quantity"), f"items.{index}.quantity", QUANTITY, positive=True)
        unit_amount = _column_decimal(raw_item.get(field_name), value_field, MONEY, nonnegative=True)
        unit_usd = _calculated_quotient(unit_amount, rate, value_field, USD_VALUE)
        line_total = _calculated_product(quantity, unit_amount, value_field, MONEY)
        line_total_usd = _calculated_product(quantity, unit_usd, value_field, USD_VALUE)
        if document == "purchase":
            items.append(
                PurchaseItem(
                    product=product,
                    quantity=quantity,
                    unit_price=unit_amount,
                    unit_price_usd=unit_usd,
                    line_total=line_total,
                    line_total_usd=line_total_usd,
                )
            )
        else:
            items.append(
                SaleItem(
                    product=product,
                    quantity=quantity,
                    unit_price=unit_amount,
                    unit_price_usd=unit_usd,
                    line_total=line_total,
                    line_total_usd=line_total_usd,
                )
            )
    return items


def _totals(items: Iterable[PurchaseItem | SaleItem]) -> tuple[Decimal, Decimal]:
    lines = list(items)
    return (
        _calculated_total((item.line_total for item in lines), "items", MONEY),
        _calculated_total((item.line_total_usd for item in lines), "items", USD_VALUE),
    )


def _recalculate_usd_values(items: Iterable[PurchaseItem | SaleItem], rate: Decimal) -> None:
    """Keep locked USD values consistent when a draft document rate changes."""
    for item in items:
        item.unit_price_usd = _calculated_quotient(item.unit_price, rate, "items", USD_VALUE)
        item.line_total = _calculated_product(item.quantity, item.unit_price, "items", MONEY)
        item.line_total_usd = _calculated_product(item.quantity, item.unit_price_usd, "items", USD_VALUE)


def _document_number(prefix: str) -> str:
    return f"{prefix}-{uuid4().hex[:12].upper()}"


def _is_manager_or_admin(user: User) -> bool:
    role = user.role.value if isinstance(user.role, Role) else str(user.role)
    return role in {Role.ADMIN.value, Role.MANAGER.value}


def create_category(payload: Mapping[str, Any]) -> Category:
    name = required_text(payload, "name", 120)
    duplicate = db.session.scalar(select(Category).where(func.lower(Category.name) == name.casefold()))
    if duplicate:
        raise ApiProblem("validation_error", "Request validation failed.", fields={"name": "Category name is already in use."})
    category = Category(name=name, description=optional_text(payload, "description"), is_active=_optional_bool(payload, "is_active", True))
    db.session.add(category)
    _commit()
    return category


def update_category(category: Category, payload: Mapping[str, Any]) -> Category:
    if "name" in payload:
        name = required_text(payload, "name", 120)
        duplicate = db.session.scalar(
            select(Category).where(func.lower(Category.name) == name.casefold(), Category.id != category.id)
        )
        if duplicate:
            raise ApiProblem("validation_error", "Request validation failed.", fields={"name": "Category name is already in use."})
        category.name = name
    if "description" in payload:
        category.description = optional_text(payload, "description")
    active = _optional_bool(payload, "is_active")
    if active is not None:
        if not active:
            active_product = db.session.scalar(
                select(Product.id)
                .where(Product.category_id == category.id, Product.is_active.is_(True))
                .limit(1)
            )
            if active_product is not None:
                raise ApiProblem(
                    "category_in_use",
                    "Archive active products before archiving this category.",
                    409,
                )
        category.is_active = active
    _commit()
    return category


def _validate_product_uniqueness(sku: str, barcode: str | None, excluded_id: int | None = None) -> None:
    sku_query = select(Product).where(func.lower(Product.sku) == sku.casefold())
    if excluded_id is not None:
        sku_query = sku_query.where(Product.id != excluded_id)
    if db.session.scalar(sku_query):
        raise ApiProblem("validation_error", "Request validation failed.", fields={"sku": "SKU is already in use."})
    if barcode:
        barcode_query = select(Product).where(func.lower(Product.barcode) == barcode.casefold())
        if excluded_id is not None:
            barcode_query = barcode_query.where(Product.id != excluded_id)
        if db.session.scalar(barcode_query):
            raise ApiProblem("validation_error", "Request validation failed.", fields={"barcode": "Barcode is already in use."})


def _apply_product(product: Product, payload: Mapping[str, Any], creating: bool) -> None:
    if "quantity" in payload:
        raise ApiProblem(
            "validation_error",
            "Request validation failed.",
            fields={"quantity": "Stock is changed through inventory workflows only."},
        )
    values: dict[str, Any] = {}
    for field, max_length in (("name", 180), ("sku", 80), ("unit", 32)):
        if creating or field in payload:
            values[field] = required_text(payload, field, max_length)
    if creating or "category_id" in payload:
        category_id = positive_int(payload.get("category_id"), "category_id")
    else:
        category_id = product.category_id
    _get_active(Category, category_id, "Category", "category_id")
    if creating or "category_id" in payload:
        values["category_id"] = category_id
    if creating or "barcode" in payload:
        values["barcode"] = optional_text(payload, "barcode", 80)
    if creating or "reorder_level" in payload:
        values["reorder_level"] = _column_decimal(payload.get("reorder_level"), "reorder_level", QUANTITY, nonnegative=True)
    for field in ("default_cost_usd", "default_sale_price_usd"):
        if creating or field in payload:
            values[field] = _column_decimal(payload.get(field), field, USD_VALUE, nonnegative=True)
    active = _optional_bool(payload, "is_active", True if creating else None)
    if active is not None:
        values["is_active"] = active
    proposed_sku = values.get("sku", product.sku)
    proposed_barcode = values.get("barcode", product.barcode)
    _validate_product_uniqueness(proposed_sku, proposed_barcode, None if creating else product.id)
    for key, value in values.items():
        setattr(product, key, value)


def create_product(payload: Mapping[str, Any]) -> Product:
    product = Product()
    _apply_product(product, payload, True)
    # A product and its zero on-hand balance are one atomic catalog operation.
    product.stock_balance = StockBalance(quantity=Decimal("0"))
    db.session.add(product)
    _commit()
    return product


def update_product(product: Product, payload: Mapping[str, Any]) -> Product:
    _apply_product(product, payload, False)
    _commit()
    return product


def _partner_fields(partner: Supplier | Customer, payload: Mapping[str, Any], creating: bool) -> None:
    if creating or "name" in payload:
        partner.name = required_text(payload, "name", 180)
    for field, limit in (("contact_name", 120), ("email", 255), ("phone", 40), ("address", None)):
        if field in payload:
            setattr(partner, field, optional_text(payload, field, limit))
    if partner.email and not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", partner.email):
        raise ApiProblem(
            "validation_error",
            "Request validation failed.",
            fields={"email": "Enter a valid email address."},
        )
    active = _optional_bool(payload, "is_active", True if creating else None)
    if active is not None:
        partner.is_active = active


def create_partner(model: type[Supplier] | type[Customer], payload: Mapping[str, Any]) -> Supplier | Customer:
    partner = model()
    _partner_fields(partner, payload, True)
    duplicate = db.session.scalar(select(model).where(func.lower(model.name) == partner.name.casefold()))
    if duplicate:
        raise ApiProblem("validation_error", "Request validation failed.", fields={"name": "Name is already in use."})
    db.session.add(partner)
    _commit()
    return partner


def update_partner(partner: Supplier | Customer, payload: Mapping[str, Any]) -> Supplier | Customer:
    previous_name = partner.name
    _partner_fields(partner, payload, False)
    if partner.name != previous_name:
        model = type(partner)
        duplicate = db.session.scalar(
            select(model).where(func.lower(model.name) == partner.name.casefold(), model.id != partner.id)
        )
        if duplicate:
            raise ApiProblem("validation_error", "Request validation failed.", fields={"name": "Name is already in use."})
    _commit()
    return partner


def _purchase_from_payload(payload: Mapping[str, Any], user: User) -> Purchase:
    user_id = user.id
    supplier_id = positive_int(payload.get("supplier_id"), "supplier_id")
    _get_active(Supplier, supplier_id, "Supplier", "supplier_id")
    currency, rate = _normalise_currency(payload)
    items = _line_items(payload, "unit_cost", rate, "purchase")
    total_amount, total_usd = _totals(items)
    return Purchase(
        document_number=_document_number("PUR"),
        supplier_id=supplier_id,
        currency=currency,
        exchange_rate_to_usd=rate,
        total_amount=total_amount,
        total_usd=total_usd,
        notes=optional_text(payload, "notes"),
        created_by_id=user_id,
        items=items,
    )


def create_purchase(payload: Mapping[str, Any], user: User) -> Purchase:
    purchase = _purchase_from_payload(payload, user)
    db.session.add(purchase)
    _commit()
    return purchase


def _purchase_lock_statement(purchase_id: int):
    """Build the single-row locking read used by draft purchase mutations."""
    return (
        select(Purchase)
        .options(selectinload(Purchase.items).selectinload(PurchaseItem.product))
        .where(Purchase.id == purchase_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )


def _sale_lock_statement(sale_id: int):
    """Build the single-row locking read used by draft sale mutations."""
    return (
        select(Sale)
        .options(selectinload(Sale.items).selectinload(SaleItem.product))
        .where(Sale.id == sale_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )


def _locked_purchase(purchase_id: int) -> Purchase:
    purchase = db.session.scalar(_purchase_lock_statement(purchase_id))
    if purchase is None:
        raise ApiProblem("not_found", "Purchase was not found.", 404)
    return purchase


def _locked_sale(sale_id: int) -> Sale:
    sale = db.session.scalar(_sale_lock_statement(sale_id))
    if sale is None:
        raise ApiProblem("not_found", "Sale was not found.", 404)
    return sale


def update_purchase(purchase: Purchase, payload: Mapping[str, Any]) -> Purchase:
    purchase = _locked_purchase(purchase.id)
    if purchase.status is not PurchaseStatus.DRAFT:
        raise ApiProblem("invalid_state", "Only draft purchases can be edited.", 409)
    if "status" in payload:
        if payload["status"] == PurchaseStatus.CANCELLED.value:
            purchase.status = PurchaseStatus.CANCELLED
            _commit()
            return purchase
        if payload["status"] != PurchaseStatus.DRAFT.value:
            raise ApiProblem(
                "invalid_status",
                "Draft documents may only be kept as draft or cancelled.",
                fields={"status": "Must be draft or cancelled."},
            )
    if "supplier_id" in payload:
        supplier_id = positive_int(payload["supplier_id"], "supplier_id")
        _get_active(Supplier, supplier_id, "Supplier", "supplier_id")
        purchase.supplier_id = supplier_id
    if "currency" in payload or "exchange_rate_to_usd" in payload:
        merged = {"currency": payload.get("currency", purchase.currency.value), "exchange_rate_to_usd": payload.get("exchange_rate_to_usd", purchase.exchange_rate_to_usd)}
        purchase.currency, purchase.exchange_rate_to_usd = _normalise_currency(merged)
        if "items" not in payload:
            _recalculate_usd_values(purchase.items, purchase.exchange_rate_to_usd)
    if "items" in payload:
        purchase.items = _line_items(payload, "unit_cost", purchase.exchange_rate_to_usd, "purchase")  # type: ignore[assignment]
    if "notes" in payload:
        purchase.notes = optional_text(payload, "notes")
    purchase.total_amount, purchase.total_usd = _totals(purchase.items)
    _commit()
    return purchase


def _stock_balance_lock_statement(product_ids: Iterable[int]):
    """Lock stock balances in a deterministic order for multi-product workflows."""
    ordered_ids = sorted(set(product_ids))
    return (
        select(StockBalance)
        .where(StockBalance.product_id.in_(ordered_ids))
        .order_by(StockBalance.product_id)
        .with_for_update()
    )


def _balances_for_update(product_ids: Iterable[int]) -> dict[int, StockBalance]:
    ordered_ids = sorted(set(product_ids))
    balances = {
        balance.product_id: balance
        for balance in db.session.scalars(_stock_balance_lock_statement(ordered_ids))
    }
    for product_id in ordered_ids:
        if product_id not in balances:
            balance = StockBalance(product_id=product_id, quantity=Decimal("0"))
            db.session.add(balance)
            db.session.flush()
            balances[product_id] = balance
    return balances


def _balance_for_update(product_id: int) -> StockBalance:
    balance = db.session.scalar(select(StockBalance).where(StockBalance.product_id == product_id).with_for_update())
    if balance is None:
        balance = StockBalance(product_id=product_id, quantity=Decimal("0"))
        db.session.add(balance)
        db.session.flush()
    return balance


def receive_purchase(purchase_id: int, user: User) -> Purchase:
    purchase = _locked_purchase(purchase_id)
    if purchase.status is not PurchaseStatus.DRAFT:
        raise ApiProblem("invalid_state", "Only a draft purchase can be received.", 409)
    try:
        balances = _balances_for_update(item.product_id for item in purchase.items)
        for item in sorted(purchase.items, key=lambda entry: entry.product_id):
            balance = balances[item.product_id]
            balance.quantity += item.quantity
            db.session.add(
                StockMovement(
                    product_id=item.product_id,
                    movement_type=StockMovementType.PURCHASE_RECEIPT,
                    quantity_delta=item.quantity,
                    unit_cost_usd=item.unit_price_usd,
                    purchase=purchase,
                    created_by_id=user.id,
                )
            )
        purchase.status = PurchaseStatus.RECEIVED
        purchase.received_by_id = user.id
        purchase.received_at = utc_now()
        _commit()
    except Exception:
        db.session.rollback()
        raise
    return purchase


def _sale_from_payload(payload: Mapping[str, Any], user: User) -> Sale:
    user_id = user.id
    customer_id: int | None = None
    if payload.get("customer_id") is not None:
        customer_id = positive_int(payload.get("customer_id"), "customer_id")
        _get_active(Customer, customer_id, "Customer", "customer_id")
    currency, rate = _normalise_currency(payload)
    items = _line_items(payload, "unit_price", rate, "sale")
    total_amount, total_usd = _totals(items)
    return Sale(
        document_number=_document_number("SAL"),
        customer_id=customer_id,
        currency=currency,
        exchange_rate_to_usd=rate,
        total_amount=total_amount,
        total_usd=total_usd,
        notes=optional_text(payload, "notes"),
        created_by_id=user_id,
        items=items,
    )


def create_sale(payload: Mapping[str, Any], user: User) -> Sale:
    sale = _sale_from_payload(payload, user)
    db.session.add(sale)
    _commit()
    return sale


def ensure_sale_editable(sale: Sale, user: User) -> None:
    if sale.status is not SaleStatus.DRAFT:
        raise ApiProblem("invalid_state", "Only draft sales can be edited.", 409)
    if not _is_manager_or_admin(user) and sale.created_by_id != user.id:
        raise ApiProblem("forbidden", "You may edit only your own sale drafts.", 403)


def update_sale(sale: Sale, payload: Mapping[str, Any], user: User) -> Sale:
    sale = _locked_sale(sale.id)
    ensure_sale_editable(sale, user)
    if "status" in payload:
        if payload["status"] == SaleStatus.CANCELLED.value:
            sale.status = SaleStatus.CANCELLED
            _commit()
            return sale
        if payload["status"] != SaleStatus.DRAFT.value:
            raise ApiProblem(
                "invalid_status",
                "Draft documents may only be kept as draft or cancelled.",
                fields={"status": "Must be draft or cancelled."},
            )
    if "customer_id" in payload:
        if payload["customer_id"] is None:
            sale.customer_id = None
        else:
            customer_id = positive_int(payload["customer_id"], "customer_id")
            _get_active(Customer, customer_id, "Customer", "customer_id")
            sale.customer_id = customer_id
    if "currency" in payload or "exchange_rate_to_usd" in payload:
        merged = {"currency": payload.get("currency", sale.currency.value), "exchange_rate_to_usd": payload.get("exchange_rate_to_usd", sale.exchange_rate_to_usd)}
        sale.currency, sale.exchange_rate_to_usd = _normalise_currency(merged)
        if "items" not in payload:
            _recalculate_usd_values(sale.items, sale.exchange_rate_to_usd)
    if "items" in payload:
        sale.items = _line_items(payload, "unit_price", sale.exchange_rate_to_usd, "sale")  # type: ignore[assignment]
    if "notes" in payload:
        sale.notes = optional_text(payload, "notes")
    sale.total_amount, sale.total_usd = _totals(sale.items)
    _commit()
    return sale


def complete_sale(sale_id: int, user: User) -> Sale:
    sale = _locked_sale(sale_id)
    if sale.status is not SaleStatus.DRAFT:
        raise ApiProblem("invalid_state", "Only a draft sale can be completed.", 409)
    try:
        staged: list[tuple[SaleItem, StockBalance]] = []
        balances = _balances_for_update(item.product_id for item in sale.items)
        for item in sorted(sale.items, key=lambda entry: entry.product_id):
            balance = balances[item.product_id]
            if balance.quantity < item.quantity:
                raise ApiProblem("insufficient_stock", "Insufficient stock is available to complete this sale.", 409)
            staged.append((item, balance))
        for item, balance in staged:
            balance.quantity -= item.quantity
            db.session.add(
                StockMovement(
                    product_id=item.product_id,
                    movement_type=StockMovementType.SALE_ISSUE,
                    quantity_delta=-item.quantity,
                    unit_cost_usd=item.product.default_cost_usd,
                    sale=sale,
                    created_by_id=user.id,
                )
            )
        sale.status = SaleStatus.COMPLETED
        sale.completed_by_id = user.id
        sale.completed_at = utc_now()
        _commit()
    except Exception:
        db.session.rollback()
        raise
    return sale


def adjust_stock(payload: Mapping[str, Any], user: User) -> StockMovement:
    product_id = positive_int(payload.get("product_id"), "product_id")
    product = _get_active(Product, product_id, "Product", "product_id")
    quantity = _column_decimal(payload.get("quantity"), "quantity", QUANTITY, positive=True)
    direction = payload.get("direction")
    if direction not in {"in", "out"}:
        raise ApiProblem("validation_error", "Request validation failed.", fields={"direction": "Must be in or out."})
    reason = required_text(payload, "reason", 255)
    delta = quantity if direction == "in" else -quantity
    try:
        balance = _balance_for_update(product_id)
        if balance.quantity + delta < 0:
            raise ApiProblem("insufficient_stock", "The adjustment would reduce stock below zero.", 409)
        balance.quantity += delta
        movement = StockMovement(
            product_id=product_id,
            movement_type=StockMovementType.ADJUSTMENT_IN if direction == "in" else StockMovementType.ADJUSTMENT_OUT,
            quantity_delta=delta,
            unit_cost_usd=_column_decimal(
                payload.get("unit_cost_usd", product.default_cost_usd), "unit_cost_usd", USD_VALUE, nonnegative=True
            ),
            reason=reason,
            created_by_id=user.id,
        )
        db.session.add(movement)
        _commit()
    except Exception:
        db.session.rollback()
        raise
    return movement


def dashboard_data(user: User, *, period_days: int = 30) -> dict[str, Any]:
    """Build role-appropriate operational metrics from persisted records."""
    balances = db.session.execute(
        select(Product, StockBalance)
        .outerjoin(StockBalance, StockBalance.product_id == Product.id)
        .where(Product.is_active.is_(True))
    ).all()
    stock_rows = [(product, balance.quantity if balance else Decimal("0")) for product, balance in balances]
    low_stock = [
        {"product_id": product.id, "product_name": product.name, "quantity": quantity, "reorder_level": product.reorder_level, "unit": product.unit}
        for product, quantity in stock_rows
        if quantity <= product.reorder_level
    ]
    safe_data: dict[str, Any] = {
        "low_stock_count": len(low_stock),
        "low_stock": low_stock,
        "period_days": period_days,
    }
    if not _is_manager_or_admin(user):
        safe_data["own_draft_sale_count"] = db.session.scalar(
            select(func.count()).select_from(Sale).where(
                Sale.status == SaleStatus.DRAFT,
                Sale.created_by_id == user.id,
            )
        )
        return safe_data

    stock_value = _quantized_product_total(
        ((quantity, product.default_cost_usd) for product, quantity in stock_rows), USD_VALUE.scale
    )
    today, period_start, period_end = cambodia_period_bounds(period_days)
    start_date = today - timedelta(days=period_days - 1)
    activity_by_date: dict[Any, dict[str, Any]] = {
        day: {"date": day.isoformat(), "sales_usd": Decimal("0"), "purchases_usd": Decimal("0")}
        for day in (start_date + timedelta(days=offset) for offset in range(period_days))
    }
    sales = db.session.execute(
        select(Sale.completed_at, Sale.total_usd).where(
            Sale.status == SaleStatus.COMPLETED,
            Sale.completed_at >= period_start,
            Sale.completed_at < period_end,
        )
    ).all()
    purchases = db.session.execute(
        select(Purchase.received_at, Purchase.total_usd).where(
            Purchase.status == PurchaseStatus.RECEIVED,
            Purchase.received_at >= period_start,
            Purchase.received_at < period_end,
        )
    ).all()
    for completed_at, total_usd in sales:
        if completed_at is not None:
            activity_by_date[_cambodia_date(completed_at)]["sales_usd"] += Decimal(total_usd or 0)
    for received_at, total_usd in purchases:
        if received_at is not None:
            activity_by_date[_cambodia_date(received_at)]["purchases_usd"] += Decimal(total_usd or 0)
    activity = list(activity_by_date.values())
    for entry in activity:
        entry["sales_usd"] = entry["sales_usd"].quantize(Decimal("0.0001"))
        entry["purchases_usd"] = entry["purchases_usd"].quantize(Decimal("0.0001"))
    sales_total = sum((entry["sales_usd"] for entry in activity), Decimal("0")).quantize(Decimal("0.0001"))
    purchases_total = sum((entry["purchases_usd"] for entry in activity), Decimal("0")).quantize(Decimal("0.0001"))
    movements = list(
        db.session.scalars(
            select(StockMovement)
            .options(selectinload(StockMovement.product))
            .order_by(StockMovement.created_at.desc(), StockMovement.id.desc())
            .limit(10)
        )
    )
    dashboard = {
        **safe_data,
        "stock_value_usd": stock_value,
        "sales_total_usd": sales_total,
        "purchases_total_usd": purchases_total,
        "activity": activity,
        "draft_purchase_count": db.session.scalar(select(func.count()).select_from(Purchase).where(Purchase.status == PurchaseStatus.DRAFT)),
        "draft_sale_count": db.session.scalar(select(func.count()).select_from(Sale).where(Sale.status == SaleStatus.DRAFT)),
        "latest_movements": movements,
    }
    if period_days == 30:
        dashboard["sales_total_usd_last_30_days"] = sales_total
        dashboard["purchases_total_usd_last_30_days"] = purchases_total
    return dashboard
