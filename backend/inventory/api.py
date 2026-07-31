# inventory api routes

from __future__ import annotations

from collections.abc import Callable
from decimal import Decimal
from typing import Any, TypeVar

from flask import Blueprint, request
from flask_login import current_user, login_required
from sqlalchemy import func, or_, select
from sqlalchemy.orm import selectinload

from inventory.api_helpers import ApiProblem, data_response, list_response, pagination_args, request_json, sort_args, status_arg
from inventory.auth import has_role, register_auth_routes, roles_required, user_data
from inventory.extensions import db
from inventory.models import (
    Category,
    Customer,
    Product,
    Purchase,
    PurchaseItem,
    Role,
    Sale,
    SaleItem,
    StockBalance,
    StockMovement,
    Supplier,
)
from inventory.services import (
    adjust_stock,
    create_category,
    create_partner,
    create_product,
    create_purchase,
    create_sale,
    dashboard_data,
    receive_purchase,
    complete_sale,
    update_category,
    update_partner,
    update_product,
    update_purchase,
    update_sale,
)


Model = TypeVar("Model")
DASHBOARD_RANGE_DAYS = {"today": 1, "week": 7, "month": 30}


def _entity(model: type[Model], entity_id: int, label: str) -> Model:
    entity = db.session.get(model, entity_id)
    if entity is None:
        raise ApiProblem("not_found", f"{label} was not found.", 404)
    return entity


def _serialize_category(category: Category) -> dict[str, Any]:
    return {
        "id": category.id,
        "name": category.name,
        "description": category.description,
        "is_active": category.is_active,
        "created_at": category.created_at,
        "updated_at": category.updated_at,
    }


def _serialize_product(product: Product, include_cost: bool = True) -> dict[str, Any]:
    data = {
        "id": product.id,
        "name": product.name,
        "sku": product.sku,
        "barcode": product.barcode,
        "category_id": product.category_id,
        "category_name": product.category.name if product.category else None,
        "unit": product.unit,
        "reorder_level": product.reorder_level,
        "default_sale_price_usd": product.default_sale_price_usd,
        "is_active": product.is_active,
        "created_at": product.created_at,
        "updated_at": product.updated_at,
    }
    if include_cost:
        data["default_cost_usd"] = product.default_cost_usd
    return data


def _serialize_partner(partner: Supplier | Customer) -> dict[str, Any]:
    return {
        "id": partner.id,
        "name": partner.name,
        "contact_name": partner.contact_name,
        "email": partner.email,
        "phone": partner.phone,
        "address": partner.address,
        "is_active": partner.is_active,
        "created_at": partner.created_at,
        "updated_at": partner.updated_at,
    }


def _serialize_sale_customer(customer: Customer) -> dict[str, Any]:
    # serialize sale customer
    return {"id": customer.id, "name": customer.name, "code": f"CUS-{customer.id:05d}"}


def _serialize_purchase_item(item: PurchaseItem) -> dict[str, Any]:
    return {
        "id": item.id,
        "product_id": item.product_id,
        "product_name": item.product.name if item.product else None,
        "quantity": item.quantity,
        "unit_cost": item.unit_price,
        "unit_cost_usd": item.unit_price_usd,
        "line_total": item.line_total,
        "line_total_usd": item.line_total_usd,
    }


def _serialize_purchase(purchase: Purchase) -> dict[str, Any]:
    return {
        "id": purchase.id,
        "document_number": purchase.document_number,
        "supplier_id": purchase.supplier_id,
        "supplier_name": purchase.supplier.name if purchase.supplier else None,
        "status": purchase.status,
        "currency": purchase.currency,
        "exchange_rate_to_usd": purchase.exchange_rate_to_usd,
        "total_amount": purchase.total_amount,
        "total_usd": purchase.total_usd,
        "notes": purchase.notes,
        "created_by": user_data(purchase.created_by) if purchase.created_by else None,
        "received_by": user_data(purchase.received_by) if purchase.received_by else None,
        "received_at": purchase.received_at,
        "created_at": purchase.created_at,
        "updated_at": purchase.updated_at,
        "items": [_serialize_purchase_item(item) for item in purchase.items],
    }


