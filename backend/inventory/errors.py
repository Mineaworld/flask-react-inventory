"""Consistent JSON error responses for API consumers."""

from __future__ import annotations

from typing import Any

from flask import Flask, Response, jsonify
from flask_limiter.errors import RateLimitExceeded
from flask_wtf.csrf import CSRFError
from werkzeug.exceptions import HTTPException

from inventory.api_helpers import ApiProblem


def error_response(
    code: str,
    message: str,
    status: int,
    fields: dict[str, str] | None = None,
) -> tuple[Response, int]:
    """Build the API's standard error response envelope."""
    error: dict[str, Any] = {"code": code, "message": message}
    if fields:
        error["fields"] = fields
    return jsonify({"error": error}), status


def register_error_handlers(app: Flask) -> None:
    """Register API-safe error serialization without leaking implementation detail."""

    @app.errorhandler(ApiProblem)
    def handle_api_problem(error: ApiProblem) -> tuple[Response, int]:
        return error_response(error.code, error.message, error.status, error.fields)

    @app.errorhandler(CSRFError)
    def handle_csrf_error(error: CSRFError) -> tuple[Response, int]:
        return error_response("csrf_failed", "CSRF validation failed.", 400)

    @app.errorhandler(RateLimitExceeded)
    def handle_rate_limit_error(error: RateLimitExceeded) -> tuple[Response, int]:
        return error_response("rate_limited", "Too many requests. Please try again later.", 429)

    @app.errorhandler(HTTPException)
    def handle_http_error(error: HTTPException) -> tuple[Response, int]:
        if error.code == 404:
            return error_response("not_found", "The requested resource was not found.", 404)
        if error.code == 405:
            return error_response("method_not_allowed", "The request method is not allowed.", 405)
        return error_response("request_error", error.description, error.code or 500)

    @app.errorhandler(Exception)
    def handle_unexpected_error(error: Exception) -> tuple[Response, int]:
        if app.testing:
            raise error
        app.logger.exception("Unhandled inventory API error", exc_info=error)
        return error_response("internal_error", "An unexpected server error occurred.", 500)
