from __future__ import annotations

from datetime import datetime, timedelta, timezone
from decimal import Decimal
from zoneinfo import ZoneInfo

import pytest

from inventory import create_app
from inventory.extensions import db
from inventory.models import Product, Purchase, Sale, StockBalance, StockMovement, User, utc_now
from inventory.services import cambodia_period_bounds


@pytest.fixture()
def app():
    app = create_app(
        {
            "TESTING": True,
            "WTF_CSRF_ENABLED": True,
            "RATELIMIT_ENABLED": True,
            "SQLALCHEMY_DATABASE_URI": "sqlite+pysqlite:///:memory:",
        }
    )
    with app.app_context():
        db.create_all()
        for username, role in (("admin", "admin"), ("manager", "manager"), ("staff", "staff")):
            user = User(username=username, full_name=username.title(), role=role)
            user.set_password("demo-password")
            db.session.add(user)
        db.session.commit()
        yield app
        db.session.remove()
        db.drop_all()


def csrf_token(client) -> str:
    response = client.get("/api/v1/auth/csrf")
    assert response.status_code == 200
    return response.get_json()["data"]["csrf_token"]


def csrf_headers(client) -> dict[str, str]:
    return {"X-CSRFToken": csrf_token(client)}


def login(client, username: str) -> None:
    response = client.post(
        "/api/v1/auth/login",
        json={"username": username, "password": "demo-password"},
        headers=csrf_headers(client),
    )
    assert response.status_code == 200, response.get_json()


def create_catalog(client) -> tuple[int, int]:
    category = client.post("/api/v1/categories", json={"name": "Office"}, headers=csrf_headers(client))
    assert category.status_code == 201, category.get_json()
    product = client.post(
        "/api/v1/products",
        json={
            "name": "Notebook",
            "sku": "NB-001",
            "category_id": category.get_json()["data"]["id"],
            "unit": "piece",
            "reorder_level": "3",
            "default_cost_usd": "1.25",
            "default_sale_price_usd": "2.00",
        },
        headers=csrf_headers(client),
    )
    assert product.status_code == 201, product.get_json()
    return category.get_json()["data"]["id"], product.get_json()["data"]["id"]


def create_partner(client, resource: str, name: str) -> int:
    response = client.post(f"/api/v1/{resource}", json={"name": name}, headers=csrf_headers(client))
    assert response.status_code == 201, response.get_json()
    return response.get_json()["data"]["id"]


def test_partner_email_is_validated_by_the_api(app) -> None:
    client = app.test_client()
    login(client, "manager")

    response = client.post(
        "/api/v1/suppliers",
        json={"name": "Phnom Penh Office Supply", "email": "not-an-email"},
        headers=csrf_headers(client),
    )

    assert response.status_code == 400
    assert response.get_json()["error"]["fields"] == {"email": "Enter a valid email address."}


def receive_khr_purchase(client, product_id: int, supplier_id: int, quantity: str = "5") -> int:
    purchase = client.post(
        "/api/v1/purchases",
        json={
            "supplier_id": supplier_id,
            "currency": "KHR",
            "exchange_rate_to_usd": "4100",
            "items": [{"product_id": product_id, "quantity": quantity, "unit_cost": "41000"}],
        },
        headers=csrf_headers(client),
    )
    assert purchase.status_code == 201, purchase.get_json()
    purchase_id = purchase.get_json()["data"]["id"]
    response = client.post(f"/api/v1/purchases/{purchase_id}/receive", headers=csrf_headers(client))
    assert response.status_code == 200, response.get_json()
    return purchase_id


def test_auth_login_requires_csrf_and_exposes_safe_session_user(app) -> None:
    client = app.test_client()

    rejected = client.post("/api/v1/auth/login", json={"username": "admin", "password": "demo-password"})
    assert rejected.status_code == 400
    assert rejected.get_json()["error"]["code"] == "csrf_failed"

    login(client, "admin")
    me = client.get("/api/v1/auth/me")
    assert me.status_code == 200
    assert me.get_json()["data"] == {
        "id": 1,
        "username": "admin",
        "full_name": "Admin",
        "role": "admin",
    }

    logout = client.post("/api/v1/auth/logout", headers=csrf_headers(client))
    assert logout.status_code == 200
    assert client.get("/api/v1/auth/me").status_code == 401


def test_deactivated_user_session_is_cleared_and_denied(app) -> None:
    client = app.test_client()
    login(client, "admin")

    user = db.session.scalar(db.select(User).where(User.username == "admin"))
    assert user is not None
    user.is_active = False
    db.session.commit()

    denied = client.get("/api/v1/products")

    assert denied.status_code == 401
    assert denied.get_json()["error"] == {
        "code": "authentication_required",
        "message": "Authentication is required.",
    }
    with client.session_transaction() as session:
        assert "_user_id" not in session


