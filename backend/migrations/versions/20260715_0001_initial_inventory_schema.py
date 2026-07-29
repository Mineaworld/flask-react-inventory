"""Create the inventory management schema.

Generated from the SQLAlchemy models and reviewed for MySQL 8+ utf8mb4
deployment. SQLite test runs rely on the ORM append-only guards; MySQL gains
database triggers below so direct SQL cannot rewrite the stock ledger either.
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260715_0001"
down_revision = None
branch_labels = None
depends_on = None


MYSQL_OPTIONS = {"mysql_charset": "utf8mb4", "mysql_collate": "utf8mb4_unicode_ci"}


def _enum(*values: str, name: str, length: int) -> sa.Enum:
    return sa.Enum(*values, name=name, native_enum=False, create_constraint=True, length=length)


def upgrade() -> None:
    op.create_table(
        "users",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("username", sa.String(length=64), nullable=False),
        sa.Column("email", sa.String(length=255), nullable=True),
        sa.Column("full_name", sa.String(length=120), nullable=False),
        sa.Column("password_hash", sa.String(length=255), nullable=False),
        sa.Column("role", _enum("admin", "manager", "staff", name="role_type", length=16), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("username"),
        sa.UniqueConstraint("email"),
        **MYSQL_OPTIONS,
    )
    op.create_table(
        "categories",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("name"),
        **MYSQL_OPTIONS,
    )
    op.create_table(
        "products",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(length=180), nullable=False),
        sa.Column("sku", sa.String(length=80), nullable=False),
        sa.Column("barcode", sa.String(length=80), nullable=True),
        sa.Column("category_id", sa.Integer(), nullable=False),
        sa.Column("unit", sa.String(length=32), nullable=False),
        sa.Column("reorder_level", sa.Numeric(precision=16, scale=3), nullable=False),
        sa.Column("default_cost_usd", sa.Numeric(precision=18, scale=4), nullable=False),
        sa.Column("default_sale_price_usd", sa.Numeric(precision=18, scale=4), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.CheckConstraint("reorder_level >= 0", name="ck_products_reorder_level_nonnegative"),
        sa.CheckConstraint("default_cost_usd >= 0", name="ck_products_default_cost_nonnegative"),
        sa.CheckConstraint("default_sale_price_usd >= 0", name="ck_products_default_sale_nonnegative"),
        sa.ForeignKeyConstraint(["category_id"], ["categories.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("sku"),
        sa.UniqueConstraint("barcode"),
        **MYSQL_OPTIONS,
    )
    for table_name in ("suppliers", "customers"):
        op.create_table(
            table_name,
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("name", sa.String(length=180), nullable=False),
            sa.Column("contact_name", sa.String(length=120), nullable=True),
            sa.Column("email", sa.String(length=255), nullable=True),
            sa.Column("phone", sa.String(length=40), nullable=True),
            sa.Column("address", sa.Text(), nullable=True),
            sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.Column("updated_at", sa.DateTime(), nullable=False),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("name"),
            **MYSQL_OPTIONS,
        )
    op.create_table(
        "stock_balances",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("product_id", sa.Integer(), nullable=False),
        sa.Column("quantity", sa.Numeric(precision=16, scale=3), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.CheckConstraint("quantity >= 0", name="ck_stock_balances_quantity_nonnegative"),
        sa.ForeignKeyConstraint(["product_id"], ["products.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("product_id"),
        **MYSQL_OPTIONS,
    )
    op.create_table(
        "purchases",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("document_number", sa.String(length=64), nullable=False),
        sa.Column("supplier_id", sa.Integer(), nullable=False),
        sa.Column("status", _enum("draft", "received", "cancelled", name="purchase_status_type", length=16), nullable=False),
        sa.Column("currency", _enum("USD", "KHR", name="purchase_currency_type", length=8), nullable=False),
        sa.Column("exchange_rate_to_usd", sa.Numeric(precision=18, scale=6), nullable=False),
        sa.Column("total_amount", sa.Numeric(precision=18, scale=2), nullable=False),
        sa.Column("total_usd", sa.Numeric(precision=18, scale=4), nullable=False),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("created_by_id", sa.Integer(), nullable=False),
        sa.Column("received_by_id", sa.Integer(), nullable=True),
        sa.Column("received_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.CheckConstraint("exchange_rate_to_usd > 0", name="ck_purchases_exchange_rate_positive"),
        sa.CheckConstraint("total_amount >= 0", name="ck_purchases_total_amount_nonnegative"),
        sa.CheckConstraint("total_usd >= 0", name="ck_purchases_total_usd_nonnegative"),
        sa.CheckConstraint("currency != 'USD' OR exchange_rate_to_usd = 1", name="ck_purchases_usd_exchange_rate_one"),
        sa.ForeignKeyConstraint(["supplier_id"], ["suppliers.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["created_by_id"], ["users.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["received_by_id"], ["users.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("document_number"),
        **MYSQL_OPTIONS,
    )
    op.create_table(
        "purchase_items",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("purchase_id", sa.Integer(), nullable=False),
        sa.Column("product_id", sa.Integer(), nullable=False),
        sa.Column("quantity", sa.Numeric(precision=16, scale=3), nullable=False),
        sa.Column("unit_price", sa.Numeric(precision=18, scale=2), nullable=False),
        sa.Column("unit_price_usd", sa.Numeric(precision=18, scale=4), nullable=False),
        sa.Column("line_total", sa.Numeric(precision=18, scale=2), nullable=False),
        sa.Column("line_total_usd", sa.Numeric(precision=18, scale=4), nullable=False),
        sa.CheckConstraint("quantity > 0", name="ck_purchase_items_quantity_positive"),
        sa.CheckConstraint("unit_price >= 0", name="ck_purchase_items_unit_price_nonnegative"),
        sa.CheckConstraint("unit_price_usd >= 0", name="ck_purchase_items_unit_price_usd_nonnegative"),
        sa.CheckConstraint("line_total >= 0", name="ck_purchase_items_line_total_nonnegative"),
        sa.CheckConstraint("line_total_usd >= 0", name="ck_purchase_items_line_total_usd_nonnegative"),
        sa.ForeignKeyConstraint(["purchase_id"], ["purchases.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["product_id"], ["products.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("purchase_id", "product_id", name="uq_purchase_items_purchase_product"),
        **MYSQL_OPTIONS,
    )
    op.create_table(
        "sales",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("document_number", sa.String(length=64), nullable=False),
        sa.Column("customer_id", sa.Integer(), nullable=True),
        sa.Column("status", _enum("draft", "completed", "cancelled", name="sale_status_type", length=16), nullable=False),
        sa.Column("currency", _enum("USD", "KHR", name="sale_currency_type", length=8), nullable=False),
        sa.Column("exchange_rate_to_usd", sa.Numeric(precision=18, scale=6), nullable=False),
        sa.Column("total_amount", sa.Numeric(precision=18, scale=2), nullable=False),
        sa.Column("total_usd", sa.Numeric(precision=18, scale=4), nullable=False),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("created_by_id", sa.Integer(), nullable=False),
        sa.Column("completed_by_id", sa.Integer(), nullable=True),
        sa.Column("completed_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.CheckConstraint("exchange_rate_to_usd > 0", name="ck_sales_exchange_rate_positive"),
        sa.CheckConstraint("total_amount >= 0", name="ck_sales_total_amount_nonnegative"),
        sa.CheckConstraint("total_usd >= 0", name="ck_sales_total_usd_nonnegative"),
        sa.CheckConstraint("currency != 'USD' OR exchange_rate_to_usd = 1", name="ck_sales_usd_exchange_rate_one"),
        sa.ForeignKeyConstraint(["customer_id"], ["customers.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["created_by_id"], ["users.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["completed_by_id"], ["users.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("document_number"),
        **MYSQL_OPTIONS,
    )
    op.create_table(
        "sale_items",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("sale_id", sa.Integer(), nullable=False),
        sa.Column("product_id", sa.Integer(), nullable=False),
        sa.Column("quantity", sa.Numeric(precision=16, scale=3), nullable=False),
        sa.Column("unit_price", sa.Numeric(precision=18, scale=2), nullable=False),
        sa.Column("unit_price_usd", sa.Numeric(precision=18, scale=4), nullable=False),
        sa.Column("line_total", sa.Numeric(precision=18, scale=2), nullable=False),
        sa.Column("line_total_usd", sa.Numeric(precision=18, scale=4), nullable=False),
        sa.CheckConstraint("quantity > 0", name="ck_sale_items_quantity_positive"),
        sa.CheckConstraint("unit_price >= 0", name="ck_sale_items_unit_price_nonnegative"),
        sa.CheckConstraint("unit_price_usd >= 0", name="ck_sale_items_unit_price_usd_nonnegative"),
        sa.CheckConstraint("line_total >= 0", name="ck_sale_items_line_total_nonnegative"),
        sa.CheckConstraint("line_total_usd >= 0", name="ck_sale_items_line_total_usd_nonnegative"),
        sa.ForeignKeyConstraint(["sale_id"], ["sales.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["product_id"], ["products.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("sale_id", "product_id", name="uq_sale_items_sale_product"),
        **MYSQL_OPTIONS,
    )
    op.create_table(
        "stock_movements",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("product_id", sa.Integer(), nullable=False),
        sa.Column("movement_type", _enum("purchase_receipt", "sale_issue", "adjustment_in", "adjustment_out", name="stock_movement_type", length=24), nullable=False),
        sa.Column("quantity_delta", sa.Numeric(precision=16, scale=3), nullable=False),
        sa.Column("unit_cost_usd", sa.Numeric(precision=18, scale=4), nullable=False),
        sa.Column("reason", sa.String(length=255), nullable=True),
        sa.Column("purchase_id", sa.Integer(), nullable=True),
        sa.Column("sale_id", sa.Integer(), nullable=True),
        sa.Column("created_by_id", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.CheckConstraint("quantity_delta != 0", name="ck_stock_movements_quantity_nonzero"),
        sa.CheckConstraint("unit_cost_usd >= 0", name="ck_stock_movements_unit_cost_nonnegative"),
        sa.ForeignKeyConstraint(["product_id"], ["products.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["purchase_id"], ["purchases.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["sale_id"], ["sales.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["created_by_id"], ["users.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
        **MYSQL_OPTIONS,
    )
    op.create_index("ix_stock_movements_product_created", "stock_movements", ["product_id", "created_at"])
    if op.get_bind().dialect.name == "mysql":
        op.execute("CREATE TRIGGER stock_movements_no_update BEFORE UPDATE ON stock_movements FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'stock movements are append-only'")
        op.execute("CREATE TRIGGER stock_movements_no_delete BEFORE DELETE ON stock_movements FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'stock movements are append-only'")


def downgrade() -> None:
    if op.get_bind().dialect.name == "mysql":
        op.execute("DROP TRIGGER IF EXISTS stock_movements_no_delete")
        op.execute("DROP TRIGGER IF EXISTS stock_movements_no_update")
    for table_name in ("stock_movements", "sale_items", "sales", "purchase_items", "purchases", "stock_balances", "customers", "suppliers", "products", "categories", "users"):
        op.drop_table(table_name)
