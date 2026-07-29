from __future__ import annotations

import pytest

from inventory import create_app


def test_health_endpoint_returns_service_status() -> None:
    app = create_app({"TESTING": True, "WTF_CSRF_ENABLED": False})

    response = app.test_client().get("/api/v1/health")

    assert response.status_code == 200
    assert response.get_json() == {"data": {"service": "inventory-api", "status": "ok"}}


def test_health_endpoint_sets_browser_security_headers() -> None:
    app = create_app({"TESTING": True, "WTF_CSRF_ENABLED": False})

    response = app.test_client().get("/api/v1/health")

    assert response.headers["X-Content-Type-Options"] == "nosniff"
    assert response.headers["Referrer-Policy"] == "strict-origin-when-cross-origin"
    assert response.headers["Content-Security-Policy"].startswith("default-src 'self';")
    assert "frame-ancestors 'none'" in response.headers["Content-Security-Policy"]


def test_missing_route_uses_standard_error_envelope() -> None:
    app = create_app({"TESTING": True, "WTF_CSRF_ENABLED": False})

    response = app.test_client().get("/api/v1/missing")

    assert response.status_code == 404
    assert response.get_json() == {
        "error": {
            "code": "not_found",
            "message": "The requested resource was not found.",
        }
    }


def test_testing_apps_reraise_unexpected_exceptions() -> None:
    app = create_app({"TESTING": True, "WTF_CSRF_ENABLED": False})

    @app.get("/api/v1/test-exception")
    def test_exception() -> None:
        raise RuntimeError("expected test failure")

    with pytest.raises(RuntimeError, match="expected test failure"):
        app.test_client().get("/api/v1/test-exception")


def test_non_testing_apps_return_json_for_unexpected_exceptions(monkeypatch) -> None:
    monkeypatch.setenv("DATABASE_URL", "mysql+mysqldb://inventory:password@127.0.0.1:3307/inventory")
    monkeypatch.setenv("SECRET_KEY", "a-production-secret-key-that-is-at-least-32-characters")
    monkeypatch.setenv("RATELIMIT_STORAGE_URI", "redis://127.0.0.1:6379/0")
    app = create_app({"TESTING": False, "WTF_CSRF_ENABLED": False})

    @app.get("/api/v1/test-exception")
    def test_exception() -> None:
        raise RuntimeError("expected production failure")

    response = app.test_client().get("/api/v1/test-exception")

    assert response.status_code == 500
    assert response.get_json() == {
        "error": {
            "code": "internal_error",
            "message": "An unexpected server error occurred.",
        }
    }
