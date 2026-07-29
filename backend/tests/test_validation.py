from __future__ import annotations

from decimal import Decimal

import pytest

from inventory.api_helpers import ApiProblem, positive_int


@pytest.mark.parametrize("value", [1.75, Decimal("1.75"), "1.75", True, False, 0, -1, "zero", None])
def test_positive_int_does_not_truncate_1_75_to_record_id_1_or_accept_invalid_ids(value: object) -> None:
    with pytest.raises(ApiProblem) as error:
        positive_int(value, "record_id")

    assert error.value.fields == {"record_id": "Must be a positive integer."}


@pytest.mark.parametrize("value", [1, 1.0, Decimal("1.0"), "1", "1.0"])
def test_positive_int_accepts_mathematically_integral_identifiers(value: object) -> None:
    assert positive_int(value, "record_id") == 1