def test_catalog_roles_reject_direct_quantity_and_validate_casefolded_sku(app) -> None:
    client = app.test_client()
    login(client, "staff")
    denied = client.post("/api/v1/categories", json={"name": "Forbidden"}, headers=csrf_headers(client))
    assert denied.status_code == 403
    assert denied.get_json()["error"]["code"] == "forbidden"

    login(client, "manager")
    category_id, _ = create_catalog(client)
    direct_quantity = client.post(
        "/api/v1/products",
        json={
            "name": "Pen",
            "sku": "PEN-001",
            "category_id": category_id,
            "unit": "piece",
            "reorder_level": "1",
            "default_cost_usd": "1",
            "default_sale_price_usd": "2",
            "quantity": "999",
        },
        headers=csrf_headers(client),
    )
    assert direct_quantity.status_code == 400
    assert direct_quantity.get_json()["error"]["fields"] == {"quantity": "Stock is changed through inventory workflows only."}

    duplicate = client.post(
        "/api/v1/products",
        json={
            "name": "Notebook copy",
            "sku": "nb-001",
            "category_id": category_id,
            "unit": "piece",
            "reorder_level": "1",
            "default_cost_usd": "1",
            "default_sale_price_usd": "2",
        },
        headers=csrf_headers(client),
    )
    assert duplicate.status_code == 400
    assert duplicate.get_json()["error"]["fields"] == {"sku": "SKU is already in use."}

    login(client, "staff")
    listing = client.get("/api/v1/products?page=1&per_page=1&q=note&sort=name&direction=asc")
    assert listing.status_code == 200
    assert listing.get_json()["meta"] == {"page": 1, "per_page": 1, "total": 1, "pages": 1}
    assert listing.get_json()["data"][0]["sku"] == "NB-001"


def test_khr_purchase_locks_usd_values_and_receipt_writes_stock_ledger(app) -> None:
    client = app.test_client()
    login(client, "manager")
    _, product_id = create_catalog(client)
    supplier_id = create_partner(client, "suppliers", "Paper House")

    purchase = client.post(
        "/api/v1/purchases",
        json={
            "supplier_id": supplier_id,
            "currency": "KHR",
            "exchange_rate_to_usd": "4100",
            "items": [{"product_id": product_id, "quantity": "2", "unit_cost": "41000"}],
        },
        headers=csrf_headers(client),
    )
    assert purchase.status_code == 201, purchase.get_json()
    body = purchase.get_json()["data"]
    assert body["total_usd"] == "20.0000"
    assert body["items"][0]["unit_cost_usd"] == "10.0000"

    received = client.post(f"/api/v1/purchases/{body['id']}/receive", headers=csrf_headers(client))
    assert received.status_code == 200

    with app.app_context():
        assert db.session.scalar(db.select(StockBalance.quantity).where(StockBalance.product_id == product_id)) == Decimal("2.000")
        movement = db.session.scalar(db.select(StockMovement).where(StockMovement.product_id == product_id))
        assert movement is not None
        assert movement.movement_type.value == "purchase_receipt"
        assert movement.quantity_delta == Decimal("2.000")
        assert movement.unit_cost_usd == Decimal("10.0000")


def test_completed_manager_sale_deducts_stock_and_staff_cannot_complete(app) -> None:
    client = app.test_client()
    login(client, "manager")
    _, product_id = create_catalog(client)
    supplier_id = create_partner(client, "suppliers", "Paper House")
    customer_id = create_partner(client, "customers", "Campus Store")
    receive_khr_purchase(client, product_id, supplier_id)

    sale = client.post(
        "/api/v1/sales",
        json={
            "customer_id": customer_id,
            "currency": "USD",
            "exchange_rate_to_usd": "1",
            "items": [{"product_id": product_id, "quantity": "2", "unit_price": "3.50"}],
        },
        headers=csrf_headers(client),
    )
    assert sale.status_code == 201, sale.get_json()
    completed = client.post(f"/api/v1/sales/{sale.get_json()['data']['id']}/complete", headers=csrf_headers(client))
    assert completed.status_code == 200, completed.get_json()

    with app.app_context():
        balance = db.session.scalar(db.select(StockBalance).where(StockBalance.product_id == product_id))
        assert balance is not None
        assert balance.quantity == Decimal("3.000")

    login(client, "staff")
    staff_sale = client.post(
        "/api/v1/sales",
        json={
            "customer_id": customer_id,
            "currency": "USD",
            "exchange_rate_to_usd": "1",
            "items": [{"product_id": product_id, "quantity": "1", "unit_price": "3.50"}],
        },
        headers=csrf_headers(client),
    )
    assert staff_sale.status_code == 201
    forbidden = client.post(f"/api/v1/sales/{staff_sale.get_json()['data']['id']}/complete", headers=csrf_headers(client))
    assert forbidden.status_code == 403
    assert forbidden.get_json()["error"]["code"] == "forbidden"


def test_insufficient_sale_rolls_back_balance_and_movements(app) -> None:
    client = app.test_client()
    login(client, "manager")
    _, product_id = create_catalog(client)
    supplier_id = create_partner(client, "suppliers", "Paper House")
    receive_khr_purchase(client, product_id, supplier_id, quantity="1")

    sale = client.post(
        "/api/v1/sales",
        json={
            "currency": "USD",
            "exchange_rate_to_usd": "1",
            "items": [{"product_id": product_id, "quantity": "2", "unit_price": "3.50"}],
        },
        headers=csrf_headers(client),
    )
    assert sale.status_code == 201
    failed = client.post(f"/api/v1/sales/{sale.get_json()['data']['id']}/complete", headers=csrf_headers(client))
    assert failed.status_code == 409
    assert failed.get_json()["error"]["code"] == "insufficient_stock"

    with app.app_context():
        balance = db.session.scalar(db.select(StockBalance).where(StockBalance.product_id == product_id))
        assert balance is not None
        assert balance.quantity == Decimal("1.000")
        assert db.session.scalar(db.select(db.func.count()).select_from(StockMovement)) == 1


