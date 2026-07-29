"""Optional integration coverage for the real MySQL migration contract."""

from __future__ import annotations

import os
from decimal import Decimal
from pathlib import Path

import pytest
from dotenv import load_dotenv
from flask_migrate import downgrade, upgrade
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.engine import make_url
from sqlalchemy.exc import ArgumentError
from sqlalchemy.exc import SQLAlchemyError

from inventory import create_app
from inventory.extensions import db
from inventory.models import User
from inventory.services import dashboard_data


pytestmark = pytest.mark.mysql


def _guard_test_database_urls(test_url: str, app_url: str) -> str:
    """Reject integration-test URLs that could target the application database."""
    try:
        test_database = make_url(test_url)
    except ArgumentError as error:
        raise ValueError("TEST_DATABASE_URL must be a valid SQLAlchemy URL.") from error
    if test_database.drivername.casefold() != "mysql+mysqldb":
        raise ValueError("TEST_DATABASE_URL must be a MySQL mysqlclient URL.")
    if not test_database.database:
        raise ValueError("TEST_DATABASE_URL must include a database name.")

    try:
        application_database = make_url(app_url)
    except ArgumentError as error:
        raise ValueError("DATABASE_URL must be a valid SQLAlchemy URL.") from error
    if not application_database.database:
        raise ValueError("DATABASE_URL must include a database name.")

    test_name = test_database.database
    if test_name.casefold() == application_database.database.casefold():
        raise ValueError("TEST_DATABASE_URL must not name the same database as DATABASE_URL.")
    if not test_name.casefold().endswith("_test"):
        raise ValueError("TEST_DATABASE_URL database name must end with '_test'.")
    return test_name


def test_mysql_test_database_guard_accepts_a_separate_dedicated_database() -> None:
    assert _guard_test_database_urls(
        "mysql+mysqldb://test-user:password@127.0.0.1:3307/inventorysystem_test?charset=utf8mb4",
        "mysql+mysqldb://app-user:password@127.0.0.1:3307/inventorysystem?charset=utf8mb4",
    ) == "inventorysystem_test"


def test_mysql_test_database_guard_compares_database_names_case_insensitively() -> None:
    with pytest.raises(ValueError, match="must not name the same database"):
        _guard_test_database_urls(
            "mysql+mysqldb://test-user:password@127.0.0.1:3307/InventorySystem_Test?charset=utf8mb4",
            "mysql+mysqldb://app-user:password@127.0.0.1:3307/inventorysystem_test?charset=utf8mb4",
        )


@pytest.mark.parametrize(
    ("test_url", "app_url", "message"),
    [
        (
            "mysql+mysqldb://root@127.0.0.1:3307/inventorysystem?charset=utf8mb4",
            "mysql+mysqldb://root@127.0.0.1:3307/inventorysystem?charset=utf8mb4",
            "must not name the same database",
        ),
        (
            "mysql+mysqldb://root@127.0.0.1:3307/inventory_scratch?charset=utf8mb4",
            "mysql+mysqldb://root@127.0.0.1:3307/inventorysystem?charset=utf8mb4",
            "must end with '_test'",
        ),
        (
            "mysql+pymysql://root@127.0.0.1:3307/inventorysystem_test?charset=utf8mb4",
            "mysql+mysqldb://root@127.0.0.1:3307/inventorysystem?charset=utf8mb4",
            "must be a MySQL mysqlclient URL",
        ),
    ],
)
def test_mysql_test_database_guard_rejects_unsafe_database_names(
    test_url: str, app_url: str, message: str
) -> None:
    with pytest.raises(ValueError, match=message):
        _guard_test_database_urls(test_url, app_url)


def _test_database_url() -> str:
    load_dotenv(Path(__file__).resolve().parents[1] / ".env")
    database_url = os.getenv("TEST_DATABASE_URL", "").strip()
    if not database_url:
        pytest.skip("TEST_DATABASE_URL is not configured.")
    _guard_test_database_urls(database_url, os.getenv("DATABASE_URL", "").strip())
    return database_url


@pytest.fixture(scope="module")
def mysql_app():
    database_url = _test_database_url()
    engine = create_engine(database_url, pool_pre_ping=True)
    try:
        with engine.connect() as connection:
            connection.execute(text("SELECT 1"))
    except SQLAlchemyError as error:
        engine.dispose()
        pytest.skip(f"MySQL test database is unreachable: {error}")

    app = create_app(
        {
            "TESTING": True,
            "WTF_CSRF_ENABLED": False,
            "SQLALCHEMY_DATABASE_URI": database_url,
        }
    )
    migration_dir = str(Path(__file__).resolve().parents[1] / "migrations")

    with app.app_context():
        # The documented test database is dedicated, so reset it before proving upgrade behavior.
        if "alembic_version" in inspect(engine).get_table_names():
            downgrade(directory=migration_dir, revision="base")
        upgrade(directory=migration_dir, revision="head")
        yield app
        db.session.remove()
        downgrade(directory=migration_dir, revision="base")
    engine.dispose()


