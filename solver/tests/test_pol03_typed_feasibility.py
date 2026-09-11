from __future__ import annotations

from copy import deepcopy

from dwde_solver.typed_feasibility import solve_feasibility


def _problem(constraints):
    qualified = {
        "id": "fixture-qualification",
        "kind": "TEACHER_SUBJECT_DOMAIN",
        "ruleIds": ["FIXTURE-QUALIFICATION"],
        "selector": {"teacherIds": ["teacher-a", "teacher-b"]},
        "parameters": {},
        "explanation": "The fixture explicitly supplies a reviewed qualification domain.",
    }
    return {
        "contractVersion": "1.0",
        "context": {"studioId": "pol03", "rulebookVersion": 6, "planningDatasetVersion": 1, "compilerVersion": "dwde-ir-0.6"},
        "teachers": [{"id": "teacher-a", "name": "Teacher A"}, {"id": "teacher-b", "name": "Teacher B"}],
        "rooms": [{"id": "room-a", "name": "Room", "capacity": 20, "features": []}],
        "students": [{"id": "student-a", "name": "Participant A", "level": "L1", "cohortIds": []}, {"id": "student-b", "name": "Participant B", "level": "L1", "cohortIds": []}],
        "classes": [
            {"id": "class-a", "name": "Class A", "subject": "A", "level": "L1", "durationMinutes": 45, "weeklyFrequency": 1, "rosterStudentIds": ["student-a"], "companyOnly": False},
            {"id": "class-b", "name": "Class B", "subject": "B", "level": "L1", "durationMinutes": 60, "weeklyFrequency": 1, "rosterStudentIds": ["student-b"], "companyOnly": False},
            {"id": "class-c", "name": "Class C", "subject": "C", "level": "L1", "durationMinutes": 60, "weeklyFrequency": 1, "rosterStudentIds": ["student-a"], "companyOnly": False},
        ],
        "sessions": [
            {"id": "session-a", "classId": "class-a", "ordinal": 1, "durationMinutes": None, "locked": False, "lockedPlacement": None},
            {"id": "session-b", "classId": "class-b", "ordinal": 1, "durationMinutes": None, "locked": False, "lockedPlacement": None},
            {"id": "session-c", "classId": "class-c", "ordinal": 1, "durationMinutes": None, "locked": False, "lockedPlacement": None},
        ],
        "constraintModel": {"schemaVersion": "1.0", "compilerVersion": "dwde-ir-0.6", "rulebookVersion": 6, "planningDatasetVersion": 1, "activeRuleCount": len(constraints) + 1, "hardConstraints": [*constraints, qualified], "objectivePrioritySpine": [], "governanceAssertions": [], "uncompiledConstraintRuleIds": [], "completeHardConstraintCompilation": True},
        "preflight": {"validatedDelegatedConstraintIds": []},
    }


def _fixed(identifier, class_name, day, start, end, teacher="Teacher A"):
    return {"id": identifier, "kind": "FIXED_ASSIGNMENT", "ruleIds": [identifier], "selector": {"classNames": [class_name], "teacherNames": [teacher]}, "parameters": {"day": day, "start": start, "end": end}, "explanation": identifier}


def test_direct_after_uses_variable_duration_and_exact_endpoint_equality():
    direct = {"id": "direct", "kind": "DIRECTLY_AFTER", "ruleIds": ["SEQ"], "selector": {"sessionIds": ["session-a", "session-b"]}, "parameters": {"predecessorSessionId": "session-a", "successorSessionId": "session-b"}, "explanation": "direct"}
    legal = _problem([direct, _fixed("a", "Class A", "Monday", "16:00", "16:45"), _fixed("b", "Class B", "Monday", "16:45", "17:45")])
    gap = deepcopy(legal)
    gap["constraintModel"]["hardConstraints"][2] = _fixed("b", "Class B", "Monday", "17:00", "18:00")
    assert solve_feasibility(legal)["status"] == "FEASIBLE"
    assert solve_feasibility(gap)["status"] == "INFEASIBLE"