def test_inventory_adjustment_and_dashboard_use_persisted_records(app) -> None:
    client = app.test_client()
    login(client, "manager")
    _, product_id = create_catalog(client)
    supplier_id = create_partner(client, "suppliers", "Paper House")
    receive_khr_purchase(client, product_id, supplier_id, quantity="2")

    adjustment = client.post(
        "/api/v1/inventory/adjustments",
        json={"product_id": product_id, "quantity": "1", "direction": "out", "reason": "Damaged"},
        headers=csrf_headers(client),
    )
    assert adjustment.status_code == 201, adjustment.get_json()
    assert adjustment.get_json()["data"]["quantity_delta"] == "-1.000"

    dashboard = client.get("/api/v1/dashboard")
    assert dashboard.status_code == 200
    data = dashboard.get_json()["data"]
    assert data["stock_value_usd"] == "1.2500"
    assert data["low_stock_count"] == 1
    assert data["low_stock"][0]["product_id"] == product_id
    assert len(data["latest_movements"]) == 2


def test_dashboard_rejects_an_unsupported_range(app) -> None:
    client = app.test_client()
    login(client, "manager")

    response = client.get("/api/v1/dashboard?range=quarter")

    assert response.status_code == 400
    assert response.get_json()["error"] == {
        "code": "validation_error",
        "message": "Request validation failed.",
        "fields": {"range": "Must be today, week, or month."},
    }


def test_dashboard_week_range_uses_persisted_documents_and_zero_fills_activity(app) -> None:
    client = app.test_client()
    login(client, "manager")
    _, product_id = create_catalog(client)
    supplier_id = create_partner(client, "suppliers", "Paper House")
    customer_id = create_partner(client, "customers", "Campus Store")
    purchase_id = receive_khr_purchase(client, product_id, supplier_id, quantity="2")

    sale = client.post(
        "/api/v1/sales",
        json={
            "customer_id": customer_id,
            "currency": "USD",
            "exchange_rate_to_usd": "1",
            "items": [{"product_id": product_id, "quantity": "1", "unit_price": "7"}],
        },
        headers=csrf_headers(client),
    )
    assert sale.status_code == 201, sale.get_json()
    sale_id = sale.get_json()["data"]["id"]
    assert client.post(f"/api/v1/sales/{sale_id}/complete", headers=csrf_headers(client)).status_code == 200

    now = utc_now()
    with app.app_context():
        purchase = db.session.get(Purchase, purchase_id)
        completed_sale = db.session.get(Sale, sale_id)
        assert purchase is not None
        assert completed_sale is not None
        purchase.received_at = now - timedelta(days=2)
        completed_sale.completed_at = now - timedelta(days=1)
        db.session.commit()

    response = client.get("/api/v1/dashboard?range=week")

    assert response.status_code == 200
    data = response.get_json()["data"]
    assert data["period_days"] == 7
    assert data["sales_total_usd"] == "7.0000"
    assert data["purchases_total_usd"] == "20.0000"
    assert "sales_total_usd_last_30_days" not in data
    assert "purchases_total_usd_last_30_days" not in data
    cambodia_today = now.astimezone(ZoneInfo("Asia/Phnom_Penh")).date()
    expected_dates = [(cambodia_today - timedelta(days=offset)).isoformat() for offset in range(6, -1, -1)]
    assert [entry["date"] for entry in data["activity"]] == expected_dates
    assert data["activity"][-3] == {"date": expected_dates[-3], "sales_usd": "0.0000", "purchases_usd": "20.0000"}
    assert data["activity"][-2] == {"date": expected_dates[-2], "sales_usd": "7.0000", "purchases_usd": "0.0000"}
    assert data["activity"][-1] == {"date": expected_dates[-1], "sales_usd": "0.0000", "purchases_usd": "0.0000"}


def test_dashboard_day_uses_cambodia_midnight_boundaries() -> None:
    now = datetime(2026, 7, 15, 20, 0, tzinfo=timezone.utc)

    today, period_start, period_end = cambodia_period_bounds(1, now)

    assert today.isoformat() == "2026-07-16"
    assert period_start == datetime(2026, 7, 15, 17, 0, tzinfo=timezone.utc)
    assert period_end == datetime(2026, 7, 16, 17, 0, tzinfo=timezone.utc)


def test_dashboard_defaults_to_the_legacy_month_fields(app) -> None:
    client = app.test_client()
    login(client, "manager")

    response = client.get("/api/v1/dashboard")

    assert response.status_code == 200
    data = response.get_json()["data"]
    assert data["period_days"] == 30
    assert data["sales_total_usd"] == "0.0000"
    assert data["purchases_total_usd"] == "0.0000"
    assert data["sales_total_usd_last_30_days"] == "0.0000"
    assert data["purchases_total_usd_last_30_days"] == "0.0000"
    assert len(data["activity"]) == 30


def test_staff_dashboard_exposes_period_without_financial_or_global_data(app) -> None:
    client = app.test_client()
    login(client, "staff")

    response = client.get("/api/v1/dashboard?range=week")

    assert response.status_code == 200
    data = response.get_json()["data"]
    assert data["period_days"] == 7
    assert {"sales_total_usd", "purchases_total_usd", "sales_total_usd_last_30_days", "purchases_total_usd_last_30_days", "activity", "latest_movements"}.isdisjoint(data)


