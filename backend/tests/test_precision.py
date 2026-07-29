from __future__ import annotations

from decimal import Decimal

import pytest

from inventory import create_app
from inventory.extensions import db
from inventory.models import Purchase, Sale
from inventory.services import _quantized_product_total


@pytest.fixture()
def app():
    app = create_app(
        {
            "TESTING": True,
            "WTF_CSRF_ENABLED": True,
            "SQLALCHEMY_DATABASE_URI": "sqlite+pysqlite:///:memory:",
        }
    )
    with app.app_context():
        db.create_all()
        yield app
        db.session.remove()
        db.drop_all()


def csrf_headers(client) -> dict[str, str]:
    response = client.get("/api/v1/auth/csrf")
    return {"X-CSRFToken": response.get_json()["data"]["csrf_token"]}


def login_manager(client, app) -> None:
    from inventory.models import User

    with app.app_context():
        user = User(username="manager", full_name="Manager", role="manager")
        user.set_password("demo-password")
        db.session.add(user)
        db.session.commit()
    response = client.post(
        "/api/v1/auth/login",
        json={"username": "manager", "password": "demo-password"},
        headers=csrf_headers(client),
    )
    assert response.status_code == 200


def catalog_and_supplier(client) -> tuple[int, int]:
    category = client.post("/api/v1/categories", json={"name": "Precision"}, headers=csrf_headers(client))
    assert category.status_code == 201
    product = client.post(
        "/api/v1/products",
        json={
            "name": "Precision Product",
            "sku": "PRECISION-001",
            "category_id": category.get_json()["data"]["id"],
            "unit": "piece",
            "reorder_level": "1.000",
            "default_cost_usd": "1.0000",
            "default_sale_price_usd": "2.0000",
        },
        headers=csrf_headers(client),
    )
    assert product.status_code == 201
    supplier = client.post("/api/v1/suppliers", json={"name": "Precision Supplier"}, headers=csrf_headers(client))
    assert supplier.status_code == 201
    return product.get_json()["data"]["id"], supplier.get_json()["data"]["id"]


def test_api_rejects_decimal_values_that_exceed_persisted_column_scales(app) -> None:
    client = app.test_client()
    login_manager(client, app)
    category = client.post("/api/v1/categories", json={"name": "Decimal limits"}, headers=csrf_headers(client))

    rejected_product = client.post(
        "/api/v1/products",
        json={
            "name": "Too precise",
            "sku": "DECIMAL-001",
            "category_id": category.get_json()["data"]["id"],
            "unit": "piece",
            "reorder_level": "1.0001",
            "default_cost_usd": "1.0000",
            "default_sale_price_usd": "2.0000",
        },
        headers=csrf_headers(client),
    )
    assert rejected_product.status_code == 400
    assert rejected_product.get_json()["error"]["fields"] == {"reorder_level": "Must have at most 3 decimal places."}

    out_of_range_product = client.post(
        "/api/v1/products",
        json={
            "name": "Too large",
            "sku": "DECIMAL-002",
            "category_id": category.get_json()["data"]["id"],
            "unit": "piece",
            "reorder_level": "1.000",
            "default_cost_usd": "100000000000000.0000",
            "default_sale_price_usd": "2.0000",
        },
        headers=csrf_headers(client),
    )
    assert out_of_range_product.status_code == 400
    assert out_of_range_product.get_json()["error"]["fields"] == {
        "default_cost_usd": "Must fit DECIMAL(18, 4)."
    }

    product_id, supplier_id = catalog_and_supplier(client)
    rejected_purchase = client.post(
        "/api/v1/purchases",
        json={
            "supplier_id": supplier_id,
            "currency": "KHR",
            "exchange_rate_to_usd": "4100.0000001",
            "items": [{"product_id": product_id, "quantity": "1.000", "unit_cost": "1.00"}],
        },
        headers=csrf_headers(client),
    )
    assert rejected_purchase.status_code == 400
    assert rejected_purchase.get_json()["error"]["fields"] == {
        "exchange_rate_to_usd": "Must have at most 6 decimal places."
    }

    rejected_line = client.post(
        "/api/v1/purchases",
        json={
            "supplier_id": supplier_id,
            "currency": "KHR",
            "exchange_rate_to_usd": "100",
            "items": [{"product_id": product_id, "quantity": "1.0001", "unit_cost": "1.001"}],
        },
        headers=csrf_headers(client),
    )
    assert rejected_line.status_code == 400
    assert rejected_line.get_json()["error"]["fields"] == {"items.0.quantity": "Must have at most 3 decimal places."}