def _serialize_sale_item(item: SaleItem) -> dict[str, Any]:
    return {
        "id": item.id,
        "product_id": item.product_id,
        "product_name": item.product.name if item.product else None,
        "quantity": item.quantity,
        "unit_price": item.unit_price,
        "unit_price_usd": item.unit_price_usd,
        "line_total": item.line_total,
        "line_total_usd": item.line_total_usd,
    }


def _serialize_sale(sale: Sale) -> dict[str, Any]:
    return {
        "id": sale.id,
        "document_number": sale.document_number,
        "customer_id": sale.customer_id,
        "customer_name": sale.customer.name if sale.customer else None,
        "status": sale.status,
        "currency": sale.currency,
        "exchange_rate_to_usd": sale.exchange_rate_to_usd,
        "total_amount": sale.total_amount,
        "total_usd": sale.total_usd,
        "notes": sale.notes,
        "created_by": user_data(sale.created_by) if sale.created_by else None,
        "completed_by": user_data(sale.completed_by) if sale.completed_by else None,
        "completed_at": sale.completed_at,
        "created_at": sale.created_at,
        "updated_at": sale.updated_at,
        "items": [_serialize_sale_item(item) for item in sale.items],
    }


def _serialize_movement(movement: StockMovement) -> dict[str, Any]:
    return {
        "id": movement.id,
        "product_id": movement.product_id,
        "product_name": movement.product.name if movement.product else None,
        "movement_type": movement.movement_type,
        "quantity_delta": movement.quantity_delta,
        "unit_cost_usd": movement.unit_cost_usd,
        "reason": movement.reason,
        "purchase_id": movement.purchase_id,
        "sale_id": movement.sale_id,
        "created_by_id": movement.created_by_id,
        "created_at": movement.created_at,
    }


def _page(statement: Any, serializer: Callable[[Any], dict[str, Any]]) -> tuple[Any, int]:
    page, per_page = pagination_args()
    total = db.session.scalar(select(func.count()).select_from(statement.order_by(None).subquery())) or 0
    records = list(db.session.scalars(statement.offset((page - 1) * per_page).limit(per_page)))
    return list_response([serializer(record) for record in records], page, per_page, total)


def _text_query() -> str:
    return request.args.get("q", "").strip()


