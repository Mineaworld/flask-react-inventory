"""Authentication endpoints and role guards for API blueprints."""

from __future__ import annotations

from collections.abc import Callable
from functools import wraps
from typing import Any, ParamSpec, TypeVar

from flask import Blueprint
from flask_login import current_user, login_required, login_user, logout_user
from flask_wtf.csrf import generate_csrf
from sqlalchemy import func, select

from inventory.api_helpers import ApiProblem, data_response, request_json
from inventory.extensions import db, limiter
from inventory.models import Role, User


P = ParamSpec("P")
R = TypeVar("R")


def user_data(user: User) -> dict[str, Any]:
    """Expose only the non-sensitive fields needed by the frontend."""
    role = user.role.value if isinstance(user.role, Role) else str(user.role)
    return {"id": user.id, "username": user.username, "full_name": user.full_name, "role": role}


def has_role(*roles: Role) -> bool:
    """Check a current user's role while accepting SQLite test enum coercion."""
    if not current_user.is_authenticated:
        return False
    value = current_user.role.value if isinstance(current_user.role, Role) else str(current_user.role)
    return value in {role.value for role in roles}


def roles_required(*roles: Role) -> Callable[[Callable[P, R]], Callable[P, R]]:
    """Require a logged-in user with one of the explicitly granted roles."""
    def decorator(view: Callable[P, R]) -> Callable[P, R]:
        @wraps(view)
        @login_required
        def wrapped(*args: P.args, **kwargs: P.kwargs) -> R:
            if not has_role(*roles):
                raise ApiProblem("forbidden", "You do not have permission to perform this action.", 403)
            return view(*args, **kwargs)

        return wrapped

    return decorator


def register_auth_routes(api: Blueprint) -> None:
    """Register session authentication endpoints under the API blueprint."""

    @api.get("/auth/csrf")
    def csrf_token():
        return data_response({"csrf_token": generate_csrf()})

    @api.post("/auth/login")
    @limiter.limit("5 per minute")
    def login():
        payload = request_json()
        username = payload.get("username")
        password = payload.get("password")
        if not isinstance(username, str) or not isinstance(password, str):
            raise ApiProblem("validation_error", "Username and password are required.")
        user = db.session.scalar(select(User).where(func.lower(User.username) == username.strip().casefold()))
        if user is None or not user.is_active or not user.check_password(password):
            raise ApiProblem("invalid_credentials", "Username or password is incorrect.", 401)
        login_user(user)
        return data_response(user_data(user))

    @api.post("/auth/logout")
    @login_required
    def logout():
        logout_user()
        return data_response({"logged_out": True})

    @api.get("/auth/me")
    @login_required
    def me():
        return data_response(user_data(current_user))