def test_staff_cannot_access_purchase_costs_or_global_dashboard_data(app) -> None:
    client = app.test_client()
    login(client, "manager")
    _, product_id = create_catalog(client)
    supplier_id = create_partner(client, "suppliers", "Paper House")
    customer_id = create_partner(client, "customers", "Campus Store")

    purchase = client.post(
        "/api/v1/purchases",
        json={
            "supplier_id": supplier_id,
            "currency": "USD",
            "exchange_rate_to_usd": "1",
            "items": [{"product_id": product_id, "quantity": "1", "unit_cost": "1.25"}],
        },
        headers=csrf_headers(client),
    )
    assert purchase.status_code == 201
    purchase_id = purchase.get_json()["data"]["id"]

    login(client, "staff")
    own_sale = client.post(
        "/api/v1/sales",
        json={
            "customer_id": customer_id,
            "currency": "USD",
            "exchange_rate_to_usd": "1",
            "items": [{"product_id": product_id, "quantity": "1", "unit_price": "2.50"}],
        },
        headers=csrf_headers(client),
    )
    assert own_sale.status_code == 201

    for path in ("/api/v1/purchases", f"/api/v1/purchases/{purchase_id}", "/api/v1/inventory/movements"):
        denied = client.get(path)
        assert denied.status_code == 403
        assert denied.get_json()["error"]["code"] == "forbidden"

    products = client.get("/api/v1/products")
    assert products.status_code == 200
    assert "default_cost_usd" not in products.get_json()["data"][0]

    dashboard = client.get("/api/v1/dashboard")
    assert dashboard.status_code == 200
    data = dashboard.get_json()["data"]
    assert data["own_draft_sale_count"] == 1
    assert {"stock_value_usd", "sales_total_usd_last_30_days", "purchases_total_usd_last_30_days", "draft_purchase_count", "draft_sale_count", "latest_movements"}.isdisjoint(data)
    assert data["low_stock"][0]["product_id"] == product_id


def test_new_product_has_zero_stock_and_appears_in_low_stock_views(app) -> None:
    client = app.test_client()
    login(client, "manager")
    _, product_id = create_catalog(client)

    with app.app_context():
        balance = db.session.scalar(db.select(StockBalance).where(StockBalance.product_id == product_id))
        assert balance is not None
        assert balance.quantity == Decimal("0.000")

    stock = client.get("/api/v1/inventory/stock")
    assert stock.status_code == 200
    assert stock.get_json()["data"] == [
        {
            "product_id": product_id,
            "product_name": "Notebook",
            "sku": "NB-001",
            "unit": "piece",
            "quantity": "0.000",
            "reorder_level": "3.000",
            "updated_at": stock.get_json()["data"][0]["updated_at"],
        }
    ]

    dashboard = client.get("/api/v1/dashboard")
    assert dashboard.status_code == 200
    assert dashboard.get_json()["data"]["low_stock"] == [
        {
            "product_id": product_id,
            "product_name": "Notebook",
            "quantity": "0.000",
            "reorder_level": "3.000",
            "unit": "piece",
        }
    ]


def test_stock_low_filter_is_applied_before_pagination(app) -> None:
    client = app.test_client()
    login(client, "manager")
    category_id, first_low_id = create_catalog(client)

    for name, sku in (("Printer Paper", "PAPER-001"), ("Stapler", "STAPLER-001")):
        response = client.post(
            "/api/v1/products",
            json={
                "name": name,
                "sku": sku,
                "category_id": category_id,
                "unit": "piece",
                "reorder_level": "3",
                "default_cost_usd": "1.00",
                "default_sale_price_usd": "2.00",
            },
            headers=csrf_headers(client),
        )
        assert response.status_code == 201, response.get_json()

    healthy_product = db.session.scalar(db.select(Product).where(Product.sku == "PAPER-001"))
    assert healthy_product is not None
    adjustment = client.post(
        "/api/v1/inventory/adjustments",
        json={"product_id": healthy_product.id, "direction": "in", "quantity": "10", "reason": "Initial count"},
        headers=csrf_headers(client),
    )
    assert adjustment.status_code == 201, adjustment.get_json()

    second_page = client.get(
        "/api/v1/inventory/stock?low_stock=true&page=2&per_page=1&sort=name&direction=asc"
    )

    assert second_page.status_code == 200
    assert second_page.get_json()["meta"] == {"page": 2, "pages": 2, "per_page": 1, "total": 2}
    assert [item["product_name"] for item in second_page.get_json()["data"]] == ["Stapler"]
    assert all(item["product_id"] != first_low_id for item in second_page.get_json()["data"])

    healthy = client.get("/api/v1/inventory/stock?low_stock=false")
    assert healthy.status_code == 200
    assert healthy.get_json()["meta"]["total"] == 1
    assert [item["product_name"] for item in healthy.get_json()["data"]] == ["Printer Paper"]


def test_stock_low_filter_rejects_unsupported_values(app) -> None:
    client = app.test_client()
    login(client, "manager")

    response = client.get("/api/v1/inventory/stock?low_stock=maybe")

    assert response.status_code == 400
    assert response.get_json()["error"] == {
        "code": "validation_error",
        "message": "Request validation failed.",
        "fields": {"low_stock": "Must be true or false."},
    }


