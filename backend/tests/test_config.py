from __future__ import annotations

import pytest

from inventory.config import TestConfig


def test_test_config_uses_in_memory_sqlite_without_test_database_url(monkeypatch) -> None:
    monkeypatch.delenv("TEST_DATABASE_URL", raising=False)

    assert TestConfig().SQLALCHEMY_DATABASE_URI == "sqlite+pysqlite:///:memory:"


def test_production_config_requires_mysql_url(monkeypatch) -> None:
    from inventory.config import ProductionConfig

    monkeypatch.setenv("DATABASE_URL", "sqlite:///not-allowed.db")

    try:
        ProductionConfig()
    except ValueError as error:
        assert "mysql" in str(error).lower()
    else:
        raise AssertionError("ProductionConfig must reject non-MySQL database URLs")


def test_production_config_rejects_default_or_weak_secret_keys(monkeypatch) -> None:
    from inventory.config import ProductionConfig

    monkeypatch.setenv("DATABASE_URL", "mysql+mysqldb://inventory:password@127.0.0.1:3307/inventory")
    monkeypatch.setenv("RATELIMIT_STORAGE_URI", "redis://127.0.0.1:6379/0")

    for secret_key in ("development-secret-change-me", "short-secret"):
        monkeypatch.setenv("SECRET_KEY", secret_key)

        try:
            ProductionConfig()
        except ValueError as error:
            assert "secret_key" in str(error).lower()
        else:
            raise AssertionError("ProductionConfig must reject weak SECRET_KEY values")

    monkeypatch.delenv("SECRET_KEY", raising=False)
    with pytest.raises(ValueError, match="SECRET_KEY"):
        ProductionConfig()


def test_production_config_requires_a_non_memory_rate_limit_store(monkeypatch) -> None:
    from inventory.config import ProductionConfig

    monkeypatch.setenv("DATABASE_URL", "mysql+mysqldb://inventory:password@127.0.0.1:3307/inventory")
    monkeypatch.setenv("SECRET_KEY", "a-production-secret-key-that-is-at-least-32-characters")
    for rate_limit_uri in ("memory://", ""):
        monkeypatch.setenv("RATELIMIT_STORAGE_URI", rate_limit_uri)

        try:
            ProductionConfig()
        except ValueError as error:
            assert "ratelimit_storage_uri" in str(error).lower()
        else:
            raise AssertionError("ProductionConfig must reject an absent or in-memory rate-limit store")


def test_development_config_keeps_local_secret_and_memory_rate_limit_defaults(monkeypatch) -> None:
    from inventory.config import DevelopmentConfig

    monkeypatch.setenv("DATABASE_URL", "mysql+mysqldb://inventory:password@127.0.0.1:3307/inventory")
    monkeypatch.delenv("SECRET_KEY", raising=False)
    monkeypatch.delenv("RATELIMIT_STORAGE_URI", raising=False)

    config = DevelopmentConfig()

    assert config.SECRET_KEY == "development-secret-change-me"
    assert config.RATELIMIT_STORAGE_URI == "memory://"


def test_base_config_uses_a_finite_csrf_token_lifetime() -> None:
    assert TestConfig().WTF_CSRF_TIME_LIMIT == 3600


def test_production_config_enables_secure_session_cookie_defaults(monkeypatch) -> None:
    from inventory.config import ProductionConfig

    monkeypatch.setenv("DATABASE_URL", "mysql+mysqldb://inventory:password@127.0.0.1:3307/inventory")
    monkeypatch.setenv("SECRET_KEY", "a-production-secret-key-that-is-at-least-32-characters")
    monkeypatch.setenv("RATELIMIT_STORAGE_URI", "redis://127.0.0.1:6379/0")

    config = ProductionConfig()

    assert config.SESSION_COOKIE_SECURE is True
    assert config.SESSION_COOKIE_HTTPONLY is True
    assert config.SESSION_COOKIE_SAMESITE == "Lax"


def test_development_config_rejects_a_different_mysql_driver(monkeypatch) -> None:
    from inventory.config import DevelopmentConfig

    monkeypatch.setenv("DATABASE_URL", "mysql+pymysql://inventory:password@127.0.0.1:3307/inventory")

    with pytest.raises(ValueError, match=r"mysql\+mysqldb"):
        DevelopmentConfig()