def register_api_routes(api: Blueprint) -> None:
    # register api blueprint
    register_auth_routes(api)

    @api.get("/categories")
    @login_required
    def list_categories():
        q = _text_query()
        status = status_arg()
        column, descending = sort_args({"id": Category.id, "name": Category.name, "created_at": Category.created_at})
        statement = select(Category)
        if q:
            statement = statement.where(func.lower(Category.name).like(f"%{q.casefold()}%"))
        if status is not None:
            statement = statement.where(Category.is_active.is_(status))
        return _page(statement.order_by(column.desc() if descending else column.asc()), _serialize_category)

    @api.post("/categories")
    @roles_required(Role.ADMIN, Role.MANAGER)
    def post_category():
        return data_response(_serialize_category(create_category(request_json())), 201)

    @api.get("/categories/<int:category_id>")
    @login_required
    def get_category(category_id: int):
        return data_response(_serialize_category(_entity(Category, category_id, "Category")))

    @api.patch("/categories/<int:category_id>")
    @roles_required(Role.ADMIN, Role.MANAGER)
    def patch_category(category_id: int):
        return data_response(_serialize_category(update_category(_entity(Category, category_id, "Category"), request_json())))

    @api.get("/products")
    @login_required
    def list_products():
        q = _text_query()
        status = status_arg()
        column, descending = sort_args(
            {"id": Product.id, "name": Product.name, "sku": Product.sku, "created_at": Product.created_at}, "name"
        )
        statement = select(Product).options(selectinload(Product.category))
        if q:
            pattern = f"%{q.casefold()}%"
            statement = statement.where(or_(func.lower(Product.name).like(pattern), func.lower(Product.sku).like(pattern), func.lower(Product.barcode).like(pattern)))
        if status is not None:
            statement = statement.where(Product.is_active.is_(status))
        include_cost = has_role(Role.ADMIN, Role.MANAGER)
        return _page(
            statement.order_by(column.desc() if descending else column.asc()),
            lambda product: _serialize_product(product, include_cost),
        )

    @api.post("/products")
    @roles_required(Role.ADMIN, Role.MANAGER)
    def post_product():
        return data_response(_serialize_product(create_product(request_json())), 201)

    @api.get("/products/<int:product_id>")
    @login_required
    def get_product(product_id: int):
        product = db.session.scalar(select(Product).options(selectinload(Product.category)).where(Product.id == product_id))
        if product is None:
            raise ApiProblem("not_found", "Product was not found.", 404)
        return data_response(_serialize_product(product, has_role(Role.ADMIN, Role.MANAGER)))

    @api.patch("/products/<int:product_id>")
    @roles_required(Role.ADMIN, Role.MANAGER)
    def patch_product(product_id: int):
        return data_response(_serialize_product(update_product(_entity(Product, product_id, "Product"), request_json())))

    @api.get("/suppliers")
    @roles_required(Role.ADMIN, Role.MANAGER)
    def list_suppliers():
        return _list_partners(Supplier)

    @api.post("/suppliers")
    @roles_required(Role.ADMIN, Role.MANAGER)
    def post_supplier():
        return data_response(_serialize_partner(create_partner(Supplier, request_json())), 201)

    @api.get("/suppliers/<int:supplier_id>")
    @roles_required(Role.ADMIN, Role.MANAGER)
    def get_supplier(supplier_id: int):
        return data_response(_serialize_partner(_entity(Supplier, supplier_id, "Supplier")))

    @api.patch("/suppliers/<int:supplier_id>")
    @roles_required(Role.ADMIN, Role.MANAGER)
    def patch_supplier(supplier_id: int):
        return data_response(_serialize_partner(update_partner(_entity(Supplier, supplier_id, "Supplier"), request_json())))

    @api.get("/customers")
    @login_required
    def list_customers():
        if has_role(Role.STAFF):
            if request.args.get("for_sale") != "true":
                raise ApiProblem("forbidden", "You do not have permission to perform this action.", 403)
            return _list_sale_customers()
        return _list_partners(Customer)

    @api.post("/customers")
    @roles_required(Role.ADMIN, Role.MANAGER)
    def post_customer():
        return data_response(_serialize_partner(create_partner(Customer, request_json())), 201)

    @api.get("/customers/<int:customer_id>")
    @roles_required(Role.ADMIN, Role.MANAGER)
    def get_customer(customer_id: int):
        return data_response(_serialize_partner(_entity(Customer, customer_id, "Customer")))

    @api.patch("/customers/<int:customer_id>")
    @roles_required(Role.ADMIN, Role.MANAGER)
    def patch_customer(customer_id: int):
        return data_response(_serialize_partner(update_partner(_entity(Customer, customer_id, "Customer"), request_json())))

    @api.get("/inventory/stock")
    @login_required
    def list_stock():
        q = _text_query()
        low_stock = request.args.get("low_stock")
        if low_stock is not None:
            low_stock = low_stock.lower()
            if low_stock not in {"true", "false"}:
                raise ApiProblem(
                    "validation_error",
                    "Request validation failed.",
                    fields={"low_stock": "Must be true or false."},
                )
        quantity = func.coalesce(StockBalance.quantity, Decimal("0"))
        column, descending = sort_args({"product_id": Product.id, "name": Product.name, "quantity": quantity}, "name")
        statement = (
            select(Product)
            .outerjoin(StockBalance, StockBalance.product_id == Product.id)
            .options(selectinload(Product.stock_balance))
            .where(Product.is_active.is_(True))
        )
        if q:
            pattern = f"%{q.casefold()}%"
            statement = statement.where(or_(func.lower(Product.name).like(pattern), func.lower(Product.sku).like(pattern)))
        if low_stock == "true":
            statement = statement.where(quantity <= Product.reorder_level)
        elif low_stock == "false":
            statement = statement.where(quantity > Product.reorder_level)
        def serialize(product: Product) -> dict[str, Any]:
            balance = product.stock_balance
            return {
                "product_id": product.id,
                "product_name": product.name,
                "sku": product.sku,
                "unit": product.unit,
                "quantity": balance.quantity if balance else Decimal("0"),
                "reorder_level": product.reorder_level,
                "updated_at": balance.updated_at if balance else None,
            }
        return _page(statement.order_by(column.desc() if descending else column.asc()), serialize)

    @api.get("/inventory/movements")
    @roles_required(Role.ADMIN, Role.MANAGER)
    def list_movements():
        q = _text_query()
        column, descending = sort_args({"id": StockMovement.id, "created_at": StockMovement.created_at, "quantity_delta": StockMovement.quantity_delta}, "created_at")
        statement = select(StockMovement).join(Product).options(selectinload(StockMovement.product))
        if q:
            pattern = f"%{q.casefold()}%"
            statement = statement.where(or_(func.lower(Product.name).like(pattern), func.lower(Product.sku).like(pattern)))
        return _page(statement.order_by(column.desc() if descending else column.asc()), _serialize_movement)

    @api.post("/inventory/adjustments")
    @roles_required(Role.ADMIN, Role.MANAGER)
    def post_adjustment():
        return data_response(_serialize_movement(adjust_stock(request_json(), current_user)), 201)

    @api.get("/purchases")
    @roles_required(Role.ADMIN, Role.MANAGER)
    def list_purchases():
        q = _text_query()
        column, descending = sort_args({"id": Purchase.id, "created_at": Purchase.created_at, "document_number": Purchase.document_number, "total_usd": Purchase.total_usd}, "created_at")
        statement = select(Purchase).options(
            selectinload(Purchase.items).selectinload(PurchaseItem.product),
            selectinload(Purchase.supplier),
            selectinload(Purchase.created_by),
            selectinload(Purchase.received_by),
        )
        if q:
            statement = statement.where(func.lower(Purchase.document_number).like(f"%{q.casefold()}%"))
        return _page(statement.order_by(column.desc() if descending else column.asc()), _serialize_purchase)

    @api.post("/purchases")
    @roles_required(Role.ADMIN, Role.MANAGER)
    def post_purchase():
        return data_response(_serialize_purchase(create_purchase(request_json(), current_user)), 201)

    @api.get("/purchases/<int:purchase_id>")
    @roles_required(Role.ADMIN, Role.MANAGER)
    def get_purchase(purchase_id: int):
        purchase = _purchase_details(purchase_id)
        return data_response(_serialize_purchase(purchase))

    @api.patch("/purchases/<int:purchase_id>")
    @roles_required(Role.ADMIN, Role.MANAGER)
    def patch_purchase(purchase_id: int):
        return data_response(_serialize_purchase(update_purchase(_purchase_details(purchase_id), request_json())))

    @api.post("/purchases/<int:purchase_id>/receive")
    @roles_required(Role.ADMIN, Role.MANAGER)
    def post_purchase_receive(purchase_id: int):
        return data_response(_serialize_purchase(receive_purchase(purchase_id, current_user)))

    @api.get("/sales")
    @login_required
    def list_sales():
        q = _text_query()
        column, descending = sort_args({"id": Sale.id, "created_at": Sale.created_at, "document_number": Sale.document_number, "total_usd": Sale.total_usd}, "created_at")
        statement = _sales_details_statement()
        if not has_role(Role.ADMIN, Role.MANAGER):
            statement = statement.where(Sale.created_by_id == current_user.id)
        if q:
            statement = statement.where(func.lower(Sale.document_number).like(f"%{q.casefold()}%"))
        return _page(statement.order_by(column.desc() if descending else column.asc()), _serialize_sale)

    @api.post("/sales")
    @login_required
    def post_sale():
        return data_response(_serialize_sale(create_sale(request_json(), current_user)), 201)

    @api.get("/sales/<int:sale_id>")
    @login_required
    def get_sale(sale_id: int):
        sale = _sale_details(sale_id)
        if not has_role(Role.ADMIN, Role.MANAGER) and sale.created_by_id != current_user.id:
            raise ApiProblem("forbidden", "You may view only your own sales.", 403)
        return data_response(_serialize_sale(sale))

    @api.patch("/sales/<int:sale_id>")
    @login_required
    def patch_sale(sale_id: int):
        sale = _sale_details(sale_id)
        return data_response(_serialize_sale(update_sale(sale, request_json(), current_user)))

    @api.post("/sales/<int:sale_id>/complete")
    @roles_required(Role.ADMIN, Role.MANAGER)
    def post_sale_complete(sale_id: int):
        return data_response(_serialize_sale(complete_sale(sale_id, current_user)))

    @api.get("/dashboard")
    @login_required
    def dashboard():
        range_name = request.args.get("range", "month")
        period_days = DASHBOARD_RANGE_DAYS.get(range_name)
        if period_days is None:
            raise ApiProblem(
                "validation_error",
                "Request validation failed.",
                fields={"range": "Must be today, week, or month."},
            )
        data = dashboard_data(current_user, period_days=period_days)
        if "latest_movements" in data:
            data["latest_movements"] = [_serialize_movement(movement) for movement in data["latest_movements"]]
        return data_response(data)


