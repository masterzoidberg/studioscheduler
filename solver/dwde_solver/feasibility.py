from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from ortools.sat.python import cp_model

DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]
DAY_INDEX = {day: index for index, day in enumerate(DAYS)}
SLOT_MINUTES = 15
SLOTS_PER_DAY = 24 * 60 // SLOT_MINUTES

SUPPORTED_KINDS = {
    "RESOURCE_NO_OVERLAP",
    "TIME_GRID",
    "DAY_TIME_WINDOW",
    "NO_DAY",
    "REQUIRED_ROOM",
    "REQUIRED_TEACHER",
    "TEACHER_SUBJECT_DOMAIN",
    "TEACHER_DAY_WINDOW",
    "DIRECTLY_AFTER",
    "FIXED_ASSIGNMENT",
}


def _slot(value: str) -> int:
    hour, minute = (int(part) for part in value.split(":"))
    if minute % SLOT_MINUTES:
        raise ValueError(f"{value} is not on the {SLOT_MINUTES}-minute grid")
    return (hour * 60 + minute) // SLOT_MINUTES


def _selector_matches(constraint: dict[str, Any], klass: dict[str, Any]) -> bool:
    selector = constraint.get("selector") or {}
    names = selector.get("classNames") or []
    subjects = selector.get("subjects") or []
    levels = selector.get("levels") or []
    if names and klass["name"] not in names:
        return False
    if subjects and klass["subject"] not in subjects:
        return False
    if levels and klass["level"] not in levels:
        return False
    return True


@dataclass
class SessionVars:
    session: dict[str, Any]
    klass: dict[str, Any]
    day: cp_model.IntVar
    start: cp_model.IntVar
    absolute_start: cp_model.IntVar
    absolute_end: cp_model.IntVar
    interval: cp_model.IntervalVar
    teacher: dict[str, cp_model.BoolVar]
    room: dict[str, cp_model.BoolVar]


@dataclass
class BuiltModel:
    model: cp_model.CpModel
    sessions: dict[str, SessionVars]
    assumptions: dict[int, str]