def test_draft_document_rate_edits_recalculate_locked_usd_values(app) -> None:
    client = app.test_client()
    login(client, "manager")
    _, product_id = create_catalog(client)
    supplier_id = create_partner(client, "suppliers", "Paper House")
    customer_id = create_partner(client, "customers", "Campus Store")

    purchase = client.post(
        "/api/v1/purchases",
        json={
            "supplier_id": supplier_id,
            "currency": "KHR",
            "exchange_rate_to_usd": "4100",
            "items": [{"product_id": product_id, "quantity": "2", "unit_cost": "41000"}],
        },
        headers=csrf_headers(client),
    )
    assert purchase.status_code == 201
    patched_purchase = client.patch(
        f"/api/v1/purchases/{purchase.get_json()['data']['id']}",
        json={"exchange_rate_to_usd": "4000"},
        headers=csrf_headers(client),
    )
    assert patched_purchase.status_code == 200
    purchase_data = patched_purchase.get_json()["data"]
    assert purchase_data["total_amount"] == "82000.00"
    assert purchase_data["total_usd"] == "20.5000"
    assert purchase_data["items"][0]["unit_cost_usd"] == "10.2500"
    assert purchase_data["items"][0]["line_total_usd"] == "20.5000"

    sale = client.post(
        "/api/v1/sales",
        json={
            "customer_id": customer_id,
            "currency": "KHR",
            "exchange_rate_to_usd": "4100",
            "items": [{"product_id": product_id, "quantity": "2", "unit_price": "8200"}],
        },
        headers=csrf_headers(client),
    )
    assert sale.status_code == 201
    patched_sale = client.patch(
        f"/api/v1/sales/{sale.get_json()['data']['id']}",
        json={"exchange_rate_to_usd": "4000"},
        headers=csrf_headers(client),
    )
    assert patched_sale.status_code == 200
    sale_data = patched_sale.get_json()["data"]
    assert sale_data["total_usd"] == "4.1000"
    assert sale_data["items"][0]["unit_price_usd"] == "2.0500"
    assert sale_data["items"][0]["line_total_usd"] == "4.1000"

    invalid_currency = client.patch(
        f"/api/v1/sales/{sale.get_json()['data']['id']}",
        json={"currency": "USD"},
        headers=csrf_headers(client),
    )
    assert invalid_currency.status_code == 400
    assert invalid_currency.get_json()["error"]["fields"] == {
        "exchange_rate_to_usd": "USD exchange rate must be exactly 1."
    }


def test_master_data_single_resource_reads_updates_and_safe_archiving(app) -> None:
    client = app.test_client()
    login(client, "manager")
    category_id, product_id = create_catalog(client)
    supplier_id = create_partner(client, "suppliers", "Paper House")
    customer_id = create_partner(client, "customers", "Campus Store")

    for path, expected_id in (
        (f"/api/v1/categories/{category_id}", category_id),
        (f"/api/v1/products/{product_id}", product_id),
        (f"/api/v1/suppliers/{supplier_id}", supplier_id),
        (f"/api/v1/customers/{customer_id}", customer_id),
    ):
        response = client.get(path)
        assert response.status_code == 200
        assert response.get_json()["data"]["id"] == expected_id

    blocked_category_archive = client.patch(
        f"/api/v1/categories/{category_id}", json={"is_active": False}, headers=csrf_headers(client)
    )
    assert blocked_category_archive.status_code == 409
    assert blocked_category_archive.get_json()["error"]["code"] == "category_in_use"

    product_update = client.patch(
        f"/api/v1/products/{product_id}",
        json={"name": "Archived Notebook", "is_active": False},
        headers=csrf_headers(client),
    )
    assert product_update.status_code == 200
    assert product_update.get_json()["data"]["is_active"] is False

    for path in (f"/api/v1/categories/{category_id}", f"/api/v1/suppliers/{supplier_id}", f"/api/v1/customers/{customer_id}"):
        archived = client.patch(path, json={"is_active": False}, headers=csrf_headers(client))
        assert archived.status_code == 200
        assert archived.get_json()["data"]["is_active"] is False

    direct_product_quantity = client.patch(
        f"/api/v1/products/{product_id}", json={"quantity": "100"}, headers=csrf_headers(client)
    )
    assert direct_product_quantity.status_code == 400
    assert direct_product_quantity.get_json()["error"]["fields"] == {
        "quantity": "Stock is changed through inventory workflows only."
    }


def test_archived_references_are_rejected_for_new_documents(app) -> None:
    client = app.test_client()
    login(client, "manager")
    category_id, active_product_id = create_catalog(client)
    archived_product = client.post(
        "/api/v1/products",
        json={
            "name": "Archived Pen",
            "sku": "PEN-ARCHIVED",
            "category_id": category_id,
            "unit": "piece",
            "reorder_level": "1",
            "default_cost_usd": "0.50",
            "default_sale_price_usd": "1.00",
        },
        headers=csrf_headers(client),
    )
    assert archived_product.status_code == 201, archived_product.get_json()
    archived_product_id = archived_product.get_json()["data"]["id"]
    supplier_id = create_partner(client, "suppliers", "Archived Supplier")
    customer_id = create_partner(client, "customers", "Archived Customer")

    assert client.patch(
        f"/api/v1/products/{archived_product_id}",
        json={"is_active": False},
        headers=csrf_headers(client),
    ).status_code == 200
    for endpoint, payload in (
        (
            "/api/v1/purchases",
            {
                "supplier_id": supplier_id,
                "currency": "USD",
                "exchange_rate_to_usd": "1",
                "items": [{"product_id": archived_product_id, "quantity": "1", "unit_cost": "1"}],
            },
        ),
        (
            "/api/v1/sales",
            {
                "customer_id": customer_id,
                "currency": "USD",
                "exchange_rate_to_usd": "1",
                "items": [{"product_id": archived_product_id, "quantity": "1", "unit_price": "1"}],
            },
        ),
    ):
        rejected = client.post(endpoint, json=payload, headers=csrf_headers(client))
        assert rejected.status_code == 400
        assert rejected.get_json()["error"] == {
            "code": "validation_error",
            "message": "Request validation failed.",
            "fields": {"items.0.product_id": "Product is archived."},
        }

    assert client.patch(
        f"/api/v1/suppliers/{supplier_id}", json={"is_active": False}, headers=csrf_headers(client)
    ).status_code == 200
    archived_supplier = client.post(
        "/api/v1/purchases",
        json={
            "supplier_id": supplier_id,
            "currency": "USD",
            "exchange_rate_to_usd": "1",
            "items": [{"product_id": active_product_id, "quantity": "1", "unit_cost": "1"}],
        },
        headers=csrf_headers(client),
    )
    assert archived_supplier.status_code == 400
    assert archived_supplier.get_json()["error"]["fields"] == {"supplier_id": "Supplier is archived."}

    assert client.patch(
        f"/api/v1/customers/{customer_id}", json={"is_active": False}, headers=csrf_headers(client)
    ).status_code == 200
    archived_customer = client.post(
        "/api/v1/sales",
        json={
            "customer_id": customer_id,
            "currency": "USD",
            "exchange_rate_to_usd": "1",
            "items": [{"product_id": active_product_id, "quantity": "1", "unit_price": "1"}],
        },
        headers=csrf_headers(client),
    )
    assert archived_customer.status_code == 400
    assert archived_customer.get_json()["error"]["fields"] == {"customer_id": "Customer is archived."}