def _list_partners(model: type[Supplier] | type[Customer]):
    q = _text_query()
    column, descending = sort_args({"id": model.id, "name": model.name, "created_at": model.created_at}, "name")
    statement = select(model)
    if q:
        pattern = f"%{q.casefold()}%"
        statement = statement.where(or_(func.lower(model.name).like(pattern), func.lower(model.email).like(pattern), func.lower(model.phone).like(pattern)))
    return _page(statement.order_by(column.desc() if descending else column.asc()), _serialize_partner)


def _list_sale_customers():
    q = _text_query()
    statement = select(Customer).where(Customer.is_active.is_(True))
    if q:
        statement = statement.where(func.lower(Customer.name).like(f"%{q.casefold()}%"))
    return _page(statement.order_by(Customer.name.asc()), _serialize_sale_customer)


def _purchase_details(purchase_id: int) -> Purchase:
    purchase = db.session.scalar(
        select(Purchase)
        .options(
            selectinload(Purchase.items).selectinload(PurchaseItem.product),
            selectinload(Purchase.supplier),
            selectinload(Purchase.created_by),
            selectinload(Purchase.received_by),
        )
        .where(Purchase.id == purchase_id)
    )
    if purchase is None:
        raise ApiProblem("not_found", "Purchase was not found.", 404)
    return purchase


def _sales_details_statement():
    return select(Sale).options(
        selectinload(Sale.items).selectinload(SaleItem.product),
        selectinload(Sale.customer),
        selectinload(Sale.created_by),
        selectinload(Sale.completed_by),
    )


def _sale_details(sale_id: int) -> Sale:
    sale = db.session.scalar(_sales_details_statement().where(Sale.id == sale_id))
    if sale is None:
        raise ApiProblem("not_found", "Sale was not found.", 404)
    return sale
