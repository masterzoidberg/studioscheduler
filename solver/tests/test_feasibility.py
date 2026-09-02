from __future__ import annotations

import time

from dwde_solver import solve_feasibility


def _constraint(id_: str, kind: str, *, selector=None, parameters=None):
    return {
        "id": id_,
        "kind": kind,
        "ruleIds": [f"TEST-{id_}"],
        "selector": selector or {},
        "parameters": parameters or {},
        "explanation": id_,
    }


def bakeoff_problem(conflict: bool = False):
    teachers = [{"id": f"teacher-{index}", "name": f"Teacher {index}"} for index in range(9)]
    rooms = [{"id": f"room-{index}", "name": f"Studio {chr(65 + index)}"} for index in range(3)]
    students = [{"id": f"student-{index}", "name": f"Dancer {index}"} for index in range(30)]

    classes = []
    sessions = []
    for index in range(20):
        class_id = f"class-{index}"
        classes.append(
            {
                "id": class_id,
                "name": f"Fixture Class {index}",
                "subject": ["Ballet", "Jazz", "Tap"][index % 3],
                "level": f"Level {(index % 5) + 1}",
                "durationMinutes": 60,
                "weeklyFrequency": 1,
                "rosterStudentIds": [f"student-{index % 30}", f"student-{(index + 7) % 30}"],
            }
        )
        sessions.append({"id": f"session-{index}", "classId": class_id, "ordinal": 1})

    constraints = [
        _constraint("room-no-overlap", "RESOURCE_NO_OVERLAP", parameters={"resource": "ROOM"}),
        _constraint("teacher-no-overlap", "RESOURCE_NO_OVERLAP", parameters={"resource": "TEACHER"}),
        _constraint("student-no-overlap", "RESOURCE_NO_OVERLAP", parameters={"resource": "STUDENT_ROSTER"}),
        _constraint("grid", "TIME_GRID", parameters={"minutes": 15}),
        _constraint(
            "operating-window",
            "DAY_TIME_WINDOW",
            parameters={"days": ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"], "earliestStart": "16:45", "latestFinish": "21:30"},
        ),
        _constraint(
            "fixed-zero",
            "FIXED_ASSIGNMENT",
            selector={"classNames": ["Fixture Class 0"], "teacherNames": ["Teacher 0"], "roomNames": ["Studio A"]},
            parameters={"day": "Monday", "start": "16:45", "end": "17:45"},
        ),
    ]
    if conflict:
        constraints.append(
            _constraint(
                "fixed-one-conflict",
                "FIXED_ASSIGNMENT",
                selector={"classNames": ["Fixture Class 1"], "teacherNames": ["Teacher 1"], "roomNames": ["Studio A"]},
                parameters={"day": "Monday", "start": "16:45", "end": "17:45"},
            )
        )

    return {
        "planningDatasetVersion": 1,
        "classes": classes,
        "sessions": sessions,
        "teachers": teachers,
        "rooms": rooms,
        "students": students,
        "constraintModel": {
            "schemaVersion": "1.0",
            "compilerVersion": "fixture",
            "rulebookVersion": 3,
            "hardConstraints": constraints,
        },
    }


def test_feasible_20_session_fixture_solves_under_five_seconds():
    started = time.perf_counter()
    result = solve_feasibility(bakeoff_problem(), max_seconds=5)
    elapsed = time.perf_counter() - started

    assert result["status"] == "FEASIBLE"
    assert len(result["assignments"]) == 20
    assert result["unsupportedConstraintIds"] == []
    assert elapsed < 5


def test_same_input_seed_and_single_worker_are_deterministic_on_same_runner():
    first = solve_feasibility(bakeoff_problem(), max_seconds=5)
    second = solve_feasibility(bakeoff_problem(), max_seconds=5)

    assert first["status"] == second["status"] == "FEASIBLE"
    assert first["assignments"] == second["assignments"]


def test_infeasible_fixture_identifies_conflicting_policy_fixed_pair():
    result = solve_feasibility(bakeoff_problem(conflict=True), max_seconds=5)

    assert result["status"] == "INFEASIBLE"
    assert set(result["blockingConstraintIds"]) == {"fixed-zero", "fixed-one-conflict"}


def test_unsupported_constraint_kind_fails_closed():
    problem = bakeoff_problem()
    problem["constraintModel"]["hardConstraints"].append(
        _constraint("not-yet-supported", "ROOM_CAPACITY", selector={"roomNames": ["Studio C"]}, parameters={"maxDancers": 15})
    )

    result = solve_feasibility(problem)
    assert result["status"] == "UNSUPPORTED"
    assert result["unsupportedConstraintIds"] == ["not-yet-supported"]
    assert result["assignments"] == []
