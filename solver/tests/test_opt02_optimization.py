from __future__ import annotations

from ortools.sat.python import cp_model

from dwde_solver import typed_feasibility
from dwde_solver.typed_feasibility import solve_feasibility


def _constraint(id_: str, kind: str, *, selector=None, parameters=None):
    return {
        "id": id_,
        "kind": kind,
        "ruleIds": [id_],
        "selector": selector or {},
        "parameters": parameters or {},
        "explanation": id_,
    }


def _problem(*, objectives=None, hard_constraints=None, sessions=None, locked=False):
    sessions = sessions or [{
        "id": "session-a",
        "classId": "class-a",
        "ordinal": 1,
        "durationMinutes": None,
        "locked": locked,
        "lockedPlacement": {
            "day": "Wednesday",
            "startTime": "18:00",
            "teacherId": "teacher-a",
            "roomId": "room-a",
        } if locked else None,
    }]
    hard_constraints = hard_constraints or [
        _constraint(
            "qualification-a",
            "TEACHER_SUBJECT_DOMAIN",
            selector={"teacherIds": ["teacher-a"]},
            parameters={"allowedSubjects": ["Ballet"]},
        ),
    ]
    return {
        "contractVersion": "1.0",
        "context": {
            "studioId": "opt02-studio",
            "rulebookVersion": 3,
            "planningDatasetVersion": 7,
            "compilerVersion": "dwde-ir-opt02",
        },
        "teachers": [{"id": "teacher-a", "name": "Teacher A"}],
        "rooms": [{"id": "room-a", "name": "Studio A", "capacity": 20, "features": []}],
        "students": [],
        "classes": [{
            "id": "class-a",
            "name": "Class A",
            "subject": "Ballet",
            "level": "Level 1",
            "durationMinutes": 60,
            "weeklyFrequency": len(sessions),
            "rosterStudentIds": [],
            "companyOnly": False,
        }],
        "sessions": sessions,
        "constraintModel": {
            "schemaVersion": "1.0",
            "compilerVersion": "dwde-ir-opt02",
            "rulebookVersion": 3,
            "planningDatasetVersion": 7,
            "activeRuleCount": 1,
            "hardConstraints": hard_constraints,
            "objectivePrioritySpine": objectives or [],
            "readinessRuleIds": [],
            "governanceAssertions": [],
            "uncompiledConstraintRuleIds": [],
            "completeHardConstraintCompilation": True,
        },
        "preflight": {"validatedDelegatedConstraintIds": []},
    }


def _preferred_day(rule_id="prefer-monday", *, rank=1, strength="VERY_STRONG"):
    return {
        "ruleId": rule_id,
        "rank": rank,
        "title": "Prefer Monday",
        "description": "Typed preference",
        "kind": "PREFERRED_DAY",
        "selector": {"classIds": ["class-a"]},
        "parameters": {"days": ["Monday"]},
        "strength": strength,
        "scoringEnabled": True,
    }


def test_known_small_preference_optimum_is_proven_and_reported():
    result = solve_feasibility(_problem(objectives=[_preferred_day()]), max_seconds=2)

    assert result["status"] == "FEASIBLE"
    assert result["optimizationStatus"] == "OPTIMAL"
    assert result["provenOptimal"] is True
    assert result["assignments"][0]["day"] == "Monday"
    assert result["objectiveValues"] == [{
        "ruleId": "prefer-monday",
        "rank": 1,
        "strength": "VERY_STRONG",
        "metric": "preferredDayMatches",
        "unit": "days",
        "direction": "MAXIMIZE",
        "value": 1,
    }]


def test_timeout_with_incumbent_is_returned_as_best_found(monkeypatch):
    class IncumbentSolver:
        wall_time = 0.001
        num_branches = 1
        num_conflicts = 0

        def solve(self, _model):
            return cp_model.FEASIBLE

        def boolean_value(self, variable):
            return variable.Name().endswith("__0") or "__teacher-a" in variable.Name() or "__room-a" in variable.Name()

        def value(self, variable):
            name = variable.Name()
            if name.startswith("day__"):
                return 0
            if name.startswith("start__"):
                return 68
            if name.startswith("abs_"):
                return 68
            return 1

    monkeypatch.setattr(typed_feasibility.legacy, "_solver", lambda **_kwargs: IncumbentSolver())
    result = solve_feasibility(_problem(objectives=[_preferred_day()]), max_seconds=0.01)

    assert result["status"] == "FEASIBLE"
    assert result["optimizationStatus"] == "FEASIBLE_INCUMBENT"
    assert result["provenOptimal"] is False
    assert result["assignments"]


def test_timeout_without_solution_does_not_fabricate_a_candidate(monkeypatch):
    class UnknownSolver:
        wall_time = 0.001
        num_branches = 0
        num_conflicts = 0

        def solve(self, _model):
            return cp_model.UNKNOWN

    monkeypatch.setattr(typed_feasibility.legacy, "_solver", lambda **_kwargs: UnknownSolver())
    result = solve_feasibility(_problem(objectives=[_preferred_day()]), max_seconds=0.01)

    assert result["status"] == "UNKNOWN"
    assert result["optimizationStatus"] == "NO_FEASIBLE_SOLUTION"
    assert result["provenOptimal"] is False
    assert result["assignments"] == []


def test_later_objective_timeout_downgrades_an_earlier_optimal_prefix(monkeypatch):
    class SequenceSolver:
        wall_time = 0.001
        num_branches = 1
        num_conflicts = 0
        calls = 0

        def solve(self, _model):
            self.calls += 1
            return cp_model.OPTIMAL if self.calls == 1 else cp_model.UNKNOWN

        def boolean_value(self, variable):
            return variable.Name().endswith("__0") or "__teacher-a" in variable.Name() or "__room-a" in variable.Name()

        def value(self, variable):
            if not hasattr(variable, "Name"):
                return 1
            name = variable.Name()
            if name.startswith("day__"):
                return 0
            if name.startswith("start__") or name.startswith("abs_"):
                return 68
            return 1

    solver = SequenceSolver()
    monkeypatch.setattr(typed_feasibility.legacy, "_solver", lambda **_kwargs: solver)
    result = solve_feasibility(_problem(objectives=[_preferred_day(), _preferred_day("second-objective", rank=2)]), max_seconds=0.01)

    assert result["status"] == "FEASIBLE"
    assert result["optimizationStatus"] == "FEASIBLE_INCUMBENT"
    assert result["provenOptimal"] is False


def test_optimization_preserves_hard_lock_context_and_reports_only_legal_score():
    result = solve_feasibility(_problem(objectives=[_preferred_day()], locked=True), max_seconds=2)

    assert result["status"] == "FEASIBLE"
    assert result["assignments"][0]["day"] == "Wednesday"
    assert result["assignments"][0]["startTime"] == "18:00"
    assert result["objectiveValues"][0]["value"] == 0


def test_preference_objective_does_not_change_hard_infeasibility():
    hard = [
        _constraint("qualification-a", "TEACHER_SUBJECT_DOMAIN", selector={"teacherIds": ["teacher-a"]}, parameters={"allowedSubjects": ["Ballet"]}),
        _constraint("fixed-tuesday", "FIXED_ASSIGNMENT", selector={"classNames": ["Class A"]}, parameters={"day": "Tuesday", "start": "18:00"}),
    ]
    result = solve_feasibility(_problem(objectives=[_preferred_day()], hard_constraints=hard), max_seconds=2)

    assert result["status"] == "FEASIBLE"
    assert result["assignments"][0]["day"] == "Tuesday"
    assert result["objectiveValues"][0]["value"] == 0
