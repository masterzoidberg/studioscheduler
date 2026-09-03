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
    "MAX_GAP",
    "MAX_WORKDAYS",
    "LATEST_FINISH_BY_LEVEL",
    "MAX_ATTENDANCE_DAYS",
    "REQUIRED_ROOM",
    "REQUIRED_TEACHER",
    "TEACHER_SUBJECT_DOMAIN",
    "TEACHER_DAY_WINDOW",
    "DIRECTLY_AFTER",
    "FIXED_ASSIGNMENT",
    "ROOM_CAPACITY",
    "RELATIONSHIP_START_WINDOW",
}
DELEGATED_KINDS = {"REQUIRED_LOWER_LEVEL"}


def _slot(value: str) -> int:
    hour, minute = (int(part) for part in value.split(":"))
    if minute % SLOT_MINUTES:
        raise ValueError(f"{value} is not on the {SLOT_MINUTES}-minute grid")
    return (hour * 60 + minute) // SLOT_MINUTES


def _normalize(value: str) -> str:
    return "".join(character for character in value.lower() if character.isalnum())


def _level_tokens(value: str) -> list[str]:
    normalized = value.lower().replace("levels", "").replace("level", "").replace("elementary", "elem")
    normalized = "".join(character for character in normalized if character.isalnum() or character == "/")
    return [token for token in normalized.split("/") if token]


def _level_matches(value: str, selectors: list[str] | None) -> bool:
    if not selectors:
        return True
    actual = set(_level_tokens(value))
    return any(any(token in actual for token in _level_tokens(selector)) for selector in selectors)


def _text_matches(value: str, selectors: list[str] | None) -> bool:
    if not selectors:
        return True
    actual = _normalize(value)
    return any(_normalize(selector) == actual for selector in selectors)


def _subject_matches(klass: dict[str, Any], selectors: list[str]) -> bool:
    if not selectors:
        return False
    subject = _normalize(str(klass.get("subject", "")))
    name = _normalize(str(klass.get("name", "")))
    elementary = any(token.startswith("elem") for token in _level_tokens(str(klass.get("level", ""))))
    for selector in selectors:
        target = _normalize(selector)
        if target in {subject, name}:
            return True
        if elementary and target == _normalize(f"Elementary {klass.get('subject', '')}"):
            return True
    return False


def _selector_matches(constraint: dict[str, Any], klass: dict[str, Any]) -> bool:
    selector = constraint.get("selector") or {}
    names = selector.get("classNames") or []
    subjects = selector.get("subjects") or []
    levels = selector.get("levels") or []
    if names and not _text_matches(str(klass["name"]), names):
        return False
    if subjects and not _text_matches(str(klass["subject"]), subjects):
        return False
    if levels and not _level_matches(str(klass["level"]), levels):
        return False
    return True


def _resolve_unique_by_name(items: dict[str, dict[str, Any]], name: str, kind: str, constraint_id: str) -> str:
    matches = [item["id"] for item in items.values() if _normalize(str(item.get("name", ""))) == _normalize(name)]
    if len(matches) != 1:
        raise ValueError(f"Constraint {constraint_id} cannot uniquely resolve {kind} {name!r}; found {len(matches)}")
    return matches[0]


def _and_literal(model: cp_model.CpModel, literals: list[Any], name: str):
    result = model.new_bool_var(name)
    if not literals:
        model.add(result == 1)
        return result
    for literal in literals:
        model.add_implication(result, literal)
    model.add_bool_or([result, *[literal.Not() for literal in literals]])
    return result


def _or_literal(model: cp_model.CpModel, literals: list[Any], name: str):
    result = model.new_bool_var(name)
    if not literals:
        model.add(result == 0)
        return result
    for literal in literals:
        model.add_implication(literal, result)
    model.add_bool_or([result.Not(), *literals])
    return result


@dataclass
class SessionVars:
    session: dict[str, Any]
    klass: dict[str, Any]
    duration_slots: int
    day: cp_model.IntVar
    day_flags: dict[int, cp_model.BoolVar]
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


