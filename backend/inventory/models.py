"""Typed persistence models for the inventory domain."""

from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal
from enum import Enum
from flask_login import UserMixin
from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Numeric, String, Text, UniqueConstraint, event
from sqlalchemy import Enum as SqlEnum
from sqlalchemy.engine import Dialect
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.types import TypeDecorator
from werkzeug.security import check_password_hash, generate_password_hash

from inventory.extensions import db

QUANTITY = Numeric(16, 3)
MONEY = Numeric(18, 2)
USD_VALUE = Numeric(18, 4)
EXCHANGE_RATE = Numeric(18, 6)


class AppendOnlyLedgerError(RuntimeError):
    """Raised when persisted stock ledger history is modified or removed."""


class UTCDateTime(TypeDecorator[datetime]):
    """Store UTC-naive values and always return aware UTC datetimes.

    MySQL ``DATETIME`` has no timezone metadata, so naive inputs are documented
    as UTC and aware inputs are converted to UTC before they are persisted.
    """

    impl = DateTime
    cache_ok = True

    def process_bind_param(self, value: datetime | None, dialect: Dialect) -> datetime | None:
        if value is None:
            return None
        if value.tzinfo is None:
            return value
        return value.astimezone(timezone.utc).replace(tzinfo=None)

    def process_result_value(self, value: datetime | None, dialect: Dialect) -> datetime | None:
        if value is None:
            return None
        if value.tzinfo is None:
            return value.replace(tzinfo=timezone.utc)
        return value.astimezone(timezone.utc)


def utc_now() -> datetime:
    """Return an aware UTC timestamp for application-managed audit fields."""
    return datetime.now(timezone.utc)


def enum_type(enum_class: type[Enum], name: str, length: int = 32) -> SqlEnum:
    """Store lower-case enum values consistently on MySQL and SQLite."""
    return SqlEnum(
        enum_class,
        name=name,
        native_enum=False,
        create_constraint=True,
        validate_strings=True,
        values_callable=lambda values: [item.value for item in values],
        length=length,
    )


class Role(str, Enum):
    ADMIN = "admin"
    MANAGER = "manager"
    STAFF = "staff"


class Currency(str, Enum):
    USD = "USD"
    KHR = "KHR"


class PurchaseStatus(str, Enum):
    DRAFT = "draft"
    RECEIVED = "received"
    CANCELLED = "cancelled"


class SaleStatus(str, Enum):
    DRAFT = "draft"
    COMPLETED = "completed"
    CANCELLED = "cancelled"


class StockMovementType(str, Enum):
    PURCHASE_RECEIPT = "purchase_receipt"
    SALE_ISSUE = "sale_issue"
    ADJUSTMENT_IN = "adjustment_in"
    ADJUSTMENT_OUT = "adjustment_out"


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(UTCDateTime(), default=utc_now, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        UTCDateTime(), default=utc_now, onupdate=utc_now, nullable=False
    )


class User(UserMixin, TimestampMixin, db.Model):
    __tablename__ = "users"
    __table_args__ = {"mysql_charset": "utf8mb4", "mysql_collate": "utf8mb4_unicode_ci"}

    id: Mapped[int] = mapped_column(primary_key=True)
    username: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    email: Mapped[str | None] = mapped_column(String(255), unique=True)
    full_name: Mapped[str] = mapped_column(String(120), nullable=False)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    role: Mapped[Role] = mapped_column(enum_type(Role, "role_type", 16), nullable=False, default=Role.STAFF)
    is_active: Mapped[bool] = mapped_column(default=True, nullable=False)

    created_purchases: Mapped[list["Purchase"]] = relationship(
        back_populates="created_by", foreign_keys="Purchase.created_by_id"
    )
    received_purchases: Mapped[list["Purchase"]] = relationship(
        back_populates="received_by", foreign_keys="Purchase.received_by_id"
    )
    created_sales: Mapped[list["Sale"]] = relationship(
        back_populates="created_by", foreign_keys="Sale.created_by_id"
    )
    completed_sales: Mapped[list["Sale"]] = relationship(
        back_populates="completed_by", foreign_keys="Sale.completed_by_id"
    )
    stock_movements: Mapped[list["StockMovement"]] = relationship(back_populates="created_by")

    def set_password(self, password: str) -> None:
        self.password_hash = generate_password_hash(password)

    def check_password(self, password: str) -> bool:
        return check_password_hash(self.password_hash, password)


class Category(TimestampMixin, db.Model):
    __tablename__ = "categories"
    __table_args__ = {"mysql_charset": "utf8mb4", "mysql_collate": "utf8mb4_unicode_ci"}

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(120), unique=True, nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    is_active: Mapped[bool] = mapped_column(default=True, nullable=False)

    products: Mapped[list["Product"]] = relationship(back_populates="category")


