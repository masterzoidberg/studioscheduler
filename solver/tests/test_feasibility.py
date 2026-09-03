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


def _class(id_: str, name: str, *, subject="Ballet", level="Level 1", duration=60, roster=None, frequency=1):
    return {
        "id": id_,
        "name": name,
        "subject": subject,
        "level": level,
        "durationMinutes": duration,
        "weeklyFrequency": frequency,
        "rosterStudentIds": roster or [],
    }


def _problem(*, classes, constraints, teachers=None, rooms=None, students=None, sessions=None, governance=None, preflight=None):
    teachers = teachers or [{"id": "teacher-a", "name": "Teacher A"}]
    rooms = rooms or [{"id": "room-a", "name": "Studio A"}]
    students = students or []
    if sessions is None:
        sessions = []
        for klass in classes:
            for ordinal in range(1, int(klass.get("weeklyFrequency", 1)) + 1):
                sessions.append({"id": f"session-{klass['id']}-{ordinal}", "classId": klass["id"], "ordinal": ordinal})
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
            "governanceAssertions": governance or [],
        },
        "preflight": preflight or {},
    }


def _fixed(id_: str, class_name: str, day: str, start: str, teacher: str, room: str, end: str | None = None):
    parameters = {"day": day, "start": start}
    if end:
        parameters["end"] = end
    return _constraint(
        id_,
        "FIXED_ASSIGNMENT",
        selector={"classNames": [class_name], "teacherNames": [teacher], "roomNames": [room]},
        parameters=parameters,
    )


def bakeoff_problem(conflict: bool = False):
    teachers = [{"id": f"teacher-{index}", "name": f"Teacher {index}"} for index in range(9)]
    rooms = [{"id": f"room-{index}", "name": f"Studio {chr(65 + index)}"} for index in range(3)]
    students = [{"id": f"student-{index}", "name": f"Dancer {index}", "level": f"Level {(index % 5) + 1}"} for index in range(30)]

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
        _fixed("fixed-zero", "Fixture Class 0", "Monday", "16:45", "Teacher 0", "Studio A", "17:45"),
    ]
    if conflict:
        constraints.append(_fixed("fixed-one-conflict", "Fixture Class 1", "Monday", "16:45", "Teacher 1", "Studio A", "17:45"))

    return _problem(
        classes=classes,
        sessions=sessions,
        teachers=teachers,
        rooms=rooms,
        students=students,
        constraints=constraints,
    )


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


def test_unknown_constraint_kind_fails_closed():
    problem = bakeoff_problem()
    problem["constraintModel"]["hardConstraints"].append(_constraint("not-real", "NOT_A_REAL_IR_KIND"))

    result = solve_feasibility(problem)
    assert result["status"] == "UNSUPPORTED"
    assert result["unsupportedConstraintIds"] == ["not-real"]
    assert result["assignments"] == []


def test_required_lower_level_requires_explicit_preflight_proof():
    delegated = _constraint("lower-level", "REQUIRED_LOWER_LEVEL", parameters={"appliesWhenMarkedRequired": True})
    problem = _problem(classes=[_class("a", "Ballet 5", level="Level 5")], constraints=[delegated])

    blocked = solve_feasibility(problem)
    assert blocked["status"] == "PRECONDITION_REQUIRED"
    assert blocked["missingPreconditionConstraintIds"] == ["lower-level"]

    problem["preflight"] = {"validatedDelegatedConstraintIds": ["lower-level"]}
    allowed = solve_feasibility(problem)
    assert allowed["status"] == "FEASIBLE"
    assert allowed["delegatedConstraintIds"] == ["lower-level"]


