from __future__ import annotations

from datetime import datetime, timedelta, timezone
from decimal import Decimal

import pytest
from sqlalchemy.exc import IntegrityError

from inventory import create_app
from inventory.extensions import db
from inventory.models import (
    AppendOnlyLedgerError,
    Category,
    Product,
    Purchase,
    Sale,
    StockBalance,
    StockMovement,
    StockMovementType,
    User,
)


@pytest.fixture()
def app():
    app = create_app({
        "TESTING": True,
        "WTF_CSRF_ENABLED": False,
        "SQLALCHEMY_DATABASE_URI": "sqlite+pysqlite:///:memory:",
    })
    with app.app_context():
        db.create_all()
        yield app
        db.session.remove()
        db.drop_all()


def test_product_does_not_expose_editable_quantity_field() -> None:
    assert "quantity" not in Product.__table__.columns


def test_purchase_and_sale_currency_constraints_have_distinct_names() -> None:
    assert Purchase.__table__.c.currency.type.name != Sale.__table__.c.currency.type.name


def test_product_sku_must_be_unique(app) -> None:
    with app.app_context():
        category = Category(name="Office")
        db.session.add(category)
        db.session.flush()
        db.session.add_all(
            [
                Product(
                    name="Notebook",
                    sku="NB-001",
                    category_id=category.id,
                    unit="piece",
                    default_cost_usd=Decimal("1.25"),
                    default_sale_price_usd=Decimal("2.00"),
                ),
                Product(
                    name="Duplicate Notebook",
                    sku="NB-001",
                    category_id=category.id,
                    unit="piece",
                    default_cost_usd=Decimal("1.25"),
                    default_sale_price_usd=Decimal("2.00"),
                ),
            ]
        )

        with pytest.raises(IntegrityError):
            db.session.commit()


def test_stock_balance_requires_one_record_per_product(app) -> None:
    with app.app_context():
        category = Category(name="Office")
        product = Product(
            name="Notebook",
            sku="NB-002",
            category=category,
            unit="piece",
            default_cost_usd=Decimal("1.25"),
            default_sale_price_usd=Decimal("2.00"),
        )
        db.session.add(product)
        db.session.flush()
        db.session.add_all(
            [
                StockBalance(product_id=product.id, quantity=Decimal("5.000")),
                StockBalance(product_id=product.id, quantity=Decimal("2.000")),
            ]
        )

        with pytest.raises(IntegrityError):
            db.session.commit()


def test_user_password_is_hashed_and_verifiable(app) -> None:
    with app.app_context():
        user = User(username="admin", full_name="Admin User", role="admin")
        user.set_password("safe-demo-password")

        assert user.password_hash != "safe-demo-password"
        assert user.check_password("safe-demo-password") is True
        assert user.check_password("wrong-password") is False


def test_persisted_stock_movements_reject_updates_and_deletes(app) -> None:
    with app.app_context():
        category = Category(name="Office")
        product = Product(
            name="Notebook",
            sku="NB-003",
            category=category,
            unit="piece",
            default_cost_usd=Decimal("1.25"),
            default_sale_price_usd=Decimal("2.00"),
        )
        user = User(username="manager", full_name="Manager", role="manager")
        user.set_password("safe-demo-password")
        movement = StockMovement(
            product=product,
            movement_type=StockMovementType.ADJUSTMENT_IN,
            quantity_delta=Decimal("2.000"),
            unit_cost_usd=Decimal("1.25"),
            created_by=user,
        )
        db.session.add(movement)
        db.session.commit()

        movement.reason = "attempted rewrite"
        with pytest.raises(AppendOnlyLedgerError, match="append-only"):
            db.session.commit()
        db.session.rollback()

        db.session.delete(movement)
        with pytest.raises(AppendOnlyLedgerError, match="append-only"):
            db.session.commit()
        db.session.rollback()


def test_timestamps_are_normalized_to_utc_on_round_trip(app) -> None:
    with app.app_context():
        bangkok_time = datetime(2026, 7, 14, 17, 30, tzinfo=timezone(timedelta(hours=7)))
        category = Category(name="Timestamped", created_at=bangkok_time)
        db.session.add(category)
        db.session.commit()
        category_id = category.id
        db.session.expunge_all()

        persisted_category = db.session.get(Category, category_id)

        assert persisted_category is not None
        assert persisted_category.created_at == datetime(2026, 7, 14, 10, 30, tzinfo=timezone.utc)
        assert persisted_category.created_at.tzinfo == timezone.utc
