"""Flask CLI commands for preparing a safe, repeatable local demonstration."""

from __future__ import annotations

import click
from flask import current_app
from sqlalchemy import select

from inventory.extensions import db
from inventory.models import Category, Customer, Product, Purchase, PurchaseStatus, Role, Sale, SaleStatus, Supplier, User
from inventory.services import (
    complete_sale,
    create_category,
    create_partner,
    create_product,
    create_purchase,
    create_sale,
    receive_purchase,
)


DEMO_PURCHASE_NOTE = "Seeded by seed-demo: KHR purchase receipt"
DEMO_SALE_NOTE = "Seeded by seed-demo: USD completed sale"


def _demo_user(username: str, full_name: str, role: Role, password: str) -> User:
    user = db.session.scalar(select(User).where(User.username == username))
    if user is None:
        user = User(username=username)
        db.session.add(user)
    user.full_name = full_name
    user.role = role
    user.is_active = True
    user.set_password(password)
    db.session.commit()
    return user


def _demo_category(name: str, description: str) -> Category:
    category = db.session.scalar(select(Category).where(Category.name == name))
    return category if category is not None else create_category({"name": name, "description": description})


def _demo_product(category: Category, payload: dict[str, str]) -> Product:
    product = db.session.scalar(select(Product).where(Product.sku == payload["sku"]))
    if product is not None:
        return product
    return create_product({**payload, "category_id": category.id})


def _demo_partner(model: type[Supplier] | type[Customer], name: str) -> Supplier | Customer:
    partner = db.session.scalar(select(model).where(model.name == name))
    return partner if partner is not None else create_partner(model, {"name": name})


@click.command("seed-demo")
@click.option("--password", default="123", show_default=True, metavar="PASSWORD", help="Password for all demo accounts.")
def seed_demo(password: str) -> None:
    """Create idempotent, workflow-backed demo data without displaying secrets."""
    if not password.strip():
        raise click.UsageError("--password must not be blank.")

    admin = _demo_user("demo-admin", "Sokha Chan", Role.ADMIN, password)
    manager = _demo_user("demo-manager", "Dara Lim", Role.MANAGER, password)
    _demo_user("demo-staff", "Vannak Chea", Role.STAFF, password)

    stationery = _demo_category("Demo Stationery", "Everyday office and school supplies")
    beverages = _demo_category("Demo Beverages", "Refreshments for the store")
    notebook = _demo_product(
        stationery,
        {
            "name": "A5 Grid Notebook",
            "sku": "DEMO-NB-A5",
            "unit": "piece",
            "reorder_level": "10",
            "default_cost_usd": "1.2195",
            "default_sale_price_usd": "2.50",
        },
    )
    water = _demo_product(
        beverages,
        {
            "name": "500ml Mineral Water",
            "sku": "DEMO-WATER-500",
            "unit": "bottle",
            "reorder_level": "12",
            "default_cost_usd": "0.3659",
            "default_sale_price_usd": "0.75",
        },
    )
    supplier = _demo_partner(Supplier, "Phnom Penh Office Supply")
    customer = _demo_partner(Customer, "SETEC Campus Shop")

    purchase = db.session.scalar(select(Purchase).where(Purchase.notes == DEMO_PURCHASE_NOTE))
    if purchase is None:
        purchase = create_purchase(
            {
                "supplier_id": supplier.id,
                "currency": "KHR",
                "exchange_rate_to_usd": "4100",
                "items": [
                    {"product_id": notebook.id, "quantity": "20", "unit_cost": "5000"},
                    {"product_id": water.id, "quantity": "30", "unit_cost": "1500"},
                ],
                "notes": DEMO_PURCHASE_NOTE,
            },
            manager,
        )
    if purchase.status is PurchaseStatus.DRAFT:
        receive_purchase(purchase.id, admin)

    sale = db.session.scalar(select(Sale).where(Sale.notes == DEMO_SALE_NOTE))
    if sale is None:
        sale = create_sale(
            {
                "customer_id": customer.id,
                "currency": "USD",
                "exchange_rate_to_usd": "1",
                "items": [
                    {"product_id": notebook.id, "quantity": "5", "unit_price": "2.50"},
                    {"product_id": water.id, "quantity": "5", "unit_price": "0.75"},
                ],
                "notes": DEMO_SALE_NOTE,
            },
            manager,
        )
    if sale.status is SaleStatus.DRAFT:
        complete_sale(sale.id, admin)

    current_app.logger.info("Demo seed data is ready.")
    click.echo("Demo data is ready.")