class Product(TimestampMixin, db.Model):
    __tablename__ = "products"
    __table_args__ = (
        CheckConstraint("reorder_level >= 0", name="ck_products_reorder_level_nonnegative"),
        CheckConstraint("default_cost_usd >= 0", name="ck_products_default_cost_nonnegative"),
        CheckConstraint("default_sale_price_usd >= 0", name="ck_products_default_sale_nonnegative"),
        {"mysql_charset": "utf8mb4", "mysql_collate": "utf8mb4_unicode_ci"},
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(180), nullable=False)
    sku: Mapped[str] = mapped_column(String(80), unique=True, nullable=False)
    barcode: Mapped[str | None] = mapped_column(String(80), unique=True)
    category_id: Mapped[int] = mapped_column(ForeignKey("categories.id", ondelete="RESTRICT"), nullable=False)
    unit: Mapped[str] = mapped_column(String(32), nullable=False)
    reorder_level: Mapped[Decimal] = mapped_column(QUANTITY, default=Decimal("0"), nullable=False)
    default_cost_usd: Mapped[Decimal] = mapped_column(USD_VALUE, nullable=False)
    default_sale_price_usd: Mapped[Decimal] = mapped_column(USD_VALUE, nullable=False)
    is_active: Mapped[bool] = mapped_column(default=True, nullable=False)

    category: Mapped[Category] = relationship(back_populates="products")
    stock_balance: Mapped["StockBalance | None"] = relationship(back_populates="product", uselist=False)
    stock_movements: Mapped[list["StockMovement"]] = relationship(back_populates="product")
    purchase_items: Mapped[list["PurchaseItem"]] = relationship(back_populates="product")
    sale_items: Mapped[list["SaleItem"]] = relationship(back_populates="product")


class Supplier(TimestampMixin, db.Model):
    __tablename__ = "suppliers"
    __table_args__ = {"mysql_charset": "utf8mb4", "mysql_collate": "utf8mb4_unicode_ci"}

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(180), unique=True, nullable=False)
    contact_name: Mapped[str | None] = mapped_column(String(120))
    email: Mapped[str | None] = mapped_column(String(255))
    phone: Mapped[str | None] = mapped_column(String(40))
    address: Mapped[str | None] = mapped_column(Text)
    is_active: Mapped[bool] = mapped_column(default=True, nullable=False)

    purchases: Mapped[list["Purchase"]] = relationship(back_populates="supplier")


class Customer(TimestampMixin, db.Model):
    __tablename__ = "customers"
    __table_args__ = {"mysql_charset": "utf8mb4", "mysql_collate": "utf8mb4_unicode_ci"}

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(180), unique=True, nullable=False)
    contact_name: Mapped[str | None] = mapped_column(String(120))
    email: Mapped[str | None] = mapped_column(String(255))
    phone: Mapped[str | None] = mapped_column(String(40))
    address: Mapped[str | None] = mapped_column(Text)
    is_active: Mapped[bool] = mapped_column(default=True, nullable=False)

    sales: Mapped[list["Sale"]] = relationship(back_populates="customer")


