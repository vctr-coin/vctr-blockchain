"""Exact integer checks for the draft allocation table, without chain access."""

import json
import re
from pathlib import Path

SPEC_PATH = Path(__file__).resolve().parents[1] / "config" / "tokenomics.json"
TOTAL_SUPPLY = 10_000_000_000


def load_spec() -> dict:
    return json.loads(SPEC_PATH.read_text())


def validate_allocations(rows: list[dict]) -> dict:
    """Amounts are whole-token digit strings, never floating-point numbers.

    This checks arithmetic only. It cannot approve destinations or vesting terms.
    """
    errors = []
    if len(rows) != 6:
        errors.append("Exactly six allocations are required.")
    names = set()
    total = 0
    for index, row in enumerate(rows, 1):
        name = row.get("name")
        if not isinstance(name, str) or not name.strip():
            errors.append(f"Allocation {index}: name is required.")
        else:
            normalized = name.strip().casefold()
            if normalized in names:
                errors.append(f"Allocation {index}: duplicate name.")
            names.add(normalized)
        amount = row.get("amount_tokens")
        if not isinstance(amount, str) or not re.fullmatch(r"[0-9]{1,11}", amount):
            errors.append(f"Allocation {index}: use a whole-token digit string (up to 11 digits).")
        elif int(amount) <= 0:
            errors.append(f"Allocation {index}: amount must be positive.")
        else:
            total += int(amount)
    if total != TOTAL_SUPPLY:
        errors.append("Allocations must sum to exactly 10000000000 tokens.")
    return {
        "arithmetic_valid": not errors,
        "allocated_tokens": str(total),
        "required_tokens": str(TOTAL_SUPPLY),
        "errors": errors,
        "deployment_ready": False,
    }