def _build_model(problem: dict[str, Any], diagnostic: bool) -> BuiltModel:
    model = cp_model.CpModel()
    classes = {item["id"]: item for item in problem["classes"]}
    teachers = {item["id"]: item for item in problem["teachers"]}
    rooms = {item["id"]: item for item in problem["rooms"]}
    students = {item["id"]: item for item in problem.get("students", [])}
    constraints = problem["constraintModel"]["hardConstraints"]

    unsupported = [item["id"] for item in constraints if item["kind"] not in SUPPORTED_KINDS]
    if unsupported:
        raise ValueError(f"Unsupported Constraint IR nodes: {', '.join(sorted(unsupported))}")

    teacher_name_to_id = {item["name"]: item["id"] for item in teachers.values()}
    room_name_to_id = {item["name"]: item["id"] for item in rooms.values()}
    class_name_to_ids: dict[str, list[str]] = {}
    for item in classes.values():
        class_name_to_ids.setdefault(item["name"], []).append(item["id"])

    session_vars: dict[str, SessionVars] = {}
    teacher_intervals: dict[str, list[cp_model.IntervalVar]] = {item: [] for item in teachers}
    room_intervals: dict[str, list[cp_model.IntervalVar]] = {item: [] for item in rooms}
    student_intervals: dict[str, list[cp_model.IntervalVar]] = {item: [] for item in students}

    for session in problem["sessions"]:
        klass = classes[session["classId"]]
        duration_minutes = session.get("durationMinutes") or klass["durationMinutes"]
        if duration_minutes % SLOT_MINUTES:
            raise ValueError(f"Session {session['id']} duration is not on the 15-minute grid")
        duration = duration_minutes // SLOT_MINUTES

        day = model.new_int_var(0, len(DAYS) - 1, f"day__{session['id']}")
        start = model.new_int_var(0, SLOTS_PER_DAY - duration, f"start__{session['id']}")
        absolute_start = model.new_int_var(0, len(DAYS) * SLOTS_PER_DAY, f"abs_start__{session['id']}")
        absolute_end = model.new_int_var(0, len(DAYS) * SLOTS_PER_DAY + duration, f"abs_end__{session['id']}")
        model.add(absolute_start == day * SLOTS_PER_DAY + start)
        model.add(absolute_end == absolute_start + duration)
        interval = model.new_interval_var(absolute_start, duration, absolute_end, f"interval__{session['id']}")

        teacher_bools = {teacher_id: model.new_bool_var(f"teacher__{session['id']}__{teacher_id}") for teacher_id in teachers}
        room_bools = {room_id: model.new_bool_var(f"room__{session['id']}__{room_id}") for room_id in rooms}
        model.add_exactly_one(teacher_bools.values())
        model.add_exactly_one(room_bools.values())

        for teacher_id, present in teacher_bools.items():
            teacher_intervals[teacher_id].append(
                model.new_optional_interval_var(absolute_start, duration, absolute_end, present, f"ti__{session['id']}__{teacher_id}")
            )
        for room_id, present in room_bools.items():
            room_intervals[room_id].append(
                model.new_optional_interval_var(absolute_start, duration, absolute_end, present, f"ri__{session['id']}__{room_id}")
            )
        for student_id in klass.get("rosterStudentIds", []):
            if student_id in student_intervals:
                student_intervals[student_id].append(interval)

        session_vars[session["id"]] = SessionVars(
            session=session,
            klass=klass,
            day=day,
            start=start,
            absolute_start=absolute_start,
            absolute_end=absolute_end,
            interval=interval,
            teacher=teacher_bools,
            room=room_bools,
        )

    assumptions: dict[int, str] = {}
    fixed_literals: dict[str, cp_model.BoolVar] = {}

    for constraint in constraints:
        kind = constraint["kind"]
        params = constraint.get("parameters") or {}
        selector = constraint.get("selector") or {}
        matching = [item for item in session_vars.values() if _selector_matches(constraint, item.klass)]

        if kind == "TIME_GRID":
            if int(params.get("minutes", SLOT_MINUTES)) != SLOT_MINUTES:
                raise ValueError(f"Constraint {constraint['id']} requests a grid unsupported by this spike")

        elif kind == "RESOURCE_NO_OVERLAP":
            resource = params.get("resource")
            if resource == "TEACHER":
                for intervals in teacher_intervals.values():
                    model.add_no_overlap(intervals)
            elif resource == "ROOM":
                for intervals in room_intervals.values():
                    model.add_no_overlap(intervals)
            elif resource == "STUDENT_ROSTER":
                for intervals in student_intervals.values():
                    model.add_no_overlap(intervals)
            else:
                raise ValueError(f"Constraint {constraint['id']} has unsupported resource {resource}")

        elif kind == "DAY_TIME_WINDOW":
            days = [DAY_INDEX[item] for item in params.get("days", DAYS)]
            earliest = params.get("earliestStart")
            latest = params.get("latestFinish")
            normal_earliest = params.get("normalEarliestStart")
            exception_earliest = params.get("exceptionEarliestStart")
            exception_levels = set(params.get("exceptionLevels", []))
            for item in matching:
                model.add_allowed_assignments([item.day], [[day] for day in days])
                start_min = exception_earliest if item.klass["level"] in exception_levels and exception_earliest else normal_earliest or earliest
                if start_min:
                    model.add(item.start >= _slot(start_min))
                if latest:
                    duration = (item.session.get("durationMinutes") or item.klass["durationMinutes"]) // SLOT_MINUTES
                    model.add(item.start + duration <= _slot(latest))

        elif kind == "NO_DAY":
            excluded = [DAY_INDEX[item] for item in params.get("days", []) if item in DAY_INDEX]
            for item in matching:
                for day in excluded:
                    model.add(item.day != day)

        elif kind == "REQUIRED_ROOM":
            room_name = params.get("roomName") or ((selector.get("roomNames") or [None])[0])
            room_id = room_name_to_id.get(room_name)
            if not room_id:
                raise ValueError(f"Constraint {constraint['id']} cannot resolve room {room_name}")
            for item in matching:
                model.add(item.room[room_id] == 1)

        elif kind == "REQUIRED_TEACHER":
            teacher_name = params.get("teacherName") or ((selector.get("teacherNames") or [None])[0])
            teacher_id = teacher_name_to_id.get(teacher_name)
            if not teacher_id:
                raise ValueError(f"Constraint {constraint['id']} cannot resolve teacher {teacher_name}")
            for item in matching:
                model.add(item.teacher[teacher_id] == 1)

        elif kind == "TEACHER_SUBJECT_DOMAIN":
            teacher_names = selector.get("teacherNames") or []
            allowed = set(params.get("allowedSubjects", []))
            prohibited = set(params.get("prohibitedSubjects", []))
            prohibited_levels = set(params.get("prohibitedLevels", []))
            for teacher_name in teacher_names:
                teacher_id = teacher_name_to_id.get(teacher_name)
                if not teacher_id:
                    raise ValueError(f"Constraint {constraint['id']} cannot resolve teacher {teacher_name}")
                for item in session_vars.values():
                    invalid = (allowed and item.klass["subject"] not in allowed) or item.klass["subject"] in prohibited or item.klass["level"] in prohibited_levels
                    if invalid:
                        model.add(item.teacher[teacher_id] == 0)

        elif kind == "TEACHER_DAY_WINDOW":
            teacher_names = selector.get("teacherNames") or []
            allowed_days = params.get("allowedDays")
            one_day = params.get("day")
            start_limit = params.get("start")
            end_limit = params.get("end")
            if one_day:
                allowed_days = [one_day]
            for teacher_name in teacher_names:
                teacher_id = teacher_name_to_id.get(teacher_name)
                if not teacher_id:
                    raise ValueError(f"Constraint {constraint['id']} cannot resolve teacher {teacher_name}")
                for item in session_vars.values():
                    present = item.teacher[teacher_id]
                    if allowed_days:
                        allowed_indexes = [DAY_INDEX[day] for day in allowed_days]
                        day_flags = []
                        for day_index in allowed_indexes:
                            flag = model.new_bool_var(f"teacher_day__{constraint['id']}__{item.session['id']}__{day_index}")
                            model.add(item.day == day_index).only_enforce_if(flag)
                            model.add(item.day != day_index).only_enforce_if(flag.Not())
                            day_flags.append(flag)
                        model.add_bool_or(day_flags).only_enforce_if(present)
                    if start_limit:
                        model.add(item.start >= _slot(start_limit)).only_enforce_if(present)
                    if end_limit:
                        duration = (item.session.get("durationMinutes") or item.klass["durationMinutes"]) // SLOT_MINUTES
                        model.add(item.start + duration <= _slot(end_limit)).only_enforce_if(present)

        elif kind == "DIRECTLY_AFTER":
            predecessor = params.get("predecessor")
            successor = params.get("successor")
            gap = int(params.get("gapMinutes", 0)) // SLOT_MINUTES
            predecessor_ids = class_name_to_ids.get(predecessor, [])
            successor_ids = class_name_to_ids.get(successor, [])
            pred_sessions = [item for item in session_vars.values() if item.klass["id"] in predecessor_ids]
            succ_sessions = [item for item in session_vars.values() if item.klass["id"] in successor_ids]
            if not pred_sessions or not succ_sessions:
                raise ValueError(f"Constraint {constraint['id']} cannot resolve sequence {predecessor} -> {successor}")
            # The Rulebook compiler marks multi-meeting Pointe adjacency as one designated meeting.
            # The feasibility spike deterministically uses the first ordinal until designated-session
            # identity becomes an explicit planning fact.
            pred = sorted(pred_sessions, key=lambda item: item.session.get("ordinal", 1))[0]
            succ = sorted(succ_sessions, key=lambda item: item.session.get("ordinal", 1))[0]
            model.add(succ.absolute_start == pred.absolute_end + gap)

        elif kind == "FIXED_ASSIGNMENT":
            literal = model.new_bool_var(f"assume__{constraint['id']}")
            fixed_literals[constraint["id"]] = literal
            if diagnostic:
                model.add_assumption(literal)
                assumptions[literal.index] = constraint["id"]
            else:
                model.add(literal == 1)
            for item in matching:
                if params.get("day"):
                    model.add(item.day == DAY_INDEX[params["day"]]).only_enforce_if(literal)
                if params.get("start"):
                    model.add(item.start == _slot(params["start"])).only_enforce_if(literal)
                teacher_name = ((selector.get("teacherNames") or [None])[0])
                room_name = ((selector.get("roomNames") or [None])[0])
                if teacher_name:
                    teacher_id = teacher_name_to_id.get(teacher_name)
                    if not teacher_id:
                        raise ValueError(f"Constraint {constraint['id']} cannot resolve teacher {teacher_name}")
                    model.add(item.teacher[teacher_id] == 1).only_enforce_if(literal)
                if room_name:
                    room_id = room_name_to_id.get(room_name)
                    if not room_id:
                        raise ValueError(f"Constraint {constraint['id']} cannot resolve room {room_name}")
                    model.add(item.room[room_id] == 1).only_enforce_if(literal)

    return BuiltModel(model=model, sessions=session_vars, assumptions=assumptions)


