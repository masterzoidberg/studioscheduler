from __future__ import annotations

from typing import Any

from ortools.sat.python import cp_model

from . import feasibility as legacy

POL02_UNIQUE_KINDS = {
    "STUDIO_OPERATING_WINDOWS",
    "ROOM_UNAVAILABLE_WINDOWS",
    "TEACHER_CLASS_DOMAIN",
    "ROOM_REQUIRED_FEATURES",
}


def _is_typed_extension(node: dict[str, Any]) -> bool:
    kind = node.get("kind")
    selector = node.get("selector") or {}
    params = node.get("parameters") or {}
    if kind in POL02_UNIQUE_KINDS:
        return True
    if kind == "REQUIRED_TEACHER":
        return bool(selector.get("teacherIds") or selector.get("classIds") or params.get("teacherId"))
    if kind == "REQUIRED_ROOM":
        return bool(selector.get("roomIds") or selector.get("classIds") or params.get("roomId"))
    if kind == "ROOM_CAPACITY":
        return params.get("capacitySource") == "PLANNING_DATASET" or bool(selector.get("roomIds"))
    return False


def _stable_ids(
    raw: Any,
    existing: set[str],
    label: str,
    constraint_id: str,
    *,
    allow_empty: bool = False,
) -> list[str]:
    if not isinstance(raw, list) or (not allow_empty and not raw):
        suffix = "an array" if allow_empty else "a non-empty array"
        raise ValueError(f"Constraint {constraint_id} requires {label} as {suffix} of stable IDs")
    values = [str(value) for value in raw]
    if any(not value for value in values):
        raise ValueError(f"Constraint {constraint_id} contains an empty stable {label} reference")
    if len(set(values)) != len(values):
        raise ValueError(f"Constraint {constraint_id} repeats a stable {label} reference")
    missing = sorted(value for value in values if value not in existing)
    if missing:
        raise ValueError(f"Constraint {constraint_id} references missing {label}: {', '.join(missing)}")
    return values


def _features(raw: Any, constraint_id: str) -> list[str]:
    if not isinstance(raw, list) or not raw:
        raise ValueError(f"Constraint {constraint_id} requires a non-empty requiredFeatures array")
    values = [str(value).strip() for value in raw]
    if any(not value for value in values):
        raise ValueError(f"Constraint {constraint_id} contains an empty required feature")
    if len(set(values)) != len(values):
        raise ValueError(f"Constraint {constraint_id} repeats a required feature")
    return values


def _windows(raw: Any, constraint_id: str) -> list[tuple[str, int, int]]:
    if not isinstance(raw, list) or not raw:
        raise ValueError(f"Constraint {constraint_id} requires a non-empty windows array")
    parsed: list[tuple[str, int, int]] = []
    for index, value in enumerate(raw):
        if not isinstance(value, dict):
            raise ValueError(f"Constraint {constraint_id} window {index + 1} must be an object")
        day = str(value.get("day", ""))
        if day not in legacy.DAY_INDEX:
            raise ValueError(f"Constraint {constraint_id} window {index + 1} has unsupported day {day!r}")
        try:
            start = legacy._slot(str(value.get("start", "")))
            end = legacy._slot(str(value.get("end", "")))
        except (TypeError, ValueError) as error:
            raise ValueError(f"Constraint {constraint_id} window {index + 1} is not on the {legacy.SLOT_MINUTES}-minute grid") from error
        if start >= end:
            raise ValueError(f"Constraint {constraint_id} window {index + 1} must be positive and same-day")
        parsed.append((day, start, end))
    return parsed


def _active_literal(built: legacy.BuiltModel, constraint_id: str, diagnostic: bool):
    literal = built.model.new_bool_var(f"assume__typed__{constraint_id}")
    if diagnostic:
        built.model.add_assumption(literal)
        built.assumptions[literal.index] = constraint_id
    else:
        built.model.add(literal == 1)
    return literal