def test_draft_replacements_reject_archived_references(app) -> None:
    client = app.test_client()
    login(client, "manager")
    category_id, active_product_id = create_catalog(client)
    archived_product = client.post(
        "/api/v1/products",
        json={
            "name": "Archived Marker",
            "sku": "MARKER-ARCHIVED",
            "category_id": category_id,
            "unit": "piece",
            "reorder_level": "1",
            "default_cost_usd": "0.50",
            "default_sale_price_usd": "1.00",
        },
        headers=csrf_headers(client),
    )
    assert archived_product.status_code == 201, archived_product.get_json()
    archived_product_id = archived_product.get_json()["data"]["id"]
    supplier_id = create_partner(client, "suppliers", "Draft Supplier")
    customer_id = create_partner(client, "customers", "Draft Customer")

    purchase = client.post(
        "/api/v1/purchases",
        json={
            "supplier_id": supplier_id,
            "currency": "USD",
            "exchange_rate_to_usd": "1",
            "items": [{"product_id": active_product_id, "quantity": "1", "unit_cost": "1"}],
        },
        headers=csrf_headers(client),
    )
    sale = client.post(
        "/api/v1/sales",
        json={
            "customer_id": customer_id,
            "currency": "USD",
            "exchange_rate_to_usd": "1",
            "items": [{"product_id": active_product_id, "quantity": "1", "unit_price": "1"}],
        },
        headers=csrf_headers(client),
    )
    assert purchase.status_code == 201, purchase.get_json()
    assert sale.status_code == 201, sale.get_json()

    for resource, entity_id in (
        ("products", archived_product_id),
        ("suppliers", supplier_id),
        ("customers", customer_id),
    ):
        assert client.patch(
            f"/api/v1/{resource}/{entity_id}", json={"is_active": False}, headers=csrf_headers(client)
        ).status_code == 200

    rejected_supplier = client.patch(
        f"/api/v1/purchases/{purchase.get_json()['data']['id']}",
        json={"supplier_id": supplier_id},
        headers=csrf_headers(client),
    )
    assert rejected_supplier.status_code == 400
    assert rejected_supplier.get_json()["error"]["fields"] == {"supplier_id": "Supplier is archived."}

    rejected_purchase_item = client.patch(
        f"/api/v1/purchases/{purchase.get_json()['data']['id']}",
        json={"items": [{"product_id": archived_product_id, "quantity": "1", "unit_cost": "1"}]},
        headers=csrf_headers(client),
    )
    assert rejected_purchase_item.status_code == 400
    assert rejected_purchase_item.get_json()["error"]["fields"] == {"items.0.product_id": "Product is archived."}

    rejected_customer = client.patch(
        f"/api/v1/sales/{sale.get_json()['data']['id']}",
        json={"customer_id": customer_id},
        headers=csrf_headers(client),
    )
    assert rejected_customer.status_code == 400
    assert rejected_customer.get_json()["error"]["fields"] == {"customer_id": "Customer is archived."}

    rejected_sale_item = client.patch(
        f"/api/v1/sales/{sale.get_json()['data']['id']}",
        json={"items": [{"product_id": archived_product_id, "quantity": "1", "unit_price": "1"}]},
        headers=csrf_headers(client),
    )
    assert rejected_sale_item.status_code == 400
    assert rejected_sale_item.get_json()["error"]["fields"] == {"items.0.product_id": "Product is archived."}


def test_draft_status_patch_only_allows_cancellation(app) -> None:
    client = app.test_client()
    login(client, "manager")
    _, product_id = create_catalog(client)
    supplier_id = create_partner(client, "suppliers", "Status Supplier")
    customer_id = create_partner(client, "customers", "Status Customer")

    purchase = client.post(
        "/api/v1/purchases",
        json={
            "supplier_id": supplier_id,
            "currency": "USD",
            "exchange_rate_to_usd": "1",
            "items": [{"product_id": product_id, "quantity": "1", "unit_cost": "1"}],
        },
        headers=csrf_headers(client),
    )
    sale = client.post(
        "/api/v1/sales",
        json={
            "customer_id": customer_id,
            "currency": "USD",
            "exchange_rate_to_usd": "1",
            "items": [{"product_id": product_id, "quantity": "1", "unit_price": "1"}],
        },
        headers=csrf_headers(client),
    )
    assert purchase.status_code == 201, purchase.get_json()
    assert sale.status_code == 201, sale.get_json()

    for endpoint in (
        f"/api/v1/purchases/{purchase.get_json()['data']['id']}",
        f"/api/v1/sales/{sale.get_json()['data']['id']}",
    ):
        for status in ("received", "completed", "not-a-real-status"):
            rejected = client.patch(endpoint, json={"status": status}, headers=csrf_headers(client))
            assert rejected.status_code == 400
            assert rejected.get_json()["error"]["code"] == "invalid_status"

        unchanged = client.patch(endpoint, json={"status": "draft"}, headers=csrf_headers(client))
        assert unchanged.status_code == 200
        assert unchanged.get_json()["data"]["status"] == "draft"

        cancelled = client.patch(endpoint, json={"status": "cancelled"}, headers=csrf_headers(client))
        assert cancelled.status_code == 200
        assert cancelled.get_json()["data"]["status"] == "cancelled"