def test_participant_group_overlap_and_maximum_distinct_days_are_hard():
    overlap = {"id": "group", "kind": "PARTICIPANT_NO_OVERLAP", "ruleIds": ["GROUP"], "selector": {"participantIds": ["student-a", "student-b"]}, "parameters": {}, "explanation": "group"}
    overlap_problem = _problem([overlap, _fixed("a", "Class A", "Monday", "16:00", "16:45"), _fixed("b", "Class B", "Monday", "16:30", "17:30")])
    assert solve_feasibility(overlap_problem)["status"] == "INFEASIBLE"

    maximum = {"id": "max", "kind": "MAX_ATTENDANCE_DAYS", "ruleIds": ["MAX"], "selector": {"participantIds": ["student-a"]}, "parameters": {"maxDays": 1}, "explanation": "max"}
    max_problem = _problem([maximum, _fixed("a", "Class A", "Monday", "16:00", "16:45"), _fixed("c", "Class C", "Tuesday", "16:00", "17:00")])
    assert solve_feasibility(max_problem)["status"] == "INFEASIBLE"


def test_linked_arrival_uses_signed_inclusive_bounds_and_requires_same_day_attendance():
    linked = {"id": "linked", "kind": "LINKED_ARRIVAL", "ruleIds": ["ARR"], "selector": {"teacherIds": ["teacher-a"], "participantIds": ["student-a"]}, "parameters": {"teacherId": "teacher-a", "participantId": "student-a", "minOffsetMinutes": -15, "maxOffsetMinutes": 30}, "explanation": "linked"}
    boundary = _problem([linked, _fixed("a", "Class A", "Monday", "16:00", "16:45", "Teacher B"), _fixed("b", "Class B", "Monday", "16:30", "17:30"), _fixed("c", "Class C", "Wednesday", "16:00", "17:00", "Teacher B")])
    assert solve_feasibility(boundary)["status"] == "FEASIBLE"
    outside = deepcopy(boundary)
    outside["constraintModel"]["hardConstraints"][2] = _fixed("b", "Class B", "Monday", "16:45", "17:45")
    assert solve_feasibility(outside)["status"] == "INFEASIBLE"
    absent_day = deepcopy(boundary)
    absent_day["constraintModel"]["hardConstraints"][2] = _fixed("b", "Class B", "Tuesday", "16:30", "17:30")
    assert solve_feasibility(absent_day)["status"] == "INFEASIBLE"


def test_missing_or_absent_stable_relationship_references_fail_closed():
    missing = {"id": "direct", "kind": "DIRECTLY_AFTER", "ruleIds": ["SEQ"], "selector": {"sessionIds": ["session-a", "missing"]}, "parameters": {"predecessorSessionId": "session-a", "successorSessionId": "missing"}, "explanation": "direct"}
    problem = _problem([missing])
    try:
        solve_feasibility(problem)
        assert False, "missing endpoint must fail"
    except ValueError as error:
        assert "missing direct-after session endpoint" in str(error)

    absent = {"id": "linked", "kind": "LINKED_ARRIVAL", "ruleIds": ["ARR"], "selector": {"teacherIds": ["teacher-a"], "participantIds": ["student-b"]}, "parameters": {"teacherId": "teacher-a", "participantId": "student-b", "minOffsetMinutes": 0, "maxOffsetMinutes": 30}, "explanation": "linked"}
    absent_problem = _problem([absent])
    absent_problem["classes"][1]["rosterStudentIds"] = []
    try:
        solve_feasibility(absent_problem)
        assert False, "absent roster participant must fail"
    except ValueError as error:
        assert "absent from every class roster" in str(error)


def test_participant_latest_finish_uses_stable_roster_identity_and_end_time():
    latest = {"id": "latest", "kind": "LATEST_FINISH_BY_PARTICIPANT", "ruleIds": ["LATEST"], "selector": {"participantIds": ["student-a"]}, "parameters": {"latestFinish": "20:30"}, "explanation": "latest"}
    boundary = _problem([latest, _fixed("a", "Class A", "Monday", "19:45", "20:30")])
    outside = _problem([latest, _fixed("a", "Class A", "Monday", "20:00", "20:45")])
    assert solve_feasibility(boundary)["status"] == "FEASIBLE"
    assert solve_feasibility(outside)["status"] == "INFEASIBLE"