def _solver(max_seconds: float, diagnostic: bool) -> cp_model.CpSolver:
    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = max_seconds
    solver.parameters.num_search_workers = 1
    solver.parameters.random_seed = 1337
    # OR-Tools 9.15 has an open issue where presolve can return an assumption literal
    # outside the supplied assumption list (#5141). Keep presolve for normal solving,
    # but disable it in the diagnostic core pass until that upstream bug is resolved.
    if diagnostic:
        solver.parameters.cp_model_presolve = False
    return solver


def _extract_assignments(built: BuiltModel, solver: cp_model.CpSolver) -> list[dict[str, Any]]:
    assignments = []
    for item in built.sessions.values():
        teacher_id = next(key for key, value in item.teacher.items() if solver.boolean_value(value))
        room_id = next(key for key, value in item.room.items() if solver.boolean_value(value))
        start_slot = solver.value(item.start)
        duration_minutes = item.session.get("durationMinutes") or item.klass["durationMinutes"]
        end_slot = start_slot + duration_minutes // SLOT_MINUTES
        assignments.append(
            {
                "sessionId": item.session["id"],
                "day": DAYS[solver.value(item.day)],
                "startTime": f"{start_slot * SLOT_MINUTES // 60:02d}:{start_slot * SLOT_MINUTES % 60:02d}",
                "endTime": f"{end_slot * SLOT_MINUTES // 60:02d}:{end_slot * SLOT_MINUTES % 60:02d}",
                "teacherId": teacher_id,
                "roomId": room_id,
            }
        )
    return sorted(assignments, key=lambda item: item["sessionId"])


