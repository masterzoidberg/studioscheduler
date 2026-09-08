from __future__ import annotations

import json
from pathlib import Path

import pytest

from dwde_solver.feasibility import solve_feasibility

FIXTURE = Path(__file__).resolve().parents[2] / "tests" / "fixtures" / "solver-runtime-parity.json"


def cases():
    payload = json.loads(FIXTURE.read_text(encoding="utf-8"))
    assert payload["schemaVersion"] == "1.0"
    return payload["cases"]


@pytest.mark.parametrize("case", cases(), ids=lambda case: case["id"])
def test_shared_runtime_parity_solver_status(case):
    result = solve_feasibility(case["problem"], max_seconds=2.0)
    assert result["status"] == case["expectedSolverStatus"]
    assert result.get("unsupportedConstraintIds", []) == []
    assert result.get("missingPreconditionConstraintIds", []) == []

    if result["status"] == "FEASIBLE":
        expected_session_ids = sorted(session["id"] for session in case["problem"]["sessions"])
        assert sorted(item["sessionId"] for item in result["assignments"]) == expected_session_ids
