from __future__ import annotations

from copy import deepcopy

from dwde_solver.typed_feasibility import solve_feasibility


def _constraint_model(constraints):
    return {
        "schemaVersion": "1.0",
        "compilerVersion": "dwde-ir-0.5",
        "rulebookVersion": 5,
        "planningDatasetVersion": 9,
        "activeRuleCount": len(constraints),
        "hardConstraints": constraints,
        "objectivePrioritySpine": [],
        "objectivePolicies": [],
        "readinessRuleIds": [],
        "governanceAssertions": [],
        "uncompiledConstraintRuleIds": [],
        "completeHardConstraintCompilation": True,
    }


def _problem(constraints, *, capacity=10, features=None, roster_size=0, rooms=None, teachers=None):
    teacher_rows = teachers or [{"id": "teacher-a", "name": "Teacher Renamed"}]
    room_rows = rooms or [
        {"id": "room-a", "name": "Studio Renamed", "capacity": capacity, "features": list(features or [])}
    ]
    students = [
        {"id": f"student-{index}", "name": f"Student {index}", "level": "Level 1", "cohortIds": []}
        for index in range(roster_size)
    ]
    return {
        "contractVersion": "1.0",
        "context": {
            "studioId": "typed-parity-studio",
            "rulebookVersion": 5,
            "planningDatasetVersion": 9,
            "compilerVersion": "dwde-ir-0.5",
        },
        "teachers": teacher_rows,
        "rooms": room_rows,
        "students": students,
        "classes": [
            {
                "id": "class-a",
                "name": "Class Renamed",
                "subject": "Ballet",
                "level": "Level 1",
                "durationMinutes": 60,
                "weeklyFrequency": 1,
                "rosterStudentIds": [student["id"] for student in students],
                "companyOnly": False,
            }
        ],
        "sessions": [
            {
                "id": "session-a",
                "classId": "class-a",
                "ordinal": 1,
                "durationMinutes": None,
                "locked": False,
                "lockedPlacement": None,
            }
        ],
        "constraintModel": _constraint_model(constraints),
        "preflight": {"validatedDelegatedConstraintIds": []},
    }


def _fixed(start: str, end: str, day: str = "Monday"):
    return {
        "id": f"fixed-{day}-{start}",
        "kind": "FIXED_ASSIGNMENT",
        "ruleIds": ["FIX-TEST"],
        "selector": {"classNames": ["Class Renamed"]},
        "parameters": {"day": day, "start": start, "end": end, "lockType": "POLICY_FIXED"},
        "explanation": "Boundary witness",
    }


def test_studio_operating_windows_are_half_open_and_union_within_one_rule():
    operating = {
        "id": "typed-studio-hours",
        "kind": "STUDIO_OPERATING_WINDOWS",
        "ruleIds": ["OPS-001"],
        "selector": {},
        "parameters": {
            "windows": [
                {"day": "Monday", "start": "17:00", "end": "18:00"},
                {"day": "Monday", "start": "19:00", "end": "20:00"},
            ],
            "closedDays": ["Sunday"] if False else [],
        },
        "explanation": "Studio hours",
    }
    legal = _problem([operating, _fixed("17:00", "18:00")])
    illegal_gap = _problem([operating, _fixed("18:00", "19:00")])

    assert solve_feasibility(legal)["status"] == "FEASIBLE"
    assert solve_feasibility(illegal_gap)["status"] == "INFEASIBLE"


def test_room_unavailable_windows_allow_touching_endpoint_but_reject_overlap():
    unavailable = {
        "id": "typed-room-unavailable",
        "kind": "ROOM_UNAVAILABLE_WINDOWS",
        "ruleIds": ["ROOM-TEST"],
        "selector": {"roomIds": ["room-a"]},
        "parameters": {"windows": [{"day": "Monday", "start": "17:00", "end": "18:00"}]},
        "explanation": "Room closure",
    }
    touching = _problem([unavailable, _fixed("16:00", "17:00")])
    overlap = _problem([unavailable, _fixed("16:30", "17:30")])

    assert solve_feasibility(touching)["status"] == "FEASIBLE"
    assert solve_feasibility(overlap)["status"] == "INFEASIBLE"


def test_empty_explicit_qualification_domain_permits_no_classes():
    domain = {
        "id": "typed-qualification-empty",
        "kind": "TEACHER_CLASS_DOMAIN",
        "ruleIds": ["AIM-001"],
        "selector": {"teacherIds": ["teacher-a"]},
        "parameters": {"classIds": []},
        "explanation": "Explicitly no qualified classes",
    }
    assert solve_feasibility(_problem([domain]))["status"] == "INFEASIBLE"