def test_mysql_migration_supports_khmer_and_blocks_direct_ledger_mutation(mysql_app) -> None:
    with mysql_app.app_context():
        db.session.execute(
            text(
                """
                INSERT INTO users (username, full_name, password_hash, role, is_active, created_at, updated_at)
                VALUES ('mysql-admin', 'MySQL Admin', 'not-used-in-this-test', 'admin', 1, UTC_TIMESTAMP(), UTC_TIMESTAMP())
                """
            )
        )
        db.session.execute(
            text(
                """
                INSERT INTO categories (name, description, is_active, created_at, updated_at)
                VALUES (:name, 'utf8mb4 migration verification', 1, UTC_TIMESTAMP(), UTC_TIMESTAMP())
                """
            ),
            {"name": "សម្ភារៈការិយាល័យ"},
        )
        user_id = db.session.scalar(text("SELECT id FROM users WHERE username = 'mysql-admin'"))
        category_id = db.session.scalar(text("SELECT id FROM categories WHERE name = :name"), {"name": "សម្ភារៈការិយាល័យ"})
        db.session.execute(
            text(
                """
                INSERT INTO products (
                    name, sku, category_id, unit, reorder_level, default_cost_usd,
                    default_sale_price_usd, is_active, created_at, updated_at
                ) VALUES (
                    'Khmer notebook', 'MYSQL-KH-001', :category_id, 'piece', 0,
                    1.2500, 2.0000, 1, UTC_TIMESTAMP(), UTC_TIMESTAMP()
                )
                """
            ),
            {"category_id": category_id},
        )
        product_id = db.session.scalar(text("SELECT id FROM products WHERE sku = 'MYSQL-KH-001'"))
        db.session.execute(
            text(
                """
                INSERT INTO stock_movements (
                    product_id, movement_type, quantity_delta, unit_cost_usd, created_by_id, created_at
                ) VALUES (:product_id, 'adjustment_in', 1.000, 1.2500, :user_id, UTC_TIMESTAMP())
                """
            ),
            {"product_id": product_id, "user_id": user_id},
        )
        db.session.commit()

        movement_id = db.session.scalar(text("SELECT id FROM stock_movements LIMIT 1"))
        assert db.session.scalar(text("SELECT name FROM categories WHERE id = :category_id"), {"category_id": category_id}) == "សម្ភារៈការិយាល័យ"

        with pytest.raises(SQLAlchemyError):
            db.session.execute(
                text("UPDATE stock_movements SET reason = 'direct rewrite' WHERE id = :movement_id"),
                {"movement_id": movement_id},
            )
        db.session.rollback()

        with pytest.raises(SQLAlchemyError):
            db.session.execute(text("DELETE FROM stock_movements WHERE id = :movement_id"), {"movement_id": movement_id})
        db.session.rollback()


def test_mysql_dashboard_preserves_maximum_decimal_stock_valuation(mysql_app) -> None:
    quantity = Decimal("9999999999999.999")
    cost = Decimal("99999999999999.9999")
    expected_value = Decimal("999999999999999899000000000.0000")

    with mysql_app.app_context():
        db.session.execute(
            text(
                """
                INSERT INTO users (username, full_name, password_hash, role, is_active, created_at, updated_at)
                VALUES ('mysql-precision-manager', 'MySQL Precision Manager', 'not-used-in-this-test', 'manager', 1, UTC_TIMESTAMP(), UTC_TIMESTAMP())
                """
            )
        )
        db.session.execute(
            text(
                """
                INSERT INTO categories (name, is_active, created_at, updated_at)
                VALUES ('MySQL precision verification', 1, UTC_TIMESTAMP(), UTC_TIMESTAMP())
                """
            )
        )
        category_id = db.session.scalar(
            text("SELECT id FROM categories WHERE name = 'MySQL precision verification'")
        )
        db.session.execute(
            text(
                """
                INSERT INTO products (
                    name, sku, category_id, unit, reorder_level, default_cost_usd,
                    default_sale_price_usd, is_active, created_at, updated_at
                ) VALUES (
                    'Maximum precision product', 'MYSQL-MAX-PRECISION-001', :category_id, 'piece', 0.000, :cost,
                    :cost, 1, UTC_TIMESTAMP(), UTC_TIMESTAMP()
                )
                """
            ),
            {"category_id": category_id, "cost": cost},
        )
        product_id = db.session.scalar(
            text("SELECT id FROM products WHERE sku = 'MYSQL-MAX-PRECISION-001'")
        )
        db.session.execute(
            text(
                """
                INSERT INTO stock_balances (product_id, quantity, updated_at)
                VALUES (:product_id, :quantity, UTC_TIMESTAMP())
                """
            ),
            {"product_id": product_id, "quantity": quantity},
        )
        db.session.commit()

        manager = db.session.scalar(db.select(User).where(User.username == "mysql-precision-manager"))
        assert manager is not None
        dashboard = dashboard_data(manager)

    assert dashboard["stock_value_usd"] == expected_value
    assert format(dashboard["stock_value_usd"], ".4f") == "999999999999999899000000000.0000"


