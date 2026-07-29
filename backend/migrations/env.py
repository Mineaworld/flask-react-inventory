"""Alembic environment used by Flask-Migrate commands."""

from __future__ import annotations

import logging
from logging.config import fileConfig

from alembic import context
from flask import current_app


config = context.config
if config.config_file_name:
    fileConfig(config.config_file_name)
logger = logging.getLogger("alembic.env")


def get_engine():
    """Get the Flask-SQLAlchemy 3 engine registered by the app factory."""
    return current_app.extensions["migrate"].db.engine


def get_engine_url() -> str:
    return get_engine().url.render_as_string(hide_password=False).replace("%", "%%")


config.set_main_option("sqlalchemy.url", get_engine_url())
target_db = current_app.extensions["migrate"].db


def get_metadata():
    return target_db.metadatas[None] if hasattr(target_db, "metadatas") else target_db.metadata


def run_migrations_offline() -> None:
    context.configure(url=config.get_main_option("sqlalchemy.url"), target_metadata=get_metadata(), literal_binds=True)
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    def process_revision_directives(migration_context, revision, directives) -> None:
        if getattr(config.cmd_opts, "autogenerate", False) and directives[0].upgrade_ops.is_empty():
            directives[:] = []
            logger.info("No schema changes detected.")

    configure_args = current_app.extensions["migrate"].configure_args
    if configure_args.get("process_revision_directives") is None:
        configure_args["process_revision_directives"] = process_revision_directives
    with get_engine().connect() as connection:
        context.configure(connection=connection, target_metadata=get_metadata(), **configure_args)
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