def _sequence_circuit(
    model: cp_model.CpModel,
    candidates: list[tuple[SessionVars, Any]],
    prefix: str,
    max_gap_slots: int | None = None,
):
    works = _or_literal(model, [present for _, present in candidates], f"{prefix}__works")
    if not candidates:
        return works, []

    arcs: list[tuple[int, int, Any]] = [(0, 0, works.Not())]
    first_flags: list[tuple[SessionVars, cp_model.BoolVar]] = []
    indexed = list(enumerate(candidates, start=1))

    for index, (item, present) in indexed:
        arcs.append((index, index, present.Not()))
        first = model.new_bool_var(f"{prefix}__first__{item.session['id']}")
        last = model.new_bool_var(f"{prefix}__last__{item.session['id']}")
        model.add_implication(first, present)
        model.add_implication(last, present)
        arcs.append((0, index, first))
        arcs.append((index, 0, last))
        first_flags.append((item, first))

    for left_index, (left, left_present) in indexed:
        for right_index, (right, right_present) in indexed:
            if left_index == right_index:
                continue
            arc = model.new_bool_var(f"{prefix}__arc__{left.session['id']}__{right.session['id']}")
            model.add_implication(arc, left_present)
            model.add_implication(arc, right_present)
            model.add(right.start >= left.start + left.duration_slots).only_enforce_if(arc)
            if max_gap_slots is not None:
                model.add(right.start - (left.start + left.duration_slots) <= max_gap_slots).only_enforce_if(arc)
            arcs.append((left_index, right_index, arc))

    model.add_circuit(arcs)
    return works, first_flags


