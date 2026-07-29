from __future__ import annotations

from pathlib import Path

from inventory import create_app


def _app_with_fake_frontend(tmp_path: Path):
    frontend_dist = tmp_path / "dist"
    assets = frontend_dist / "assets"
    assets.mkdir(parents=True)
    (frontend_dist / "index.html").write_text(
        "<!doctype html><title>Inventory SPA</title><div id=\"root\"></div>",
        encoding="utf-8",
    )
    (assets / "app.js").write_text("window.inventoryApp = true;", encoding="utf-8")
    return create_app(
        {
            "TESTING": True,
            "WTF_CSRF_ENABLED": False,
            "FRONTEND_DIST": str(frontend_dist),
        }
    )


def test_root_serves_built_spa_index(tmp_path: Path) -> None:
    app = _app_with_fake_frontend(tmp_path)

    response = app.test_client().get("/")

    assert response.status_code == 200
    assert response.mimetype == "text/html"
    assert b"Inventory SPA" in response.data


def test_client_route_falls_back_to_spa_index(tmp_path: Path) -> None:
    app = _app_with_fake_frontend(tmp_path)

    response = app.test_client().get("/catalog")

    assert response.status_code == 200
    assert response.mimetype == "text/html"
    assert b"Inventory SPA" in response.data


def test_built_asset_is_served_from_frontend_dist(tmp_path: Path) -> None:
    app = _app_with_fake_frontend(tmp_path)

    response = app.test_client().get("/assets/app.js")

    assert response.status_code == 200
    assert response.mimetype in {"application/javascript", "text/javascript"}
    assert response.data == b"window.inventoryApp = true;"


def test_missing_built_asset_is_not_replaced_with_spa_html(tmp_path: Path) -> None:
    app = _app_with_fake_frontend(tmp_path)

    response = app.test_client().get("/assets/missing.js")

    assert response.status_code == 404
    assert response.is_json
    assert response.get_json()["error"]["code"] == "not_found"


def test_unknown_api_route_keeps_json_404_when_spa_exists(tmp_path: Path) -> None:
    app = _app_with_fake_frontend(tmp_path)

    response = app.test_client().get("/api/v1/not-a-route")

    assert response.status_code == 404
    assert response.is_json
    assert response.get_json() == {
        "error": {
            "code": "not_found",
            "message": "The requested resource was not found.",
        }
    }


def test_root_explains_how_to_build_frontend_when_dist_is_missing(tmp_path: Path) -> None:
    app = create_app(
        {
            "TESTING": True,
            "WTF_CSRF_ENABLED": False,
            "FRONTEND_DIST": str(tmp_path / "missing-dist"),
        }
    )

    response = app.test_client().get("/")

    assert response.status_code == 503
    assert response.get_json() == {
        "error": {
            "code": "frontend_build_missing",
            "message": "The React production build is unavailable. Run `npm run build` in frontend or use the Vite development server.",
        }
    }


def test_health_endpoint_still_works_when_frontend_dist_is_missing(tmp_path: Path) -> None:
    app = create_app(
        {
            "TESTING": True,
            "WTF_CSRF_ENABLED": False,
            "FRONTEND_DIST": str(tmp_path / "missing-dist"),
        }
    )

    response = app.test_client().get("/api/v1/health")

    assert response.status_code == 200
    assert response.get_json() == {"data": {"service": "inventory-api", "status": "ok"}}
