"""Application configuration with a deliberate MySQL-only runtime policy."""

from __future__ import annotations

import os
from typing import Any


class BaseConfig:
    """Settings shared by runtime and tests."""

    SQLALCHEMY_TRACK_MODIFICATIONS = False
    SQLALCHEMY_ENGINE_OPTIONS = {"pool_pre_ping": True}
    RATELIMIT_STORAGE_URI = "memory://"
    RATELIMIT_DEFAULT: list[str] = []
    # Flask-WTF passes this value directly to itsdangerous, which expects seconds.
    WTF_CSRF_TIME_LIMIT = 60 * 60
    JSON_SORT_KEYS = False

    def __init__(self) -> None:
        self.SECRET_KEY = os.getenv("SECRET_KEY", "development-secret-change-me")

    def to_mapping(self) -> dict[str, Any]:
        return {
            key: getattr(self, key)
            for key in dir(self)
            if key.isupper() and not callable(getattr(self, key))
        }


def _mysql_database_url() -> str:
    database_url = os.getenv("DATABASE_URL")
    if not database_url or not database_url.startswith("mysql+mysqldb://"):
        raise ValueError("DATABASE_URL must be a mysql+mysqldb MySQL URL.")
    return database_url


class DevelopmentConfig(BaseConfig):
    """Local development keeps safe defaults while requiring the MySQL application database."""

    def __init__(self) -> None:
        super().__init__()
        self.SQLALCHEMY_DATABASE_URI = _mysql_database_url()


class ProductionConfig(BaseConfig):
    """Runtime configuration that rejects unsafe secrets and volatile rate limiting."""

    SESSION_COOKIE_SECURE = True
    SESSION_COOKIE_HTTPONLY = True
    SESSION_COOKIE_SAMESITE = "Lax"

    def __init__(self) -> None:
        super().__init__()
        self.SQLALCHEMY_DATABASE_URI = _mysql_database_url()

        secret_key = self.SECRET_KEY.strip() if self.SECRET_KEY else ""
        if (
            len(secret_key) < 32
            or secret_key in {"development-secret-change-me", "replace-with-a-long-random-secret"}
        ):
            raise ValueError("SECRET_KEY must be a non-default value with at least 32 characters.")
        self.SECRET_KEY = secret_key

        rate_limit_storage_uri = os.getenv("RATELIMIT_STORAGE_URI", "").strip()
        if not rate_limit_storage_uri or rate_limit_storage_uri.lower().startswith("memory://"):
            raise ValueError("RATELIMIT_STORAGE_URI must use an explicit non-memory backend in production.")
        self.RATELIMIT_STORAGE_URI = rate_limit_storage_uri


class TestConfig(BaseConfig):
    """Tests can run without a MySQL server while still accepting a dedicated test URL."""

    __test__ = False
    TESTING = True
    WTF_CSRF_ENABLED = False

    def __init__(self) -> None:
        super().__init__()
        self.SECRET_KEY = "test-secret"
        self.SQLALCHEMY_DATABASE_URI = os.getenv(
            "TEST_DATABASE_URL", "sqlite+pysqlite:///:memory:"
        )