def _build_model(problem: dict[str, Any], diagnostic: bool) -> BuiltModel:
    model = cp_model.CpModel()
    classes = {item["id"]: item for item in problem["classes"]}
    teachers = {item["id"]: item for item in problem["teachers"]}
    rooms = {item["id"]: item for item in problem["rooms"]}
    students = {item["id"]: item for item in problem.get("students", [])}
    constraints = problem["constraintModel"]["hardConstraints"]

    unsupported = [item["id"] for item in constraints if item["kind"] not in SUPPORTED_KINDS | DELEGATED_KINDS]
    if unsupported:
        raise ValueError(f"Unsupported Constraint IR nodes: {', '.join(sorted(unsupported))}")

    class_name_to_ids: dict[str, list[str]] = {}
    for item in classes.values():
        class_name_to_ids.setdefault(_normalize(str(item["name"])), []).append(item["id"])

    session_vars: dict[str, SessionVars] = {}
    teacher_intervals: dict[str, list[cp_model.IntervalVar]] = {item: [] for item in teachers}
    room_intervals: dict[str, list[cp_model.IntervalVar]] = {item: [] for item in rooms}
    student_intervals: dict[str, list[cp_model.IntervalVar]] = {item: [] for item in students}

    for session in problem["sessions"]:
        if session["classId"] not in classes:
            raise ValueError(f"Session {session['id']} references missing class {session['classId']}")
        klass = classes[session["classId"]]
        duration_minutes = session.get("durationMinutes") or klass["durationMinutes"]
        if duration_minutes <= 0 or duration_minutes % SLOT_MINUTES:
            raise ValueError(f"Session {session['id']} duration is not a positive {SLOT_MINUTES}-minute multiple")
        duration = duration_minutes // SLOT_MINUTES

        day = model.new_int_var(0, len(DAYS) - 1, f"day__{session['id']}")
        day_flags = {day_index: model.new_bool_var(f"day_flag__{session['id']}__{day_index}") for day_index in range(len(DAYS))}
        model.add_exactly_one(day_flags.values())
        for day_index, flag in day_flags.items():
            model.add(day == day_index).only_enforce_if(flag)

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
            duration_slots=duration,
            day=day,
            day_flags=day_flags,
            start=start,
            absolute_start=absolute_start,
            absolute_end=absolute_end,
            interval=interval,
            teacher=teacher_bools,
            room=room_bools,
        )

    teacher_day_presence_cache: dict[tuple[str, str, int], cp_model.BoolVar] = {}

    def teacher_day_presence(item: SessionVars, teacher_id: str, day_index: int):
        key = (item.session["id"], teacher_id, day_index)
        if key not in teacher_day_presence_cache:
            teacher_day_presence_cache[key] = _and_literal(
                model,
                [item.teacher[teacher_id], item.day_flags[day_index]],
                f"teacher_day__{item.session['id']}__{teacher_id}__{day_index}",
            )
        return teacher_day_presence_cache[key]

    assumptions: dict[int, str] = {}

    overrides_by_base: dict[str, list[dict[str, Any]]] = {}
    for candidate in constraints:
        override_id = (candidate.get("parameters") or {}).get("overrides")
        if isinstance(override_id, str):
            overrides_by_base.setdefault(override_id, []).append(candidate)

    governance = problem["constraintModel"].get("governanceAssertions") or []
    default_deny = any(item.get("ruleId") == "CUR-007" for item in governance)
    if default_deny:
        covered_teacher_names = {
            _normalize(name)
            for node in constraints
            if node["kind"] == "TEACHER_SUBJECT_DOMAIN"
            for name in (node.get("selector") or {}).get("teacherNames", [])
        }
        for teacher_id, teacher in teachers.items():
            if _normalize(str(teacher.get("name", ""))) in covered_teacher_names:
                continue
            for item in session_vars.values():
                model.add(item.teacher[teacher_id] == 0)

    for constraint in constraints:
        kind = constraint["kind"]
        if kind in DELEGATED_KINDS:
            continue

        params = constraint.get("parameters") or {}
        selector = constraint.get("selector") or {}
        matching = [item for item in session_vars.values() if _selector_matches(constraint, item.klass)]

        if kind == "TIME_GRID":
            if int(params.get("minutes", SLOT_MINUTES)) != SLOT_MINUTES:
                raise ValueError(f"Constraint {constraint['id']} requests a grid unsupported by this solver")

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
            scoped_days = [DAY_INDEX[day] for day in params.get("days", DAYS) if day in DAY_INDEX]
            earliest = params.get("earliestStart")
            latest = params.get("latestFinish")
            normal_earliest = params.get("normalEarliestStart")
            exception_earliest = params.get("exceptionEarliestStart")
            exception_levels = list(params.get("exceptionLevels", []))
            for item in matching:
                start_min = exception_earliest if exception_earliest and _level_matches(str(item.klass["level"]), exception_levels) else normal_earliest or earliest
                for day_index in scoped_days:
                    overridden = False
                    for override in overrides_by_base.get(constraint["id"], []):
                        override_params = override.get("parameters") or {}
                        override_days = [DAY_INDEX[day] for day in override_params.get("days", DAYS) if day in DAY_INDEX]
                        if day_index in override_days and _selector_matches(override, item.klass):
                            overridden = True
                            break
                    if overridden:
                        continue
                    day_flag = item.day_flags[day_index]
                    if start_min:
                        model.add(item.start >= _slot(str(start_min))).only_enforce_if(day_flag)
                    if latest:
                        model.add(item.start + item.duration_slots <= _slot(str(latest))).only_enforce_if(day_flag)

        elif kind == "NO_DAY":
            for day_name in params.get("days", []):
                if day_name not in DAY_INDEX:
                    continue
                for item in matching:
                    model.add(item.day_flags[DAY_INDEX[day_name]] == 0)

        elif kind == "MAX_GAP":
            maximum = int(params.get("minutes", 60))
            if maximum % SLOT_MINUTES:
                raise ValueError(f"Constraint {constraint['id']} max gap is not on the {SLOT_MINUTES}-minute grid")
            max_gap_slots = maximum // SLOT_MINUTES
            resource = params.get("resource")
            if resource == "TEACHER":
                teacher_names = selector.get("teacherNames") or []
                for teacher_id, teacher in teachers.items():
                    if not _text_matches(str(teacher.get("name", "")), teacher_names):
                        continue
                    for day_index, day_name in enumerate(DAYS):
                        candidates = [(item, teacher_day_presence(item, teacher_id, day_index)) for item in session_vars.values()]
                        _sequence_circuit(model, candidates, f"gap_teacher__{constraint['id']}__{teacher_id}__{day_name}", max_gap_slots)
            elif resource == "STUDENT_ROSTER":
                for student_id in students:
                    for day_index, day_name in enumerate(DAYS):
                        candidates = [
                            (item, item.day_flags[day_index])
                            for item in session_vars.values()
                            if student_id in item.klass.get("rosterStudentIds", [])
                        ]
                        _sequence_circuit(model, candidates, f"gap_student__{constraint['id']}__{student_id}__{day_name}", max_gap_slots)
            else:
                raise ValueError(f"Constraint {constraint['id']} has unsupported max-gap resource {resource}")

        elif kind == "MAX_WORKDAYS":
            maximum = int(params.get("maxDays", 0))
            teacher_names = selector.get("teacherNames") or []
            for teacher_id, teacher in teachers.items():
                if not _text_matches(str(teacher.get("name", "")), teacher_names):
                    continue
                day_used = []
                for day_index, day_name in enumerate(DAYS):
                    present = [teacher_day_presence(item, teacher_id, day_index) for item in session_vars.values()]
                    day_used.append(_or_literal(model, present, f"workday__{constraint['id']}__{teacher_id}__{day_name}"))
                model.add(sum(day_used) <= maximum)

        elif kind == "LATEST_FINISH_BY_LEVEL":
            latest = _slot(str(params.get("latestFinish", "23:45")))
            for item in matching:
                model.add(item.start + item.duration_slots <= latest)

        elif kind == "MAX_ATTENDANCE_DAYS":
            maximum = int(params.get("maxDays", 0))
            selected_levels = selector.get("levels") or []
            for student_id, student in students.items():
                if not _level_matches(str(student.get("level", "")), selected_levels):
                    continue
                day_used = []
                for day_index, day_name in enumerate(DAYS):
                    present = [
                        item.day_flags[day_index]
                        for item in session_vars.values()
                        if student_id in item.klass.get("rosterStudentIds", [])
                    ]
                    day_used.append(_or_literal(model, present, f"attendance_day__{constraint['id']}__{student_id}__{day_name}"))
                model.add(sum(day_used) <= maximum)

        elif kind == "REQUIRED_ROOM":
            room_name = params.get("roomName") or ((selector.get("roomNames") or [None])[0])
            if not room_name:
                raise ValueError(f"Constraint {constraint['id']} does not identify a required room")
            room_id = _resolve_unique_by_name(rooms, str(room_name), "room", constraint["id"])
            for item in matching:
                model.add(item.room[room_id] == 1)

        elif kind == "REQUIRED_TEACHER":
            teacher_name = params.get("teacherName") or ((selector.get("teacherNames") or [None])[0])
            if not teacher_name:
                raise ValueError(f"Constraint {constraint['id']} does not identify a required teacher")
            teacher_id = _resolve_unique_by_name(teachers, str(teacher_name), "teacher", constraint["id"])
            for item in matching:
                model.add(item.teacher[teacher_id] == 1)

        elif kind == "TEACHER_SUBJECT_DOMAIN":
            teacher_names = selector.get("teacherNames") or []
            allowed_subjects = list(params.get("allowedSubjects", []))
            prohibited_subjects = list(params.get("prohibitedSubjects", []))
            allowed_levels = list(params.get("allowedLevels", []))
            prohibited_levels = list(params.get("prohibitedLevels", []))
            exception_classes = list(params.get("exceptionClasses", []))
            for teacher_name in teacher_names:
                teacher_id = _resolve_unique_by_name(teachers, str(teacher_name), "teacher", constraint["id"])
                for item in session_vars.values():
                    explicit_exception = bool(exception_classes) and _text_matches(str(item.klass["name"]), exception_classes)
                    prohibited_subject = bool(prohibited_subjects) and _subject_matches(item.klass, prohibited_subjects)
                    prohibited_level = bool(prohibited_levels) and _level_matches(str(item.klass["level"]), prohibited_levels)
                    subject_allowed = explicit_exception or not allowed_subjects or _subject_matches(item.klass, allowed_subjects)
                    level_allowed = explicit_exception or not allowed_levels or _level_matches(str(item.klass["level"]), allowed_levels)
                    if prohibited_subject or prohibited_level or not subject_allowed or not level_allowed:
                        model.add(item.teacher[teacher_id] == 0)

        elif kind == "TEACHER_DAY_WINDOW":
            if params.get("inheritStudioOperatingWindows") is True and params.get("mayExtendOperatingHours") is False:
                continue
            teacher_names = selector.get("teacherNames") or []
            allowed_days = params.get("allowedDays")
            one_day = params.get("day")
            start_limit = params.get("start")
            end_limit = params.get("end")
            if one_day:
                allowed_days = [one_day]
            for teacher_name in teacher_names:
                teacher_id = _resolve_unique_by_name(teachers, str(teacher_name), "teacher", constraint["id"])
                for item in session_vars.values():
                    present = item.teacher[teacher_id]
                    if allowed_days:
                        allowed_indexes = {DAY_INDEX[day] for day in allowed_days if day in DAY_INDEX}
                        for day_index in range(len(DAYS)):
                            if day_index not in allowed_indexes:
                                model.add_bool_or([present.Not(), item.day_flags[day_index].Not()])
                    if start_limit:
                        model.add(item.start >= _slot(str(start_limit))).only_enforce_if(present)
                    if end_limit:
                        model.add(item.start + item.duration_slots <= _slot(str(end_limit))).only_enforce_if(present)

        elif kind == "DIRECTLY_AFTER":
            predecessor = str(params.get("predecessor") or ((selector.get("classNames") or [None, None])[0]) or "")
            successor = str(params.get("successor") or ((selector.get("classNames") or [None, None])[-1]) or "")
            gap_minutes = int(params.get("gapMinutes", 0))
            if gap_minutes % SLOT_MINUTES:
                raise ValueError(f"Constraint {constraint['id']} gap is not on the {SLOT_MINUTES}-minute grid")
            gap = gap_minutes // SLOT_MINUTES
            predecessor_ids = class_name_to_ids.get(_normalize(predecessor), [])
            successor_ids = class_name_to_ids.get(_normalize(successor), [])
            if len(predecessor_ids) != 1 or len(successor_ids) != 1:
                raise ValueError(f"Constraint {constraint['id']} cannot uniquely resolve sequence {predecessor} -> {successor}")
            pred_sessions = [item for item in session_vars.values() if item.klass["id"] == predecessor_ids[0]]
            succ_sessions = [item for item in session_vars.values() if item.klass["id"] == successor_ids[0]]
            if not pred_sessions or not succ_sessions:
                raise ValueError(f"Constraint {constraint['id']} cannot resolve sequence {predecessor} -> {successor}")

            pair_flags: dict[tuple[str, str], cp_model.BoolVar] = {}
            for pred in pred_sessions:
                for succ in succ_sessions:
                    flag = model.new_bool_var(f"sequence__{constraint['id']}__{pred.session['id']}__{succ.session['id']}")
                    model.add(succ.absolute_start == pred.absolute_end + gap).only_enforce_if(flag)
                    model.add(succ.absolute_start != pred.absolute_end + gap).only_enforce_if(flag.Not())
                    pair_flags[(pred.session["id"], succ.session["id"])] = flag

            if params.get("designatedWeeklyMeeting") is True:
                model.add_bool_or(pair_flags.values())
            else:
                for succ in succ_sessions:
                    flags = [flag for (_, succ_id), flag in pair_flags.items() if succ_id == succ.session["id"]]
                    model.add_bool_or(flags)

        elif kind == "FIXED_ASSIGNMENT":
            literal = model.new_bool_var(f"assume__{constraint['id']}")
            if diagnostic:
                model.add_assumption(literal)
                assumptions[literal.index] = constraint["id"]
            else:
                model.add(literal == 1)

            if not matching:
                raise ValueError(f"Constraint {constraint['id']} cannot resolve fixed class target")
            anchors = []
            for item in matching:
                anchor = model.new_bool_var(f"fixed_anchor__{constraint['id']}__{item.session['id']}")
                anchors.append(anchor)
                active = [literal, anchor]
                if params.get("day"):
                    model.add(item.day == DAY_INDEX[str(params["day"])]).only_enforce_if(active)
                if params.get("start"):
                    model.add(item.start == _slot(str(params["start"]))).only_enforce_if(active)
                if params.get("end"):
                    model.add(item.start + item.duration_slots == _slot(str(params["end"]))).only_enforce_if(active)
                teacher_name = ((selector.get("teacherNames") or [None])[0])
                room_name = ((selector.get("roomNames") or [None])[0])
                if teacher_name:
                    teacher_id = _resolve_unique_by_name(teachers, str(teacher_name), "teacher", constraint["id"])
                    model.add(item.teacher[teacher_id] == 1).only_enforce_if(active)
                if room_name:
                    room_id = _resolve_unique_by_name(rooms, str(room_name), "room", constraint["id"])
                    model.add(item.room[room_id] == 1).only_enforce_if(active)
            model.add_bool_or(anchors).only_enforce_if(literal)

        elif kind == "ROOM_CAPACITY":
            maximum = int(params.get("maxDancers", 0))
            exempt_levels = list(params.get("exemptLevels", []))
            room_names = selector.get("roomNames") or []
            room_ids = [_resolve_unique_by_name(rooms, str(room_name), "room", constraint["id"]) for room_name in room_names]
            for item in session_vars.values():
                exempt = bool(exempt_levels) and _level_matches(str(item.klass["level"]), exempt_levels)
                if exempt or len(item.klass.get("rosterStudentIds", [])) <= maximum:
                    continue
                for room_id in room_ids:
                    model.add(item.room[room_id] == 0)

        elif kind == "RELATIONSHIP_START_WINDOW":
            teacher_name = ((selector.get("teacherNames") or [None])[0])
            if not teacher_name:
                raise ValueError(f"Constraint {constraint['id']} does not identify a teacher relationship")
            teacher_id = _resolve_unique_by_name(teachers, str(teacher_name), "teacher", constraint["id"])
            daughter_names = list(params.get("daughterClassNames", []))
            daughter_ids: set[str] = set()
            for class_name in daughter_names:
                ids = class_name_to_ids.get(_normalize(str(class_name)), [])
                if len(ids) != 1:
                    raise ValueError(f"Constraint {constraint['id']} cannot uniquely resolve daughter class {class_name}")
                daughter_ids.add(ids[0])
            maximum = int(params.get("maxStartDifferenceMinutes", 0))
            if maximum % SLOT_MINUTES:
                raise ValueError(f"Constraint {constraint['id']} relationship window is not on the {SLOT_MINUTES}-minute grid")
            max_slots = maximum // SLOT_MINUTES

            for day_index, day_name in enumerate(DAYS):
                teacher_candidates = [(item, teacher_day_presence(item, teacher_id, day_index)) for item in session_vars.values()]
                daughter_candidates = [
                    (item, item.day_flags[day_index]) for item in session_vars.values() if item.klass["id"] in daughter_ids
                ]
                teacher_works, teacher_first = _sequence_circuit(
                    model, teacher_candidates, f"relationship_teacher__{constraint['id']}__{day_name}"
                )
                daughter_works, daughter_first = _sequence_circuit(
                    model, daughter_candidates, f"relationship_daughter__{constraint['id']}__{day_name}"
                )
                model.add_implication(teacher_works, daughter_works)

                for teacher_item, teacher_flag in teacher_first:
                    for daughter_item, daughter_flag in daughter_first:
                        both_first = _and_literal(
                            model,
                            [teacher_flag, daughter_flag],
                            f"relationship_pair__{constraint['id']}__{day_name}__{teacher_item.session['id']}__{daughter_item.session['id']}",
                        )
                        model.add(teacher_item.start - daughter_item.start <= max_slots).only_enforce_if(both_first)
                        model.add(daughter_item.start - teacher_item.start <= max_slots).only_enforce_if(both_first)

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
        end_slot = start_slot + item.duration_slots
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
    unsupported = sorted(item["id"] for item in constraints if item["kind"] not in SUPPORTED_KINDS | DELEGATED_KINDS)
    delegated = sorted(item["id"] for item in constraints if item["kind"] in DELEGATED_KINDS)
    validated_delegated = set((problem.get("preflight") or {}).get("validatedDelegatedConstraintIds", []))
    missing_preconditions = sorted(set(delegated) - validated_delegated)

    if unsupported:
        return {
            "status": "UNSUPPORTED",
            "unsupportedConstraintIds": unsupported,
            "delegatedConstraintIds": delegated,
            "missingPreconditionConstraintIds": [],
            "assignments": [],
            "blockingConstraintIds": [],
        }

    if missing_preconditions:
        return {
            "status": "PRECONDITION_REQUIRED",
            "unsupportedConstraintIds": [],
            "delegatedConstraintIds": delegated,
            "missingPreconditionConstraintIds": missing_preconditions,
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
            "delegatedConstraintIds": delegated,
            "missingPreconditionConstraintIds": [],
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
            "delegatedConstraintIds": delegated,
            "missingPreconditionConstraintIds": [],
            "assignments": [],
            "blockingConstraintIds": sorted(set(blockers)),
            "wallTimeSeconds": solver.wall_time,
        }

    return {
        "status": "UNKNOWN",
        "unsupportedConstraintIds": [],
        "delegatedConstraintIds": delegated,
        "missingPreconditionConstraintIds": [],
        "assignments": [],
        "blockingConstraintIds": [],
        "wallTimeSeconds": solver.wall_time,
    }
