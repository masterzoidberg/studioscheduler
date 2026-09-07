from __future__ import annotations

import json
from pathlib import Path

from dwde_solver import solve_feasibility

FIXTURE_PATH = Path(__file__).resolve().parents[2] / "tests" / "fixtures" / "session-lock-semantics.json"


def _constraint(id_: str, kind: str, *, selector=None, parameters=None):
    return {
        "id": id_,
        "kind": kind,
        "ruleIds": [],
        "selector": selector or {},
        "parameters": parameters or {},
        "explanation": id_,
    }


def _shared_problem() -> tuple[dict, dict]:
    fixture = json.loads(FIXTURE_PATH.read_text(encoding="utf-8"))
    problem = {
        "classes": [fixture["class"]],
        "sessions": fixture["effectiveSolverSessions"],
        "teachers": fixture["teachers"],
        "rooms": fixture["rooms"],
        "students": [],
        "constraintModel": {
            "hardConstraints": [
                _constraint("teacher-no-overlap", "RESOURCE_NO_OVERLAP", parameters={"resource": "TEACHER"}),
                _constraint("room-no-overlap", "RESOURCE_NO_OVERLAP", parameters={"resource": "ROOM"}),
                _constraint("grid", "TIME_GRID", parameters={"minutes": 15}),
            ],
            "governanceAssertions": [],
        },
        "preflight": {"validatedDelegatedConstraintIds": []},
    }
    return fixture, problem


def test_shared_multi_session_fixture_locks_exact_session_id_and_canonical_duration():
    fixture, problem = _shared_problem()
    result = solve_feasibility(problem, max_seconds=2)
    assert result["status"] == "FEASIBLE"
    assignments = {item["sessionId"]: item for item in result["assignments"]}
    assert assignments["multi-session-1"] == fixture["expectedLockedAssignment"]
    assert (assignments["multi-session-2"]["day"], assignments["multi-session-2"]["startTime"]) != ("Monday", "18:30")


def test_conflicting_policy_and_runtime_lock_report_both_stable_ids():
    fixture, problem = _shared_problem()
    problem["classes"][0]["weeklyFrequency"] = 1
    problem["sessions"] = [fixture["effectiveSolverSessions"][0]]
    problem["constraintModel"]["hardConstraints"].append(
        _constraint(
            "policy-fixed",
            "FIXED_ASSIGNMENT",
            selector={"classNames": ["Multi Ballet"], "teacherNames": ["Teacher A"], "roomNames": ["Studio A"]},
            parameters={"day": "Monday", "start": "17:00"},
        )
    )
    result = solve_feasibility(problem, max_seconds=2)
    assert result["status"] == "INFEASIBLE"
    assert set(result["blockingConstraintIds"]) == {"policy-fixed", "runtime-lock:multi-session-1"}


def test_impossible_runtime_lock_reports_session_specific_lock_id():
    fixture, problem = _shared_problem()
    problem["classes"][0]["weeklyFrequency"] = 1
    problem["sessions"] = [fixture["effectiveSolverSessions"][0]]
    problem["constraintModel"]["hardConstraints"].append(
        _constraint(
            "monday-close",
            "DAY_TIME_WINDOW",
            parameters={"days": ["Monday"], "latestFinish": "19:30"},
        )
    )
    result = solve_feasibility(problem, max_seconds=2)
    assert result["status"] == "INFEASIBLE"
    assert result["blockingConstraintIds"] == ["runtime-lock:multi-session-1"]