def test_day_time_window_days_are_scope_not_forced_days():
    classes = [_class("weekday", "Weekday Class"), _class("saturday", "Saturday Class")]
    constraints = [
        _constraint("weekday-window", "DAY_TIME_WINDOW", parameters={"days": ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"], "earliestStart": "16:45", "latestFinish": "21:30"}),
        _constraint("sat-window", "DAY_TIME_WINDOW", parameters={"days": ["Saturday"], "earliestStart": "09:00", "latestFinish": "15:00"}),
        _fixed("weekday-fixed", "Weekday Class", "Monday", "16:45", "Teacher A", "Studio A", "17:45"),
        _fixed("saturday-fixed", "Saturday Class", "Saturday", "09:00", "Teacher A", "Studio A", "10:00"),
    ]
    result = solve_feasibility(_problem(classes=classes, constraints=constraints))
    assert result["status"] == "FEASIBLE"


def test_level_specific_time_window_override_relaxes_base_limit():
    classes = [_class("level5", "Level 5 Class", level="Level 5", duration=75)]
    constraints = [
        _constraint("base-close", "DAY_TIME_WINDOW", parameters={"days": ["Monday"], "latestFinish": "21:30"}),
        _constraint("level5-close", "DAY_TIME_WINDOW", selector={"levels": ["Level 5"]}, parameters={"days": ["Monday"], "latestFinish": "21:45", "overrides": "base-close"}),
        _fixed("level5-fixed", "Level 5 Class", "Monday", "20:30", "Teacher A", "Studio A", "21:45"),
    ]
    result = solve_feasibility(_problem(classes=classes, constraints=constraints))
    assert result["status"] == "FEASIBLE"


def test_max_teacher_gap_is_enforced_exactly():
    teachers = [{"id": "t", "name": "Teacher A"}, {"id": "other", "name": "Teacher B"}]
    rooms = [{"id": "a", "name": "Studio A"}, {"id": "b", "name": "Studio B"}]
    classes = [_class("a", "Class A"), _class("b", "Class B")]
    constraints = [
        _constraint("teacher-no-overlap", "RESOURCE_NO_OVERLAP", parameters={"resource": "TEACHER"}),
        _constraint("gap", "MAX_GAP", parameters={"resource": "TEACHER", "minutes": 60}),
        _fixed("a-fixed", "Class A", "Monday", "16:45", "Teacher A", "Studio A", "17:45"),
        _fixed("b-fixed", "Class B", "Monday", "19:00", "Teacher A", "Studio B", "20:00"),
    ]
    result = solve_feasibility(_problem(classes=classes, constraints=constraints, teachers=teachers, rooms=rooms))
    assert result["status"] == "INFEASIBLE"


def test_max_workdays_is_enforced():
    classes = [_class(str(index), f"Class {index}") for index in range(5)]
    days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"]
    constraints = [_constraint("workdays", "MAX_WORKDAYS", selector={"teacherNames": ["Teacher A"]}, parameters={"maxDays": 4})]
    constraints.extend(_fixed(f"fixed-{index}", f"Class {index}", day, "16:45", "Teacher A", "Studio A", "17:45") for index, day in enumerate(days))
    result = solve_feasibility(_problem(classes=classes, constraints=constraints))
    assert result["status"] == "INFEASIBLE"


def test_latest_finish_by_level_is_enforced():
    classes = [_class("late", "Late Level 1", level="Level 1")]
    constraints = [
        _constraint("level-close", "LATEST_FINISH_BY_LEVEL", selector={"levels": ["Level 1"]}, parameters={"latestFinish": "20:30"}),
        _fixed("late-fixed", "Late Level 1", "Monday", "20:30", "Teacher A", "Studio A", "21:30"),
    ]
    result = solve_feasibility(_problem(classes=classes, constraints=constraints))
    assert result["status"] == "INFEASIBLE"


def test_max_attendance_days_uses_current_rosters():
    student = {"id": "dancer", "name": "Dancer", "level": "Level 1"}
    classes = [_class(str(index), f"Class {index}", roster=["dancer"]) for index in range(4)]
    days = ["Monday", "Tuesday", "Wednesday", "Thursday"]
    constraints = [_constraint("attendance", "MAX_ATTENDANCE_DAYS", selector={"levels": ["Level 1"]}, parameters={"maxDays": 3})]
    constraints.extend(_fixed(f"fixed-{index}", f"Class {index}", day, "16:45", "Teacher A", "Studio A", "17:45") for index, day in enumerate(days))
    result = solve_feasibility(_problem(classes=classes, constraints=constraints, students=[student]))
    assert result["status"] == "INFEASIBLE"


def test_room_capacity_blocks_oversize_non_exempt_class():
    students = [{"id": f"s-{index}", "name": f"Dancer {index}", "level": "Level 3"} for index in range(16)]
    classes = [_class("big", "Big Class", level="Level 3", roster=[item["id"] for item in students])]
    constraints = [
        _constraint("capacity", "ROOM_CAPACITY", selector={"roomNames": ["Studio C"]}, parameters={"maxDancers": 15, "exemptLevels": ["Elementary 1", "Elementary 2"]}),
        _fixed("big-fixed", "Big Class", "Monday", "16:45", "Teacher A", "Studio C", "17:45"),
    ]
    result = solve_feasibility(_problem(classes=classes, constraints=constraints, rooms=[{"id": "c", "name": "Studio C"}], students=students))
    assert result["status"] == "INFEASIBLE"


def test_room_capacity_preserves_elementary_exception():
    students = [{"id": f"s-{index}", "name": f"Dancer {index}", "level": "Elementary 1"} for index in range(16)]
    classes = [_class("big", "Elementary Big Class", level="Elementary 1", roster=[item["id"] for item in students])]
    constraints = [
        _constraint("capacity", "ROOM_CAPACITY", selector={"roomNames": ["Studio C"]}, parameters={"maxDancers": 15, "exemptLevels": ["Elementary 1", "Elementary 2"]}),
        _fixed("big-fixed", "Elementary Big Class", "Monday", "16:45", "Teacher A", "Studio C", "17:45"),
    ]
    result = solve_feasibility(_problem(classes=classes, constraints=constraints, rooms=[{"id": "c", "name": "Studio C"}], students=students))
    assert result["status"] == "FEASIBLE"


def test_teacher_domain_enforces_allowed_levels_and_exception_classes():
    teachers = [{"id": "karly", "name": "Karly"}]
    classes = [_class("advanced", "Advanced Ballet", level="Level 6")]
    constraints = [
        _constraint("domain", "TEACHER_SUBJECT_DOMAIN", selector={"teacherNames": ["Karly"]}, parameters={"allowedSubjects": ["Ballet"], "allowedLevels": ["Level 1", "Level 2", "Level 3", "Level 4A", "Level 4B", "Level 5"]}),
        _fixed("advanced-fixed", "Advanced Ballet", "Monday", "16:45", "Karly", "Studio A", "17:45"),
    ]
    result = solve_feasibility(_problem(classes=classes, constraints=constraints, teachers=teachers))
    assert result["status"] == "INFEASIBLE"


def test_cur_007_default_denies_teacher_without_compiled_domain():
    teachers = [{"id": "covered", "name": "Covered"}, {"id": "new", "name": "New Teacher"}]
    classes = [_class("a", "Ballet A")]
    constraints = [
        _constraint("covered-domain", "TEACHER_SUBJECT_DOMAIN", selector={"teacherNames": ["Covered"]}, parameters={"allowedSubjects": ["Ballet"]}),
        _constraint("new-required", "REQUIRED_TEACHER", selector={"classNames": ["Ballet A"]}, parameters={"teacherName": "New Teacher"}),
    ]
    governance = [{"ruleId": "CUR-007", "family": "CURRICULUM_INTEGRITY", "assertion": "Do not invent teacher qualifications."}]
    result = solve_feasibility(_problem(classes=classes, constraints=constraints, teachers=teachers, governance=governance))
    assert result["status"] == "INFEASIBLE"


def test_relationship_start_window_requires_daughter_class_and_start_alignment():
    teachers = [{"id": "karly", "name": "Karly"}, {"id": "other", "name": "Other Teacher"}]
    rooms = [{"id": "a", "name": "Studio A"}, {"id": "b", "name": "Studio B"}]
    classes = [_class("teach", "Karly Teaching"), _class("daughter", "Jazz 2", subject="Jazz", level="Level 2")]
    constraints = [
        _constraint("relationship", "RELATIONSHIP_START_WINDOW", selector={"teacherNames": ["Karly"]}, parameters={"daughterClassNames": ["Jazz 2"], "maxStartDifferenceMinutes": 30}),
        _fixed("teach-fixed", "Karly Teaching", "Monday", "16:45", "Karly", "Studio A", "17:45"),
        _fixed("daughter-fixed", "Jazz 2", "Monday", "18:00", "Other Teacher", "Studio B", "19:00"),
    ]
    result = solve_feasibility(_problem(classes=classes, constraints=constraints, teachers=teachers, rooms=rooms))
    assert result["status"] == "INFEASIBLE"
