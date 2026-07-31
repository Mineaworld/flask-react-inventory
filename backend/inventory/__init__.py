# init flask app
from __future__ import annotations

from collections.abc import Mapping
import os
from pathlib import Path
from typing import Any

from dotenv import load_dotenv
from flask import Blueprint, Flask, abort, jsonify, send_from_directory, session
from sqlalchemy import select
from werkzeug.utils import safe_join

from inventory.cli import seed_demo
from inventory.config import DevelopmentConfig, ProductionConfig, TestConfig
from inventory.errors import register_error_handlers
from inventory.extensions import csrf, db, limiter, login_manager, migrate


def create_app(test_config: Mapping[str, Any] | None = None) -> Flask:
    load_dotenv(Path(__file__).resolve().parent.parent / ".env")

    app = Flask(__name__)
    if test_config and test_config.get("TESTING"):
        config = TestConfig()
    elif os.getenv("FLASK_ENV") == "development":
        config = DevelopmentConfig()
    else:
        config = ProductionConfig()
    app.config.from_mapping(config.to_mapping())
    if test_config:
        app.config.from_mapping(test_config)
    app.config.setdefault(
        "FRONTEND_DIST",
        str(Path(__file__).resolve().parents[2] / "frontend" / "dist"),
    )

    db.init_app(app)
    migrate.init_app(app, db, compare_type=True)
    login_manager.init_app(app)
    csrf.init_app(app)
    limiter.init_app(app)

    from inventory import models  # noqa: F401

    from inventory.models import User

    def clear_login_session() -> None:
        for key in ("_user_id", "_fresh", "_id"):
            session.pop(key, None)

    @login_manager.user_loader
    def load_user(user_id: str) -> User | None:
        try:
            user = db.session.scalar(
                select(User).where(User.id == int(user_id)).execution_options(populate_existing=True)
            )
        except (TypeError, ValueError):
            return None
        if user is None or not user.is_active:
            clear_login_session()
            return None
        return user

    @app.before_request
    def clear_inactive_session() -> None:
        from flask import request
        if not request.path.startswith("/api/"):
            return
            
        user_id = session.get("_user_id")
        if user_id is not None:
            load_user(str(user_id))

    @login_manager.unauthorized_handler
    def unauthorized() -> tuple[Any, int]:
        return jsonify({"error": {"code": "authentication_required", "message": "Authentication is required."}}), 401

    api = Blueprint("api", __name__, url_prefix="/api/v1")

    @api.get("/health")
    def health() -> tuple[Any, int]:
        return jsonify({"data": {"service": "inventory-api", "status": "ok"}}), 200

    from inventory.api import register_api_routes

    register_api_routes(api)
    app.register_blueprint(api)

    @app.after_request
    def add_security_headers(response):
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        response.headers["Content-Security-Policy"] = (
            "default-src 'self'; "
            "base-uri 'self'; "
            "connect-src 'self'; "
            "font-src 'self' https://fonts.gstatic.com; "
            "frame-ancestors 'none'; "
            "img-src 'self' data:; "
            "object-src 'none'; "
            "script-src 'self'; "
            "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com"
        )
        return response

    # serve frontend assets
    @app.get("/", defaults={"frontend_path": ""})
    @app.get("/<path:frontend_path>")
    def serve_frontend(frontend_path: str):
        if frontend_path == "api/v1" or frontend_path.startswith("api/v1/"):
            abort(404)

        frontend_dist = Path(app.config["FRONTEND_DIST"])
        index_path = frontend_dist / "index.html"
        if not index_path.is_file():
            return (
                jsonify(
                    {
                        "error": {
                            "code": "frontend_build_missing",
                            "message": (
                                "The React production build is unavailable. Run `npm run build` in "
                                "frontend or use the Vite development server."
                            ),
                        }
                    }
                ),
                503,
            )

        safe_asset_path = safe_join(str(frontend_dist), frontend_path) if frontend_path else None
        if safe_asset_path and Path(safe_asset_path).is_file():
            return send_from_directory(frontend_dist, frontend_path)
        if frontend_path.startswith("assets/"):
            abort(404)
        return send_from_directory(frontend_dist, "index.html")

    app.cli.add_command(seed_demo)
    register_error_handlers(app)

    return app