def test_products_reject_archived_categories_on_create_and_update(app) -> None:
    client = app.test_client()
    login(client, "manager")
    category_id, product_id = create_catalog(client)

    assert client.patch(
        f"/api/v1/products/{product_id}", json={"is_active": False}, headers=csrf_headers(client)
    ).status_code == 200
    assert client.patch(
        f"/api/v1/categories/{category_id}", json={"is_active": False}, headers=csrf_headers(client)
    ).status_code == 200

    rejected_create = client.post(
        "/api/v1/products",
        json={
            "name": "Archived Category Pen",
            "sku": "ARCH-CAT-001",
            "category_id": category_id,
            "unit": "piece",
            "reorder_level": "1",
            "default_cost_usd": "1",
            "default_sale_price_usd": "2",
        },
        headers=csrf_headers(client),
    )
    assert rejected_create.status_code == 400
    assert rejected_create.get_json()["error"] == {
        "code": "validation_error",
        "message": "Request validation failed.",
        "fields": {"category_id": "Category is archived."},
    }

    rejected_update = client.patch(
        f"/api/v1/products/{product_id}",
        json={"name": "Reactivate Into Archived Category", "is_active": True},
        headers=csrf_headers(client),
    )
    assert rejected_update.status_code == 400
    assert rejected_update.get_json()["error"] == {
        "code": "validation_error",
        "message": "Request validation failed.",
        "fields": {"category_id": "Category is archived."},
    }


def test_adjustments_reject_archived_products_but_keep_history_readable(app) -> None:
    client = app.test_client()
    login(client, "manager")
    _, product_id = create_catalog(client)
    supplier_id = create_partner(client, "suppliers", "Ledger Supplier")
    receive_khr_purchase(client, product_id, supplier_id, quantity="2")

    assert client.patch(
        f"/api/v1/products/{product_id}", json={"is_active": False}, headers=csrf_headers(client)
    ).status_code == 200
    rejected_adjustment = client.post(
        "/api/v1/inventory/adjustments",
        json={"product_id": product_id, "quantity": "1", "direction": "out", "reason": "Damaged"},
        headers=csrf_headers(client),
    )
    assert rejected_adjustment.status_code == 400
    assert rejected_adjustment.get_json()["error"] == {
        "code": "validation_error",
        "message": "Request validation failed.",
        "fields": {"product_id": "Product is archived."},
    }

    history = client.get("/api/v1/inventory/movements")
    assert history.status_code == 200
    assert [movement["product_id"] for movement in history.get_json()["data"]] == [product_id]


def test_staff_can_only_use_the_safe_active_customer_picker(app) -> None:
    client = app.test_client()
    login(client, "manager")
    supplier = client.post(
        "/api/v1/suppliers",
        json={"name": "Private Supplier", "email": "supplier@example.com", "address": "Private address"},
        headers=csrf_headers(client),
    )
    assert supplier.status_code == 201
    customer = client.post(
        "/api/v1/customers",
        json={"name": "Active Customer", "email": "customer@example.com", "address": "Private address"},
        headers=csrf_headers(client),
    )
    assert customer.status_code == 201
    archived_customer = client.post(
        "/api/v1/customers",
        json={"name": "Archived Customer"},
        headers=csrf_headers(client),
    )
    assert archived_customer.status_code == 201
    archived_customer_id = archived_customer.get_json()["data"]["id"]
    assert client.patch(
        f"/api/v1/customers/{archived_customer_id}",
        json={"is_active": False},
        headers=csrf_headers(client),
    ).status_code == 200

    supplier_id = supplier.get_json()["data"]["id"]
    customer_id = customer.get_json()["data"]["id"]
    manager_customer = client.get("/api/v1/customers")
    assert manager_customer.status_code == 200
    assert manager_customer.get_json()["data"][0]["email"] == "customer@example.com"

    login(client, "staff")
    for path in (
        "/api/v1/suppliers",
        f"/api/v1/suppliers/{supplier_id}",
        "/api/v1/customers",
        f"/api/v1/customers/{customer_id}",
    ):
        response = client.get(path)
        assert response.status_code == 403
        assert response.get_json()["error"]["code"] == "forbidden"

    rejected_mutation = client.post(
        "/api/v1/customers", json={"name": "Staff Customer"}, headers=csrf_headers(client)
    )
    assert rejected_mutation.status_code == 403

    picker = client.get("/api/v1/customers?for_sale=true")
    assert picker.status_code == 200
    assert picker.get_json()["data"] == [
        {"id": customer_id, "name": "Active Customer", "code": f"CUS-{customer_id:05d}"}
    ]