def test_mysql_migration_downgrade_removes_inventory_schema(mysql_app) -> None:
    migration_dir = str(Path(__file__).resolve().parents[1] / "migrations")
    expected_tables = {
        "users",
        "categories",
        "products",
        "suppliers",
        "customers",
        "stock_balances",
        "purchases",
        "purchase_items",
        "sales",
        "sale_items",
        "stock_movements",
    }

    with mysql_app.app_context():
        downgrade(directory=migration_dir, revision="base")
        upgrade(directory=migration_dir, revision="head")
        assert expected_tables.issubset(inspect(db.engine).get_table_names())

        table_collations = dict(
            db.session.execute(
                text(
                    """
                    SELECT TABLE_NAME, TABLE_COLLATION
                    FROM information_schema.TABLES
                    WHERE TABLE_SCHEMA = DATABASE()
                      AND TABLE_NAME IN (
                          'users', 'categories', 'products', 'suppliers', 'customers',
                          'stock_balances', 'purchases', 'purchase_items', 'sales',
                          'sale_items', 'stock_movements'
                      )
                    """
                )
            ).all()
        )
        assert set(table_collations) == expected_tables
        assert all(collation and collation.startswith("utf8mb4_") for collation in table_collations.values())

        trigger_names = set(
            db.session.scalars(
                text(
                    """
                    SELECT TRIGGER_NAME
                    FROM information_schema.TRIGGERS
                    WHERE TRIGGER_SCHEMA = DATABASE()
                      AND EVENT_OBJECT_TABLE = 'stock_movements'
                    """
                )
            )
        )
        assert {"stock_movements_no_update", "stock_movements_no_delete"}.issubset(trigger_names)

        db.session.execute(
            text(
                """
                INSERT INTO users (username, full_name, password_hash, role, is_active, created_at, updated_at)
                VALUES ('reupgrade-admin', 'Reupgrade Admin', 'not-used-in-this-test', 'admin', 1, UTC_TIMESTAMP(), UTC_TIMESTAMP())
                """
            )
        )
        db.session.execute(
            text(
                """
                INSERT INTO categories (name, is_active, created_at, updated_at)
                VALUES ('Reupgrade verification', 1, UTC_TIMESTAMP(), UTC_TIMESTAMP())
                """
            )
        )
        user_id = db.session.scalar(text("SELECT id FROM users WHERE username = 'reupgrade-admin'"))
        category_id = db.session.scalar(text("SELECT id FROM categories WHERE name = 'Reupgrade verification'"))
        db.session.execute(
            text(
                """
                INSERT INTO products (
                    name, sku, category_id, unit, reorder_level, default_cost_usd,
                    default_sale_price_usd, is_active, created_at, updated_at
                ) VALUES (
                    'Reupgrade ledger product', 'REUPGRADE-LEDGER-001', :category_id, 'piece', 0,
                    1.2500, 2.0000, 1, UTC_TIMESTAMP(), UTC_TIMESTAMP()
                )
                """
            ),
            {"category_id": category_id},
        )
        product_id = db.session.scalar(text("SELECT id FROM products WHERE sku = 'REUPGRADE-LEDGER-001'"))
        db.session.execute(
            text(
                """
                INSERT INTO stock_movements (
                    product_id, movement_type, quantity_delta, unit_cost_usd, created_by_id, created_at
                ) VALUES (:product_id, 'adjustment_in', 1.000, 1.2500, :user_id, UTC_TIMESTAMP())
                """
            ),
            {"product_id": product_id, "user_id": user_id},
        )
        db.session.commit()
        movement_id = db.session.scalar(text("SELECT id FROM stock_movements WHERE product_id = :product_id"), {"product_id": product_id})

        with pytest.raises(SQLAlchemyError):
            db.session.execute(
                text("UPDATE stock_movements SET reason = 'direct rewrite' WHERE id = :movement_id"),
                {"movement_id": movement_id},
            )
        db.session.rollback()

        with pytest.raises(SQLAlchemyError):
            db.session.execute(text("DELETE FROM stock_movements WHERE id = :movement_id"), {"movement_id": movement_id})
        db.session.rollback()

        downgrade(directory=migration_dir, revision="base")

        remaining_tables = set(inspect(db.engine).get_table_names())

    assert expected_tables.isdisjoint(remaining_tables)
