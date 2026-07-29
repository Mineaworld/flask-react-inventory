from __future__ import annotations

from decimal import Decimal

import pytest

from inventory import create_app
from inventory.extensions import db
from inventory.models import Category, Product, Purchase, PurchaseStatus, Sale, SaleStatus, StockBalance, StockMovement, User


@pytest.fixture()
def app():
    app = create_app(
        {
            "TESTING": True,
            "WTF_CSRF_ENABLED": False,
            "SQLALCHEMY_DATABASE_URI": "sqlite+pysqlite:///:memory:",
        }
    )
    with app.app_context():
        db.create_all()
        yield app
        db.session.remove()
        db.drop_all()


@pytest.mark.filterwarnings("error:Object of type .*Item.* not in session:sqlalchemy.exc.SAWarning")
def test_seed_demo_creates_idempotent_workflow_data_without_echoing_password(app) -> None:
    runner = app.test_cli_runner()

    first = runner.invoke(args=["seed-demo", "--password", "demo-password"])

    assert first.exit_code == 0, first.output
    assert "demo-password" not in first.output
    with app.app_context():
        users = {user.username: user for user in db.session.scalars(db.select(User)).all()}
        assert set(users) == {"demo-admin", "demo-manager", "demo-staff"}
        assert users["demo-admin"].check_password("demo-password")
        assert {user.role.value for user in users.values()} == {"admin", "manager", "staff"}
        assert db.session.scalar(db.select(db.func.count()).select_from(Category)) == 2
        assert db.session.scalar(db.select(db.func.count()).select_from(Product)) == 2
        assert db.session.scalar(db.select(db.func.count()).select_from(Purchase)) == 1
        assert db.session.scalar(db.select(Purchase.status)) is PurchaseStatus.RECEIVED
        assert db.session.scalar(db.select(db.func.count()).select_from(Sale)) == 1
        assert db.session.scalar(db.select(Sale.status)) is SaleStatus.COMPLETED
        assert db.session.scalar(db.select(db.func.count()).select_from(StockMovement)) == 4
        assert db.session.scalar(db.select(StockBalance.quantity).where(StockBalance.product_id == 1)) == Decimal("15.000")

    second = runner.invoke(args=["seed-demo", "--password", "new-demo-password"])

    assert second.exit_code == 0, second.output
    assert "new-demo-password" not in second.output
    with app.app_context():
        users = {user.username: user for user in db.session.scalars(db.select(User)).all()}
        assert all(user.check_password("new-demo-password") for user in users.values())
        assert all(user.is_active for user in users.values())
        assert users["demo-admin"].full_name == "Sokha Chan"
        assert users["demo-manager"].full_name == "Dara Lim"
        assert users["demo-staff"].full_name == "Vannak Chea"
        assert db.session.scalar(db.select(db.func.count()).select_from(Product)) == 2
        assert db.session.scalar(db.select(db.func.count()).select_from(Purchase)) == 1
        assert db.session.scalar(db.select(db.func.count()).select_from(Sale)) == 1
        assert db.session.scalar(db.select(db.func.count()).select_from(StockMovement)) == 4