def test_qualification_uses_stable_ids_and_survives_display_rename():
    domain = {
        "id": "typed-qualification",
        "kind": "TEACHER_CLASS_DOMAIN",
        "ruleIds": ["AIM-001"],
        "selector": {"teacherIds": ["teacher-a"]},
        "parameters": {"classIds": ["class-a"]},
        "explanation": "Stable qualification",
    }
    result = solve_feasibility(_problem([domain], teachers=[{"id": "teacher-a", "name": "Completely Different Name"}]))
    assert result["status"] == "FEASIBLE"
    assert result["assignments"][0]["teacherId"] == "teacher-a"


def test_required_teacher_must_also_be_qualified():
    required = {
        "id": "typed-required-teacher",
        "kind": "REQUIRED_TEACHER",
        "ruleIds": ["REQ-T"],
        "selector": {"classIds": ["class-a"], "teacherIds": ["teacher-a"]},
        "parameters": {"teacherId": "teacher-a"},
        "explanation": "Required teacher",
    }
    domain = {
        "id": "typed-qualification-empty",
        "kind": "TEACHER_CLASS_DOMAIN",
        "ruleIds": ["AIM-001"],
        "selector": {"teacherIds": ["teacher-a"]},
        "parameters": {"classIds": []},
        "explanation": "Required teacher is not qualified",
    }
    assert solve_feasibility(_problem([required, domain]))["status"] == "INFEASIBLE"


def test_required_room_uses_stable_room_id_not_name():
    required = {
        "id": "typed-required-room",
        "kind": "REQUIRED_ROOM",
        "ruleIds": ["REQ-R"],
        "selector": {"classIds": ["class-a"], "roomIds": ["room-b"]},
        "parameters": {"roomId": "room-b"},
        "explanation": "Required room",
    }
    rooms = [
        {"id": "room-a", "name": "Old Favorite", "capacity": 10, "features": []},
        {"id": "room-b", "name": "Renamed Required Room", "capacity": 10, "features": []},
    ]
    result = solve_feasibility(_problem([required], rooms=rooms))
    assert result["status"] == "FEASIBLE"
    assert result["assignments"][0]["roomId"] == "room-b"


def test_planning_capacity_missing_fails_closed_and_exemption_is_explicit():
    capacity = {
        "id": "typed-capacity",
        "kind": "ROOM_CAPACITY",
        "ruleIds": ["ROOM-007", "ROOM-008"],
        "selector": {"roomIds": ["room-a"]},
        "parameters": {"capacitySource": "PLANNING_DATASET", "exemptClassIds": []},
        "explanation": "Planning capacity",
    }
    assert solve_feasibility(_problem([capacity], capacity=None, roster_size=1))["status"] == "INFEASIBLE"

    exempt = deepcopy(capacity)
    exempt["parameters"]["exemptClassIds"] = ["class-a"]
    assert solve_feasibility(_problem([exempt], capacity=1, roster_size=2))["status"] == "FEASIBLE"


def test_required_features_are_set_inclusion_over_planning_room_features():
    required_features = {
        "id": "typed-features",
        "kind": "ROOM_REQUIRED_FEATURES",
        "ruleIds": ["ROOM-FEATURES"],
        "selector": {"classIds": ["class-a"]},
        "parameters": {"requiredFeatures": ["sprung-floor", "mirrors"]},
        "explanation": "Feature policy",
    }
    rooms = [
        {"id": "room-a", "name": "Incomplete", "capacity": 10, "features": ["mirrors"]},
        {"id": "room-b", "name": "Complete", "capacity": 10, "features": ["mirrors", "sprung-floor", "barres"]},
    ]
    result = solve_feasibility(_problem([required_features], rooms=rooms))
    assert result["status"] == "FEASIBLE"
    assert result["assignments"][0]["roomId"] == "room-b"


def test_duplicate_and_missing_stable_references_reject_instead_of_falling_through():
    duplicate = {
        "id": "typed-required-room-duplicate",
        "kind": "REQUIRED_ROOM",
        "ruleIds": ["REQ-R"],
        "selector": {"classIds": ["class-a"], "roomIds": ["room-a", "room-a"]},
        "parameters": {"roomId": "room-a"},
        "explanation": "Duplicate witness",
    }
    missing = deepcopy(duplicate)
    missing["id"] = "typed-required-room-missing"
    missing["selector"]["roomIds"] = ["room-missing"]
    missing["parameters"]["roomId"] = "room-missing"

    try:
        solve_feasibility(_problem([duplicate]))
        raise AssertionError("duplicate stable reference should reject")
    except ValueError as error:
        assert "repeats" in str(error)

    try:
        solve_feasibility(_problem([missing]))
        raise AssertionError("missing stable reference should reject")
    except ValueError as error:
        assert "missing" in str(error)