def test_khr_line_usd_totals_are_calculated_from_persisted_scale_values(app) -> None:
    client = app.test_client()
    login_manager(client, app)
    product_id, supplier_id = catalog_and_supplier(client)

    rejected_unpersistable_quantity = client.post(
        "/api/v1/purchases",
        json={
            "supplier_id": supplier_id,
            "currency": "KHR",
            "exchange_rate_to_usd": "4100",
            "items": [{"product_id": product_id, "quantity": "1.0001", "unit_cost": "40998.77"}],
        },
        headers=csrf_headers(client),
    )
    assert rejected_unpersistable_quantity.status_code == 400
    assert rejected_unpersistable_quantity.get_json()["error"]["fields"] == {
        "items.0.quantity": "Must have at most 3 decimal places."
    }

    purchase = client.post(
        "/api/v1/purchases",
        json={
            "supplier_id": supplier_id,
            "currency": "KHR",
            "exchange_rate_to_usd": "4100",
            "items": [{"product_id": product_id, "quantity": "1.000", "unit_cost": "40998.77"}],
        },
        headers=csrf_headers(client),
    )
    assert purchase.status_code == 201, purchase.get_json()
    item = purchase.get_json()["data"]["items"][0]
    assert item["quantity"] == "1.000"
    assert item["unit_cost_usd"] == "9.9997"
    assert item["line_total_usd"] == "9.9997"
    assert purchase.get_json()["data"]["total_usd"] == "9.9997"

    with app.app_context():
        stored = db.session.scalar(db.select(Purchase).where(Purchase.id == purchase.get_json()["data"]["id"]))
        assert stored is not None
        assert stored.items[0].line_total_usd == stored.items[0].quantity * stored.items[0].unit_price_usd


@pytest.mark.parametrize(
    ("resource", "partner_field", "partner_resource", "unit_field", "document_model"),
    [
        ("purchases", "supplier_id", "suppliers", "unit_cost", Purchase),
        ("sales", "customer_id", "customers", "unit_price", Sale),
    ],
)
def test_document_line_total_overflow_returns_validation_error_without_persisting(
    app,
    resource: str,
    partner_field: str,
    partner_resource: str,
    unit_field: str,
    document_model: type[Purchase] | type[Sale],
) -> None:
    client = app.test_client()
    login_manager(client, app)
    product_id, supplier_id = catalog_and_supplier(client)
    partner_id = supplier_id
    if partner_resource == "customers":
        customer = client.post("/api/v1/customers", json={"name": "Precision Customer"}, headers=csrf_headers(client))
        assert customer.status_code == 201
        partner_id = customer.get_json()["data"]["id"]

    response = client.post(
        f"/api/v1/{resource}",
        json={
            partner_field: partner_id,
            "currency": "USD",
            "exchange_rate_to_usd": "1",
            "items": [
                {
                    "product_id": product_id,
                    "quantity": "9999999999999.999",
                    unit_field: "99999999999999.99",
                }
            ],
        },
        headers=csrf_headers(client),
    )

    assert response.status_code == 400
    assert response.get_json()["error"]["code"] == "validation_error"
    assert response.get_json()["error"]["fields"] == {
        f"items.0.{unit_field}": "Must fit DECIMAL(18, 2)."
    }
    with app.app_context():
        assert db.session.scalar(db.select(db.func.count()).select_from(document_model)) == 0


def test_dashboard_value_helper_supports_maximum_legal_decimal_inputs() -> None:
    quantity = Decimal("9999999999999.999")
    cost = Decimal("99999999999999.9999")
    expected_value = Decimal("999999999999999899000000000.0000")

    stock_value = _quantized_product_total(((quantity, cost),), scale=4)

    assert stock_value == expected_value
    assert format(stock_value, ".4f") == "999999999999999899000000000.0000"
