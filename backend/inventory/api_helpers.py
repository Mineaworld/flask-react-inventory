"""Shared API validation, serialization, and pagination helpers."""

from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal, InvalidOperation
from enum import Enum
from math import ceil
from typing import Any, Mapping

from flask import Response, jsonify, request


class ApiProblem(Exception):
    """A safe, deliberate client-facing API failure."""

    def __init__(
        self,
        code: str,
        message: str,
        status: int = 400,
        fields: dict[str, str] | None = None,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.status = status
        self.fields = fields


def error_response(problem: ApiProblem) -> tuple[Response, int]:
    """Serialize a known API problem using the public error envelope."""
    error: dict[str, Any] = {"code": problem.code, "message": problem.message}
    if problem.fields:
        error["fields"] = problem.fields
    return jsonify({"error": error}), problem.status


def json_safe(value: Any) -> Any:
    """Convert SQLAlchemy values into JSON-safe primitives without float loss."""
    if isinstance(value, Decimal):
        return str(value)
    if isinstance(value, Enum):
        return value.value
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if isinstance(value, Mapping):
        return {str(key): json_safe(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [json_safe(item) for item in value]
    return value


def data_response(data: Any, status: int = 200) -> tuple[Response, int]:
    """Return a JSON success envelope."""
    return jsonify({"data": json_safe(data)}), status


def list_response(items: list[Any], page: int, per_page: int, total: int) -> tuple[Response, int]:
    """Return a paginated JSON list using the fixed public response shape."""
    pages = ceil(total / per_page) if total else 0
    return (
        jsonify(
            {
                "data": json_safe(items),
                "meta": {"page": page, "per_page": per_page, "total": total, "pages": pages},
            }
        ),
        200,
    )


def request_json() -> dict[str, Any]:
    """Read a JSON object, rejecting malformed or scalar request bodies."""
    payload = request.get_json(silent=True)
    if not isinstance(payload, dict):
        raise ApiProblem("validation_error", "A JSON object is required.")
    return payload


def positive_int(value: Any, field: str) -> int:
    """Parse a mathematically integral, positive API identifier without truncation."""
    if isinstance(value, bool):
        raise ApiProblem("validation_error", "Request validation failed.", fields={field: "Must be a positive integer."})
    try:
        parsed = Decimal(str(value))
    except (InvalidOperation, TypeError, ValueError):
        raise ApiProblem("validation_error", "Request validation failed.", fields={field: "Must be a positive integer."}) from None
    if not parsed.is_finite() or parsed != parsed.to_integral_value() or parsed < 1:
        raise ApiProblem("validation_error", "Request validation failed.", fields={field: "Must be a positive integer."})
    return int(parsed)


def decimal_value(
    value: Any,
    field: str,
    *,
    positive: bool = False,
    nonnegative: bool = False,
    precision: int | None = None,
    scale: int | None = None,
) -> Decimal:
    """Parse a finite decimal that fits the persisted database column exactly."""
    try:
        parsed = Decimal(str(value))
    except (InvalidOperation, TypeError, ValueError):
        raise ApiProblem("validation_error", "Request validation failed.", fields={field: "Must be a decimal value."}) from None
    if not parsed.is_finite() or (positive and parsed <= 0) or (nonnegative and parsed < 0):
        rule = "Must be greater than zero." if positive else "Must be zero or greater."
        raise ApiProblem("validation_error", "Request validation failed.", fields={field: rule})
    if scale is not None:
        fractional_digits = max(-parsed.as_tuple().exponent, 0)
        if fractional_digits > scale:
            raise ApiProblem(
                "validation_error",
                "Request validation failed.",
                fields={field: f"Must have at most {scale} decimal places."},
            )
    if precision is not None:
        if scale is None:
            raise ValueError("Decimal precision validation requires a scale.")
        integer_digits = max(parsed.adjusted() + 1, 0) if parsed else 0
        if integer_digits > precision - scale:
            raise ApiProblem(
                "validation_error",
                "Request validation failed.",
                fields={field: f"Must fit DECIMAL({precision}, {scale})."},
            )
    return parsed.quantize(Decimal(1).scaleb(-scale)) if scale is not None else parsed


def required_text(payload: Mapping[str, Any], field: str, max_length: int | None = None) -> str:
    """Read a non-blank string input with a stable field error."""
    value = payload.get(field)
    if not isinstance(value, str) or not value.strip():
        raise ApiProblem("validation_error", "Request validation failed.", fields={field: "This field is required."})
    result = value.strip()
    if max_length and len(result) > max_length:
        raise ApiProblem("validation_error", "Request validation failed.", fields={field: f"Must be at most {max_length} characters."})
    return result


def optional_text(payload: Mapping[str, Any], field: str, max_length: int | None = None) -> str | None:
    """Read an optional nullable string input."""
    if field not in payload or payload[field] is None:
        return None
    value = payload[field]
    if not isinstance(value, str):
        raise ApiProblem("validation_error", "Request validation failed.", fields={field: "Must be text."})
    result = value.strip()
    if max_length and len(result) > max_length:
        raise ApiProblem("validation_error", "Request validation failed.", fields={field: f"Must be at most {max_length} characters."})
    return result or None


def pagination_args() -> tuple[int, int]:
    """Return bounded pagination parameters shared by all list endpoints."""
    try:
        page = int(request.args.get("page", "1"))
        per_page = int(request.args.get("per_page", "10"))
    except ValueError:
        raise ApiProblem("validation_error", "Pagination values must be integers.") from None
    if page < 1 or not 1 <= per_page <= 100:
        raise ApiProblem("validation_error", "Pagination values are out of range.")
    return page, per_page


def sort_args(allowed: Mapping[str, Any], default: str = "id") -> tuple[Any, bool]:
    """Resolve only fixed model columns, preventing SQL injection via sorting."""
    key = request.args.get("sort", default)
    direction = request.args.get("direction", "asc").lower()
    if key not in allowed or direction not in {"asc", "desc"}:
        raise ApiProblem("validation_error", "Unsupported sorting options.")
    return allowed[key], direction == "desc"


def status_arg() -> bool | None:
    """Resolve an optional active/archive list filter without exposing raw query values."""
    status = request.args.get("status", "all").lower()
    if status == "all":
        return None
    if status == "active":
        return True
    if status == "archived":
        return False
    raise ApiProblem(
        "validation_error",
        "Request validation failed.",
        fields={"status": "Must be active, archived, or all."},
    )