def test_login_limiter_rejects_the_sixth_same_client_attempt(app) -> None:
    client = app.test_client()
    remote_address = "198.18.0.77"
    for _ in range(5):
        rejected = client.post(
            "/api/v1/auth/login",
            json={"username": "admin", "password": "wrong-password"},
            headers=csrf_headers(client),
            environ_overrides={"REMOTE_ADDR": remote_address},
        )
        assert rejected.status_code == 401
        assert rejected.get_json()["error"]["code"] == "invalid_credentials"

    limited = client.post(
        "/api/v1/auth/login",
        json={"username": "admin", "password": "wrong-password"},
        headers=csrf_headers(client),
        environ_overrides={"REMOTE_ADDR": remote_address},
    )
    assert limited.status_code == 429
    assert limited.get_json()["error"] == {
        "code": "rate_limited",
        "message": "Too many requests. Please try again later.",
    }


def test_categories_status_archived_filter_uses_filtered_pagination(app) -> None:
    client = app.test_client()
    login(client, "manager")

    category_ids: list[int] = []
    for name in ("Active catalogue", "Archived alpha", "Archived beta"):
        response = client.post("/api/v1/categories", json={"name": name}, headers=csrf_headers(client))
        assert response.status_code == 201, response.get_json()
        category_ids.append(response.get_json()["data"]["id"])

    for category_id in category_ids[1:]:
        response = client.patch(
            f"/api/v1/categories/{category_id}",
            json={"is_active": False},
            headers=csrf_headers(client),
        )
        assert response.status_code == 200, response.get_json()

    listing = client.get("/api/v1/categories?status=archived&page=2&per_page=1")

    assert listing.status_code == 200
    assert listing.get_json()["meta"] == {"page": 2, "per_page": 1, "total": 2, "pages": 2}
    assert [category["name"] for category in listing.get_json()["data"]] == ["Archived beta"]


def test_products_status_archived_filter_uses_filtered_pagination(app) -> None:
    client = app.test_client()
    login(client, "manager")
    category_id, active_product_id = create_catalog(client)

    archived_product_ids: list[int] = []
    for name, sku in (("Archived alpha", "ARCH-001"), ("Archived beta", "ARCH-002")):
        response = client.post(
            "/api/v1/products",
            json={
                "name": name,
                "sku": sku,
                "category_id": category_id,
                "unit": "piece",
                "reorder_level": "1",
                "default_cost_usd": "1",
                "default_sale_price_usd": "2",
            },
            headers=csrf_headers(client),
        )
        assert response.status_code == 201, response.get_json()
        archived_product_ids.append(response.get_json()["data"]["id"])

    assert active_product_id not in archived_product_ids
    for product_id in archived_product_ids:
        response = client.patch(
            f"/api/v1/products/{product_id}",
            json={"is_active": False},
            headers=csrf_headers(client),
        )
        assert response.status_code == 200, response.get_json()

    listing = client.get("/api/v1/products?status=archived&page=2&per_page=1&sort=id")

    assert listing.status_code == 200
    assert listing.get_json()["meta"] == {"page": 2, "per_page": 1, "total": 2, "pages": 2}
    assert [product["name"] for product in listing.get_json()["data"]] == ["Archived beta"]


def test_catalog_status_active_all_and_default_preserve_expected_records(app) -> None:
    client = app.test_client()
    login(client, "manager")
    active_category_id, active_product_id = create_catalog(client)

    archived_category = client.post(
        "/api/v1/categories", json={"name": "Archived category"}, headers=csrf_headers(client)
    )
    assert archived_category.status_code == 201, archived_category.get_json()
    archived_category_id = archived_category.get_json()["data"]["id"]
    assert client.patch(
        f"/api/v1/categories/{archived_category_id}",
        json={"is_active": False},
        headers=csrf_headers(client),
    ).status_code == 200

    archived_product = client.post(
        "/api/v1/products",
        json={
            "name": "Archived product",
            "sku": "ARCH-STATUS-001",
            "category_id": active_category_id,
            "unit": "piece",
            "reorder_level": "1",
            "default_cost_usd": "1",
            "default_sale_price_usd": "2",
        },
        headers=csrf_headers(client),
    )
    assert archived_product.status_code == 201, archived_product.get_json()
    archived_product_id = archived_product.get_json()["data"]["id"]
    assert client.patch(
        f"/api/v1/products/{archived_product_id}",
        json={"is_active": False},
        headers=csrf_headers(client),
    ).status_code == 200

    for resource, active_id in (("categories", active_category_id), ("products", active_product_id)):
        default_listing = client.get(f"/api/v1/{resource}")
        all_listing = client.get(f"/api/v1/{resource}?status=all")
        active_listing = client.get(f"/api/v1/{resource}?status=active")

        assert default_listing.status_code == 200
        assert default_listing.get_json()["meta"]["total"] == 2
        assert all_listing.get_json()["meta"]["total"] == 2
        assert active_listing.get_json()["meta"] == {"page": 1, "per_page": 10, "total": 1, "pages": 1}
        assert [record["id"] for record in active_listing.get_json()["data"]] == [active_id]


@pytest.mark.parametrize("resource", ("categories", "products"))
def test_catalog_status_filter_rejects_unknown_values(app, resource: str) -> None:
    client = app.test_client()
    login(client, "manager")

    response = client.get(f"/api/v1/{resource}?status=retired")

    assert response.status_code == 400
    assert response.get_json()["error"] == {
        "code": "validation_error",
        "message": "Request validation failed.",
        "fields": {"status": "Must be active, archived, or all."},
    }
