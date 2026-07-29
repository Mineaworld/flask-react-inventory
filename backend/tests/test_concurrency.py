from __future__ import annotations

from sqlalchemy.dialects import mysql

from inventory.services import _purchase_lock_statement, _sale_lock_statement, _stock_balance_lock_statement


def test_document_draft_updates_use_row_locking_statements() -> None:
    dialect = mysql.dialect()

    purchase_sql = str(_purchase_lock_statement(7).compile(dialect=dialect))
    sale_sql = str(_sale_lock_statement(11).compile(dialect=dialect))

    assert "FROM purchases" in purchase_sql
    assert "FOR UPDATE" in purchase_sql
    assert "FROM sales" in sale_sql
    assert "FOR UPDATE" in sale_sql


def test_multi_item_balance_lock_statement_orders_product_ids_before_for_update() -> None:
    statement = _stock_balance_lock_statement([9, 2, 5])
    compiled = statement.compile(dialect=mysql.dialect())

    assert "ORDER BY stock_balances.product_id" in str(compiled)
    assert "FOR UPDATE" in str(compiled)
    assert next(value for value in compiled.params.values() if isinstance(value, list)) == [2, 5, 9]