class StockBalance(db.Model):
    """The current on-hand quantity; movements remain the immutable history."""

    __tablename__ = "stock_balances"
    __table_args__ = (
        CheckConstraint("quantity >= 0", name="ck_stock_balances_quantity_nonnegative"),
        {"mysql_charset": "utf8mb4", "mysql_collate": "utf8mb4_unicode_ci"},
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    product_id: Mapped[int] = mapped_column(
        ForeignKey("products.id", ondelete="CASCADE"), unique=True, nullable=False
    )
    quantity: Mapped[Decimal] = mapped_column(QUANTITY, default=Decimal("0"), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        UTCDateTime(), default=utc_now, onupdate=utc_now, nullable=False
    )

    product: Mapped[Product] = relationship(back_populates="stock_balance")


class Purchase(TimestampMixin, db.Model):
    __tablename__ = "purchases"
    __table_args__ = (
        CheckConstraint("exchange_rate_to_usd > 0", name="ck_purchases_exchange_rate_positive"),
        CheckConstraint("total_amount >= 0", name="ck_purchases_total_amount_nonnegative"),
        CheckConstraint("total_usd >= 0", name="ck_purchases_total_usd_nonnegative"),
        CheckConstraint(
            "currency != 'USD' OR exchange_rate_to_usd = 1",
            name="ck_purchases_usd_exchange_rate_one",
        ),
        {"mysql_charset": "utf8mb4", "mysql_collate": "utf8mb4_unicode_ci"},
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    document_number: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    supplier_id: Mapped[int] = mapped_column(ForeignKey("suppliers.id", ondelete="RESTRICT"), nullable=False)
    status: Mapped[PurchaseStatus] = mapped_column(
        enum_type(PurchaseStatus, "purchase_status_type", 16), nullable=False, default=PurchaseStatus.DRAFT
    )
    currency: Mapped[Currency] = mapped_column(
        enum_type(Currency, "purchase_currency_type", 8), nullable=False
    )
    exchange_rate_to_usd: Mapped[Decimal] = mapped_column(EXCHANGE_RATE, nullable=False)
    total_amount: Mapped[Decimal] = mapped_column(MONEY, default=Decimal("0"), nullable=False)
    total_usd: Mapped[Decimal] = mapped_column(USD_VALUE, default=Decimal("0"), nullable=False)
    notes: Mapped[str | None] = mapped_column(Text)
    created_by_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"), nullable=False)
    received_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"))
    received_at: Mapped[datetime | None] = mapped_column(UTCDateTime())

    supplier: Mapped[Supplier] = relationship(back_populates="purchases")
    created_by: Mapped[User] = relationship(back_populates="created_purchases", foreign_keys=[created_by_id])
    received_by: Mapped[User | None] = relationship(
        back_populates="received_purchases", foreign_keys=[received_by_id]
    )
    items: Mapped[list["PurchaseItem"]] = relationship(
        back_populates="purchase", cascade="all, delete-orphan", passive_deletes=True
    )
    stock_movements: Mapped[list["StockMovement"]] = relationship(back_populates="purchase")


class PurchaseItem(db.Model):
    __tablename__ = "purchase_items"
    __table_args__ = (
        UniqueConstraint("purchase_id", "product_id", name="uq_purchase_items_purchase_product"),
        CheckConstraint("quantity > 0", name="ck_purchase_items_quantity_positive"),
        CheckConstraint("unit_price >= 0", name="ck_purchase_items_unit_price_nonnegative"),
        CheckConstraint("unit_price_usd >= 0", name="ck_purchase_items_unit_price_usd_nonnegative"),
        CheckConstraint("line_total >= 0", name="ck_purchase_items_line_total_nonnegative"),
        CheckConstraint("line_total_usd >= 0", name="ck_purchase_items_line_total_usd_nonnegative"),
        {"mysql_charset": "utf8mb4", "mysql_collate": "utf8mb4_unicode_ci"},
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    purchase_id: Mapped[int] = mapped_column(ForeignKey("purchases.id", ondelete="CASCADE"), nullable=False)
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id", ondelete="RESTRICT"), nullable=False)
    quantity: Mapped[Decimal] = mapped_column(QUANTITY, nullable=False)
    unit_price: Mapped[Decimal] = mapped_column(MONEY, nullable=False)
    unit_price_usd: Mapped[Decimal] = mapped_column(USD_VALUE, nullable=False)
    line_total: Mapped[Decimal] = mapped_column(MONEY, nullable=False)
    line_total_usd: Mapped[Decimal] = mapped_column(USD_VALUE, nullable=False)

    purchase: Mapped[Purchase] = relationship(back_populates="items")
    product: Mapped[Product] = relationship(back_populates="purchase_items")


class Sale(TimestampMixin, db.Model):
    __tablename__ = "sales"
    __table_args__ = (
        CheckConstraint("exchange_rate_to_usd > 0", name="ck_sales_exchange_rate_positive"),
        CheckConstraint("total_amount >= 0", name="ck_sales_total_amount_nonnegative"),
        CheckConstraint("total_usd >= 0", name="ck_sales_total_usd_nonnegative"),
        CheckConstraint(
            "currency != 'USD' OR exchange_rate_to_usd = 1",
            name="ck_sales_usd_exchange_rate_one",
        ),
        {"mysql_charset": "utf8mb4", "mysql_collate": "utf8mb4_unicode_ci"},
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    document_number: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    customer_id: Mapped[int | None] = mapped_column(ForeignKey("customers.id", ondelete="RESTRICT"))
    status: Mapped[SaleStatus] = mapped_column(
        enum_type(SaleStatus, "sale_status_type", 16), nullable=False, default=SaleStatus.DRAFT
    )
    currency: Mapped[Currency] = mapped_column(
        enum_type(Currency, "sale_currency_type", 8), nullable=False
    )
    exchange_rate_to_usd: Mapped[Decimal] = mapped_column(EXCHANGE_RATE, nullable=False)
    total_amount: Mapped[Decimal] = mapped_column(MONEY, default=Decimal("0"), nullable=False)
    total_usd: Mapped[Decimal] = mapped_column(USD_VALUE, default=Decimal("0"), nullable=False)
    notes: Mapped[str | None] = mapped_column(Text)
    created_by_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"), nullable=False)
    completed_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"))
    completed_at: Mapped[datetime | None] = mapped_column(UTCDateTime())

    customer: Mapped[Customer | None] = relationship(back_populates="sales")
    created_by: Mapped[User] = relationship(back_populates="created_sales", foreign_keys=[created_by_id])
    completed_by: Mapped[User | None] = relationship(
        back_populates="completed_sales", foreign_keys=[completed_by_id]
    )
    items: Mapped[list["SaleItem"]] = relationship(
        back_populates="sale", cascade="all, delete-orphan", passive_deletes=True
    )
    stock_movements: Mapped[list["StockMovement"]] = relationship(back_populates="sale")


class SaleItem(db.Model):
    __tablename__ = "sale_items"
    __table_args__ = (
        UniqueConstraint("sale_id", "product_id", name="uq_sale_items_sale_product"),
        CheckConstraint("quantity > 0", name="ck_sale_items_quantity_positive"),
        CheckConstraint("unit_price >= 0", name="ck_sale_items_unit_price_nonnegative"),
        CheckConstraint("unit_price_usd >= 0", name="ck_sale_items_unit_price_usd_nonnegative"),
        CheckConstraint("line_total >= 0", name="ck_sale_items_line_total_nonnegative"),
        CheckConstraint("line_total_usd >= 0", name="ck_sale_items_line_total_usd_nonnegative"),
        {"mysql_charset": "utf8mb4", "mysql_collate": "utf8mb4_unicode_ci"},
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    sale_id: Mapped[int] = mapped_column(ForeignKey("sales.id", ondelete="CASCADE"), nullable=False)
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id", ondelete="RESTRICT"), nullable=False)
    quantity: Mapped[Decimal] = mapped_column(QUANTITY, nullable=False)
    unit_price: Mapped[Decimal] = mapped_column(MONEY, nullable=False)
    unit_price_usd: Mapped[Decimal] = mapped_column(USD_VALUE, nullable=False)
    line_total: Mapped[Decimal] = mapped_column(MONEY, nullable=False)
    line_total_usd: Mapped[Decimal] = mapped_column(USD_VALUE, nullable=False)

    sale: Mapped[Sale] = relationship(back_populates="items")
    product: Mapped[Product] = relationship(back_populates="sale_items")


class StockMovement(db.Model):
    """Append-only ledger rows created alongside any stock-balance update."""

    __tablename__ = "stock_movements"
    __table_args__ = (
        CheckConstraint("quantity_delta != 0", name="ck_stock_movements_quantity_nonzero"),
        CheckConstraint("unit_cost_usd >= 0", name="ck_stock_movements_unit_cost_nonnegative"),
        {"mysql_charset": "utf8mb4", "mysql_collate": "utf8mb4_unicode_ci"},
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id", ondelete="RESTRICT"), nullable=False)
    movement_type: Mapped[StockMovementType] = mapped_column(
        enum_type(StockMovementType, "stock_movement_type", 24), nullable=False
    )
    quantity_delta: Mapped[Decimal] = mapped_column(QUANTITY, nullable=False)
    unit_cost_usd: Mapped[Decimal] = mapped_column(USD_VALUE, nullable=False)
    reason: Mapped[str | None] = mapped_column(String(255))
    purchase_id: Mapped[int | None] = mapped_column(ForeignKey("purchases.id", ondelete="RESTRICT"))
    sale_id: Mapped[int | None] = mapped_column(ForeignKey("sales.id", ondelete="RESTRICT"))
    created_by_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime(), default=utc_now, nullable=False)

    product: Mapped[Product] = relationship(back_populates="stock_movements")
    purchase: Mapped[Purchase | None] = relationship(back_populates="stock_movements")
    sale: Mapped[Sale | None] = relationship(back_populates="stock_movements")
    created_by: Mapped[User] = relationship(back_populates="stock_movements")


@event.listens_for(StockMovement, "before_update")
def reject_stock_movement_update(*_: object) -> None:
    """Prevent ORM updates to persisted stock ledger entries."""
    raise AppendOnlyLedgerError("Stock movements are append-only ledger records and cannot be modified.")


@event.listens_for(StockMovement, "before_delete")
def reject_stock_movement_delete(*_: object) -> None:
    """Prevent ORM deletion of persisted stock ledger entries."""
    raise AppendOnlyLedgerError("Stock movements are append-only ledger records and cannot be deleted.")