def _qualification_bridge(
    problem: dict[str, Any],
    typed_nodes: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Keep legacy CUR-007 default-deny from suppressing typed qualification owners.

    The bridge is derived from stable teacher IDs on every solve. It carries no
    qualification meaning itself; the typed TEACHER_CLASS_DOMAIN constraint below
    remains the only authority for eligible class IDs.
    """
    teachers = {str(item["id"]): item for item in problem.get("teachers", [])}
    bridges: list[dict[str, Any]] = []
    seen: set[str] = set()
    for node in typed_nodes:
        if node.get("kind") != "TEACHER_CLASS_DOMAIN":
            continue
        selector = node.get("selector") or {}
        teacher_ids = _stable_ids(
            selector.get("teacherIds"),
            set(teachers),
            "teacherIds",
            str(node.get("id", "<unknown>")),
        )
        for teacher_id in teacher_ids:
            if teacher_id in seen:
                continue
            seen.add(teacher_id)
            bridges.append(
                {
                    "id": f"typed-qualification-bridge-{teacher_id}",
                    "kind": "TEACHER_SUBJECT_DOMAIN",
                    "ruleIds": [],
                    "selector": {"teacherNames": [str(teachers[teacher_id].get("name", ""))]},
                    "parameters": {},
                    "explanation": "Stable-ID typed qualification bridge for legacy default-deny coverage only.",
                }
            )
    return bridges


def _legacy_problem(problem: dict[str, Any], typed_nodes: list[dict[str, Any]]) -> dict[str, Any]:
    clone = dict(problem)
    constraint_model = dict(problem["constraintModel"])
    constraints = list(problem["constraintModel"]["hardConstraints"])
    constraint_model["hardConstraints"] = [node for node in constraints if not _is_typed_extension(node)] + _qualification_bridge(problem, typed_nodes)
    clone["constraintModel"] = constraint_model
    return clone


def _apply_studio_operating_windows(
    built: legacy.BuiltModel,
    node: dict[str, Any],
    active: Any,
) -> None:
    params = node.get("parameters") or {}
    windows = _windows(params.get("windows"), str(node["id"]))
    closed_raw = params.get("closedDays") or []
    if not isinstance(closed_raw, list):
        raise ValueError(f"Constraint {node['id']} closedDays must be an array")
    closed = [str(value) for value in closed_raw]
    if len(set(closed)) != len(closed):
        raise ValueError(f"Constraint {node['id']} repeats a closed day")
    invalid = sorted(day for day in closed if day not in legacy.DAY_INDEX)
    if invalid:
        raise ValueError(f"Constraint {node['id']} contains unsupported closed day(s): {', '.join(invalid)}")
    conflict = sorted({day for day, _, _ in windows if day in closed})
    if conflict:
        raise ValueError(f"Constraint {node['id']} defines operating windows on closed day(s): {', '.join(conflict)}")

    for item in built.sessions.values():
        choices = []
        for index, (day, start, end) in enumerate(windows):
            choice = built.model.new_bool_var(f"typed_window__{node['id']}__{item.session['id']}__{index}")
            built.model.add(item.day == legacy.DAY_INDEX[day]).only_enforce_if([active, choice])
            built.model.add(item.start >= start).only_enforce_if([active, choice])
            built.model.add(item.start + item.duration_slots <= end).only_enforce_if([active, choice])
            choices.append(choice)
        built.model.add_bool_or(choices).only_enforce_if(active)
        for day in closed:
            built.model.add(item.day_flags[legacy.DAY_INDEX[day]] == 0).only_enforce_if(active)


def _apply_room_unavailable_windows(
    built: legacy.BuiltModel,
    node: dict[str, Any],
    rooms: dict[str, dict[str, Any]],
    active: Any,
) -> None:
    selector = node.get("selector") or {}
    params = node.get("parameters") or {}
    room_ids = _stable_ids(selector.get("roomIds"), set(rooms), "roomIds", str(node["id"]))
    windows = _windows(params.get("windows"), str(node["id"]))

    for item in built.sessions.values():
        for room_id in room_ids:
            for index, (day, start, end) in enumerate(windows):
                before = built.model.new_bool_var(f"typed_room_before__{node['id']}__{item.session['id']}__{room_id}__{index}")
                after = built.model.new_bool_var(f"typed_room_after__{node['id']}__{item.session['id']}__{room_id}__{index}")
                built.model.add(item.start + item.duration_slots <= start).only_enforce_if([active, before])
                built.model.add(item.start >= end).only_enforce_if([active, after])
                built.model.add_bool_or(
                    [item.room[room_id].Not(), item.day_flags[legacy.DAY_INDEX[day]].Not(), before, after]
                ).only_enforce_if(active)


def _apply_teacher_class_domain(
    built: legacy.BuiltModel,
    node: dict[str, Any],
    teachers: dict[str, dict[str, Any]],
    classes: dict[str, dict[str, Any]],
    active: Any,
) -> None:
    selector = node.get("selector") or {}
    params = node.get("parameters") or {}
    teacher_ids = _stable_ids(selector.get("teacherIds"), set(teachers), "teacherIds", str(node["id"]))
    class_ids = _stable_ids(params.get("classIds"), set(classes), "classIds", str(node["id"]), allow_empty=True)
    allowed = set(class_ids)
    for item in built.sessions.values():
        if item.klass["id"] in allowed:
            continue
        for teacher_id in teacher_ids:
            built.model.add(item.teacher[teacher_id] == 0).only_enforce_if(active)


def _required_stable_id(
    node: dict[str, Any],
    key: str,
    selector_key: str,
    existing: set[str],
) -> str:
    selector = node.get("selector") or {}
    params = node.get("parameters") or {}
    selected = selector.get(selector_key) or []
    if not isinstance(selected, list):
        raise ValueError(f"Constraint {node['id']} {selector_key} must be an array")
    param_id = str(params.get(key) or "")
    if selected:
        resolved = _stable_ids(selected, existing, selector_key, str(node["id"]))
        if len(resolved) != 1:
            raise ValueError(f"Constraint {node['id']} must identify exactly one required {key}")
        if param_id and param_id != resolved[0]:
            raise ValueError(f"Constraint {node['id']} {key} disagrees with {selector_key}")
        param_id = resolved[0]
    if not param_id or param_id not in existing:
        raise ValueError(f"Constraint {node['id']} references missing required {key} {param_id!r}")
    return param_id


def _apply_required_teacher(
    built: legacy.BuiltModel,
    node: dict[str, Any],
    teachers: dict[str, dict[str, Any]],
    classes: dict[str, dict[str, Any]],
    active: Any,
) -> None:
    selector = node.get("selector") or {}
    class_ids = _stable_ids(selector.get("classIds"), set(classes), "classIds", str(node["id"]))
    teacher_id = _required_stable_id(node, "teacherId", "teacherIds", set(teachers))
    for item in built.sessions.values():
        if item.klass["id"] in class_ids:
            built.model.add(item.teacher[teacher_id] == 1).only_enforce_if(active)


def _apply_required_room(
    built: legacy.BuiltModel,
    node: dict[str, Any],
    rooms: dict[str, dict[str, Any]],
    classes: dict[str, dict[str, Any]],
    active: Any,
) -> None:
    selector = node.get("selector") or {}
    class_ids = _stable_ids(selector.get("classIds"), set(classes), "classIds", str(node["id"]))
    room_id = _required_stable_id(node, "roomId", "roomIds", set(rooms))
    for item in built.sessions.values():
        if item.klass["id"] in class_ids:
            built.model.add(item.room[room_id] == 1).only_enforce_if(active)


def _apply_room_capacity(
    built: legacy.BuiltModel,
    node: dict[str, Any],
    rooms: dict[str, dict[str, Any]],
    classes: dict[str, dict[str, Any]],
    active: Any,
) -> None:
    selector = node.get("selector") or {}
    params = node.get("parameters") or {}
    room_ids = _stable_ids(selector.get("roomIds"), set(rooms), "roomIds", str(node["id"]))
    exempt_ids = _stable_ids(params.get("exemptClassIds") or [], set(classes), "exemptClassIds", str(node["id"]), allow_empty=True)
    exempt = set(exempt_ids)
    selected_classes = selector.get("classIds")
    class_scope = set(classes)
    if selected_classes is not None:
        class_scope = set(_stable_ids(selected_classes, set(classes), "classIds", str(node["id"])))

    for item in built.sessions.values():
        class_id = str(item.klass["id"])
        if class_id not in class_scope or class_id in exempt:
            continue
        roster_size = len(item.klass.get("rosterStudentIds", []))
        for room_id in room_ids:
            capacity = rooms[room_id].get("capacity")
            if capacity is None or roster_size > int(capacity):
                built.model.add(item.room[room_id] == 0).only_enforce_if(active)


def _apply_room_required_features(
    built: legacy.BuiltModel,
    node: dict[str, Any],
    rooms: dict[str, dict[str, Any]],
    classes: dict[str, dict[str, Any]],
    active: Any,
) -> None:
    selector = node.get("selector") or {}
    params = node.get("parameters") or {}
    class_ids = set(_stable_ids(selector.get("classIds"), set(classes), "classIds", str(node["id"])))
    required = set(_features(params.get("requiredFeatures"), str(node["id"])))
    for item in built.sessions.values():
        if item.klass["id"] not in class_ids:
            continue
        for room_id, room in rooms.items():
            available = {str(value) for value in (room.get("features") or [])}
            if not required.issubset(available):
                built.model.add(item.room[room_id] == 0).only_enforce_if(active)


def _apply_typed_constraints(
    built: legacy.BuiltModel,
    problem: dict[str, Any],
    typed_nodes: list[dict[str, Any]],
    diagnostic: bool,
) -> None:
    classes = {str(item["id"]): item for item in problem.get("classes", [])}
    teachers = {str(item["id"]): item for item in problem.get("teachers", [])}
    rooms = {str(item["id"]): item for item in problem.get("rooms", [])}

    for node in typed_nodes:
        constraint_id = str(node.get("id", ""))
        if not constraint_id:
            raise ValueError("Typed constraint is missing id")
        active = _active_literal(built, constraint_id, diagnostic)
        kind = node.get("kind")
        if kind == "STUDIO_OPERATING_WINDOWS":
            _apply_studio_operating_windows(built, node, active)
        elif kind == "ROOM_UNAVAILABLE_WINDOWS":
            _apply_room_unavailable_windows(built, node, rooms, active)
        elif kind == "TEACHER_CLASS_DOMAIN":
            _apply_teacher_class_domain(built, node, teachers, classes, active)
        elif kind == "REQUIRED_TEACHER":
            _apply_required_teacher(built, node, teachers, classes, active)
        elif kind == "REQUIRED_ROOM":
            _apply_required_room(built, node, rooms, classes, active)
        elif kind == "ROOM_CAPACITY":
            _apply_room_capacity(built, node, rooms, classes, active)
        elif kind == "ROOM_REQUIRED_FEATURES":
            _apply_room_required_features(built, node, rooms, classes, active)
        else:
            raise ValueError(f"Unsupported typed Constraint IR node: {constraint_id}")


def _build_typed_model(problem: dict[str, Any], diagnostic: bool) -> legacy.BuiltModel:
    constraints = list(problem["constraintModel"]["hardConstraints"])
    typed_nodes = [node for node in constraints if _is_typed_extension(node)]
    built = legacy._build_model(_legacy_problem(problem, typed_nodes), diagnostic=diagnostic)
    _apply_typed_constraints(built, problem, typed_nodes, diagnostic)
    return built


def solve_feasibility(problem: dict[str, Any], max_seconds: float = 5.0) -> dict[str, Any]:
    constraints = problem["constraintModel"]["hardConstraints"]
    supported = legacy.SUPPORTED_KINDS | legacy.DELEGATED_KINDS | POL02_UNIQUE_KINDS
    unsupported = sorted(item["id"] for item in constraints if item["kind"] not in supported)
    delegated = sorted(item["id"] for item in constraints if item["kind"] in legacy.DELEGATED_KINDS)
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

    built = _build_typed_model(problem, diagnostic=False)
    solver = legacy._solver(max_seconds=max_seconds, diagnostic=False)
    status = solver.solve(built.model)

    if status in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        return {
            "status": "FEASIBLE",
            "unsupportedConstraintIds": [],
            "delegatedConstraintIds": delegated,
            "missingPreconditionConstraintIds": [],
            "assignments": legacy._extract_assignments(built, solver),
            "blockingConstraintIds": [],
            "wallTimeSeconds": solver.wall_time,
            "branches": solver.num_branches,
            "conflicts": solver.num_conflicts,
        }

    if status == cp_model.INFEASIBLE:
        diagnostic = _build_typed_model(problem, diagnostic=True)
        diagnostic_solver = legacy._solver(max_seconds=max_seconds, diagnostic=True)
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