def solve_feasibility(problem: dict[str, Any], max_seconds: float = 5.0) -> dict[str, Any]:
    constraints = problem["constraintModel"]["hardConstraints"]
    unsupported = sorted(item["id"] for item in constraints if item["kind"] not in SUPPORTED_KINDS)
    if unsupported:
        return {
            "status": "UNSUPPORTED",
            "unsupportedConstraintIds": unsupported,
            "assignments": [],
            "blockingConstraintIds": [],
        }

    built = _build_model(problem, diagnostic=False)
    solver = _solver(max_seconds=max_seconds, diagnostic=False)
    status = solver.solve(built.model)

    if status in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        return {
            "status": "FEASIBLE",
            "unsupportedConstraintIds": [],
            "assignments": _extract_assignments(built, solver),
            "blockingConstraintIds": [],
            "wallTimeSeconds": solver.wall_time,
            "branches": solver.num_branches,
            "conflicts": solver.num_conflicts,
        }

    if status == cp_model.INFEASIBLE:
        diagnostic = _build_model(problem, diagnostic=True)
        diagnostic_solver = _solver(max_seconds=max_seconds, diagnostic=True)
        diagnostic_status = diagnostic_solver.solve(diagnostic.model)
        blockers: list[str] = []
        if diagnostic_status == cp_model.INFEASIBLE:
            for literal_index in diagnostic_solver.sufficient_assumptions_for_infeasibility():
                constraint_id = diagnostic.assumptions.get(literal_index)
                if constraint_id:
                    blockers.append(constraint_id)
        return {
            "status": "INFEASIBLE",
            "unsupportedConstraintIds": [],
            "assignments": [],
            "blockingConstraintIds": sorted(set(blockers)),
            "wallTimeSeconds": solver.wall_time,
        }

    return {
        "status": "UNKNOWN",
        "unsupportedConstraintIds": [],
        "assignments": [],
        "blockingConstraintIds": [],
        "wallTimeSeconds": solver.wall_time,
    }
