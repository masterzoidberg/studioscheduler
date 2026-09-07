from __future__ import annotations

import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def read(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")


def write(path: str, content: str) -> None:
    target = ROOT / path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(content, encoding="utf-8", newline="\n")


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: expected exactly one match, found {count}")
    return text.replace(old, new, 1)


def apply_solver_problem() -> None:
    path = "lib/solver-problem.ts"
    text = read(path)
    text = replace_once(
        text,
        'import type { StudioState } from "@/lib/domain";\n',
        'import type { Assignment, StudioState } from "@/lib/domain";\nimport { placementEndTime, sessionDurationMinutes } from "@/lib/schedule-builder";\n',
        "solver-problem imports",
    )
    marker = 'const SOLVE_REMEDIABLE_READINESS_CODES = new Set(["SCHEDULE_PLANNING_DATASET_STALE"]);\n'
    helpers = r'''
const CANONICAL_LOCK_DAYS = new Set(["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]);
const CANONICAL_LOCK_TIME = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

type RuntimeLockState = {
  locked: boolean;
  sessionLocked: boolean;
  assignmentLocked: boolean;
  assignment: Assignment | null;
  assignmentCount: number;
};

/**
 * Runtime lock precedence is intentionally conservative: either the immutable
 * planning-session lock OR the current ScheduleVersion assignment lock protects
 * the exact current placement. An explicit false on one representation never
 * cancels a true lock on the other representation.
 *
 * Assignments for sessions outside the active pinned Planning Dataset are
 * historical and do not become current solver locks.
 */
function runtimeLockStateBySession(state: StudioState): Map<string, RuntimeLockState> {
  const currentSchedule = state.scheduleVersions.find((version) => version.isCurrent);
  const assignmentsBySession = new Map<string, Assignment[]>();
  for (const assignment of currentSchedule?.assignments || []) {
    const values = assignmentsBySession.get(assignment.sessionId) || [];
    values.push(assignment);
    assignmentsBySession.set(assignment.sessionId, values);
  }

  return new Map(state.sessions.map((session) => {
    const assignments = assignmentsBySession.get(session.id) || [];
    const sessionLocked = Boolean(session.locked);
    const assignmentLocked = assignments.some((assignment) => Boolean(assignment.locked));
    return [session.id, {
      locked: sessionLocked || assignmentLocked,
      sessionLocked,
      assignmentLocked,
      assignment: assignments.length === 1 ? assignments[0] : null,
      assignmentCount: assignments.length,
    }];
  }));
}

export function runtimeLockBlockers(state: StudioState): FeasibilityPreparationFailure["blockers"] {
  const blockers: FeasibilityPreparationFailure["blockers"] = [];
  const lockState = runtimeLockStateBySession(state);
  const teacherIds = new Set(state.teachers.map((teacher) => teacher.id));
  const roomIds = new Set(state.rooms.map((room) => room.id));
  const classById = new Map(state.classes.map((klass) => [klass.id, klass]));

  for (const session of [...state.sessions].sort((a, b) => compareCanonicalStrings(a.id, b.id))) {
    const lock = lockState.get(session.id);
    if (!lock?.locked) continue;

    if (lock.assignmentCount !== 1 || !lock.assignment) {
      blockers.push({
        code: "LOCKED_SESSION_PLACEMENT_UNRESOLVED",
        message: `Locked session ${session.id} must have exactly one current assignment to preserve; found ${lock.assignmentCount}.`,
        ruleIds: [],
        entityIds: [session.id],
      });
      continue;
    }

    const assignment = lock.assignment;
    const staleIds = [
      ...(!teacherIds.has(assignment.teacherId) ? [assignment.teacherId] : []),
      ...(!roomIds.has(assignment.roomId) ? [assignment.roomId] : []),
    ];
    const canonicalPlacement = CANONICAL_LOCK_DAYS.has(assignment.day)
      && CANONICAL_LOCK_TIME.test(assignment.startTime.slice(0, 5))
      && CANONICAL_LOCK_TIME.test(assignment.endTime.slice(0, 5));
    if (!canonicalPlacement || staleIds.length > 0) {
      blockers.push({
        code: "LOCKED_SESSION_PLACEMENT_STALE",
        message: `Locked session ${session.id} references a placement that is no longer canonical in the pinned active solver inventory.`,
        ruleIds: [],
        entityIds: [session.id, ...staleIds],
      });
      continue;
    }

    const klass = classById.get(session.classId);
    if (!klass) {
      blockers.push({
        code: "LOCKED_SESSION_PLACEMENT_STALE",
        message: `Locked session ${session.id} references missing class ${session.classId}.`,
        ruleIds: [],
        entityIds: [session.id, session.classId],
      });
      continue;
    }

    const duration = sessionDurationMinutes(session, klass);
    const expectedEnd = Number.isFinite(duration) && Number.isSafeInteger(duration) && duration > 0
      ? placementEndTime(assignment.startTime, duration)
      : null;
    if (!expectedEnd || expectedEnd !== assignment.endTime.slice(0, 5)) {
      blockers.push({
        code: "LOCKED_SESSION_DURATION_MISMATCH",
        message: `Locked session ${session.id} must preserve its canonical ${duration}-minute duration; current placement ${assignment.startTime.slice(0, 5)}-${assignment.endTime.slice(0, 5)} is inconsistent.`,
        ruleIds: [],
        entityIds: [session.id],
      });
    }
  }

  return blockers;
}
'''
    text = replace_once(text, marker, marker + helpers, "runtime lock helpers")
    text = replace_once(
        text,
        '  const currentSchedule = state.scheduleVersions.find((version) => version.isCurrent);\n  const currentAssignmentBySession = new Map((currentSchedule?.assignments || []).map((assignment) => [assignment.sessionId, assignment]));\n',
        '  const runtimeLocks = runtimeLockStateBySession(state);\n',
        "build lock state",
    )
    old_session_map = '''      .map((session) => {
        const assignment = currentAssignmentBySession.get(session.id);
        return {
          id: session.id,
          classId: session.classId,
          ordinal: session.ordinal,
          durationMinutes: session.durationMinutes ?? null,
          locked: Boolean(session.locked),
          lockedPlacement: session.locked && assignment ? {
            day: assignment.day,
            startTime: assignment.startTime,
            teacherId: assignment.teacherId,
            roomId: assignment.roomId,
          } : null,
        };
      })
'''
    new_session_map = '''      .map((session) => {
        const runtimeLock = runtimeLocks.get(session.id);
        const assignment = runtimeLock?.assignment;
        return {
          id: session.id,
          classId: session.classId,
          ordinal: session.ordinal,
          durationMinutes: session.durationMinutes ?? null,
          locked: Boolean(runtimeLock?.locked),
          lockedPlacement: runtimeLock?.locked && assignment ? {
            day: assignment.day,
            startTime: assignment.startTime.slice(0, 5),
            teacherId: assignment.teacherId,
            roomId: assignment.roomId,
          } : null,
        };
      })
'''
    text = replace_once(text, old_session_map, new_session_map, "serialized runtime locks")
    old_block = '''  const currentSchedule = state.scheduleVersions.find((version) => version.isCurrent);
  const assignmentCountBySession = new Map<string, number>();
  for (const assignment of currentSchedule?.assignments || []) {
    assignmentCountBySession.set(assignment.sessionId, (assignmentCountBySession.get(assignment.sessionId) || 0) + 1);
  }
  const unresolvedLockedSessionIds = state.sessions
    .filter((session) => session.locked && assignmentCountBySession.get(session.id) !== 1)
    .map((session) => session.id)
    .sort(compareCanonicalStrings);
  if (unresolvedLockedSessionIds.length) {
    blockers.push({
      code: "LOCKED_SESSION_PLACEMENT_UNRESOLVED",
      message: `${unresolvedLockedSessionIds.length} locked session(s) do not have exactly one current assignment to preserve in a replacement solve.`,
      ruleIds: [],
      entityIds: unresolvedLockedSessionIds,
    });
  }

  const sessionCountByClass = new Map<string, number>();
  for (const session of state.sessions) {
    sessionCountByClass.set(session.classId, (sessionCountByClass.get(session.classId) || 0) + 1);
  }
  const ambiguousLockedSessionIds = state.sessions
    .filter((session) => session.locked && (sessionCountByClass.get(session.classId) || 0) !== 1)
    .map((session) => session.id)
    .sort(compareCanonicalStrings);
  if (ambiguousLockedSessionIds.length) {
    blockers.push({
      code: "LOCKED_MULTI_SESSION_CLASS_UNSUPPORTED",
      message: `${ambiguousLockedSessionIds.length} locked session(s) belong to multi-session classes. Ordinal-specific runtime locks must be implemented before those sessions can be solved safely.`,
      ruleIds: [],
      entityIds: ambiguousLockedSessionIds,
    });
  }
'''
    text = replace_once(text, old_block, '  blockers.push(...runtimeLockBlockers(state));\n', "replace legacy lock blockers")
    write(path, text)


def apply_feasibility() -> None:
    path = "solver/dwde_solver/feasibility.py"
    text = read(path)
    text = replace_once(
        text,
        '    session_vars: dict[str, SessionVars] = {}\n    teacher_intervals: dict[str, list[cp_model.IntervalVar]] = {item: [] for item in teachers}\n',
        '    session_vars: dict[str, SessionVars] = {}\n    assumptions: dict[int, str] = {}\n    teacher_intervals: dict[str, list[cp_model.IntervalVar]] = {item: [] for item in teachers}\n',
        "feasibility assumptions placement",
    )
    old_vars = '''        session_vars[session["id"]] = SessionVars(
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
'''
    new_vars = '''        item = SessionVars(
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
        session_vars[session["id"]] = item

        # Runtime locks are schedule state, not policy IR. Bind them directly to
        # this stable session ID so one weekly meeting can be frozen without
        # anchoring sibling meetings that share the same class/display name.
        if session.get("locked") is True:
            placement = session.get("lockedPlacement")
            session_id = str(session.get("id", ""))
            if not isinstance(placement, dict):
                raise ValueError(f"Runtime lock {session_id or '<missing>'} has no canonical placement")

            day_name = str(placement.get("day", ""))
            start_text = str(placement.get("startTime", ""))
            teacher_id = str(placement.get("teacherId", ""))
            room_id = str(placement.get("roomId", ""))
            if day_name not in DAY_INDEX:
                raise ValueError(f"Runtime lock {session_id} has invalid day {day_name!r}")
            try:
                start_slot = _slot(start_text)
            except (TypeError, ValueError) as error:
                raise ValueError(f"Runtime lock {session_id} has invalid startTime {start_text!r}") from error
            if start_slot < 0 or start_slot + duration > SLOTS_PER_DAY:
                raise ValueError(f"Runtime lock {session_id} startTime {start_text!r} cannot preserve canonical duration")
            if teacher_id not in teachers:
                raise ValueError(f"Runtime lock {session_id} references missing teacher {teacher_id!r}")
            if room_id not in rooms:
                raise ValueError(f"Runtime lock {session_id} references missing room {room_id!r}")

            literal = model.new_bool_var(f"assume__runtime_lock__{session_id}")
            if diagnostic:
                model.add_assumption(literal)
                assumptions[literal.index] = f"runtime-lock:{session_id}"
            else:
                model.add(literal == 1)
            model.add(item.day == DAY_INDEX[day_name]).only_enforce_if(literal)
            model.add(item.start == start_slot).only_enforce_if(literal)
            model.add(item.teacher[teacher_id] == 1).only_enforce_if(literal)
            model.add(item.room[room_id] == 1).only_enforce_if(literal)
        elif session.get("lockedPlacement") is not None:
            raise ValueError(f"Unlocked session {session.get('id', '<missing>')} must not carry lockedPlacement")
'''
    text = replace_once(text, old_vars, new_vars, "direct session runtime locks")
    text = replace_once(text, '    assumptions: dict[int, str] = {}\n\n    overrides_by_base', '    overrides_by_base', "remove duplicate assumptions")
    write(path, text)


def apply_service() -> None:
    path = "solver/dwde_solver/service.py"
    text = read(path)
    text = replace_once(text, 'import copy\n', '', "remove copy import")
    start = text.index('def _normalized_name(value: Any) -> str:\n')
    end = text.index('@app.get("/healthz"', start)
    text = text[:start] + text[end:]
    text = replace_once(
        text,
        '    context = _validate_problem_contract(request.problem)\n    solver_problem = _problem_with_runtime_locks(request.problem)\n\n    try:\n        result = solve_feasibility(solver_problem, max_seconds=request.maxSeconds)\n',
        '    context = _validate_problem_contract(request.problem)\n\n    try:\n        result = solve_feasibility(request.problem, max_seconds=request.maxSeconds)\n',
        "service direct solver call",
    )
    write(path, text)


def apply_fixture() -> None:
    fixture = {
        "class": {
            "id": "multi-class",
            "name": "Multi Ballet",
            "subject": "Ballet",
            "level": "Level 3",
            "durationMinutes": 60,
            "weeklyFrequency": 2,
            "rosterStudentIds": [],
            "companyOnly": False,
        },
        "teachers": [{"id": "teacher-a", "name": "Teacher A"}],
        "rooms": [{"id": "room-a", "name": "Studio A", "capacity": 20, "features": []}],
        "planningSessions": [
            {"id": "multi-session-1", "classId": "multi-class", "ordinal": 1, "durationMinutes": 75, "locked": False},
            {"id": "multi-session-2", "classId": "multi-class", "ordinal": 2, "durationMinutes": None, "locked": False},
        ],
        "currentAssignments": [
            {
                "id": "assignment-multi-session-1",
                "sessionId": "multi-session-1",
                "day": "Monday",
                "startTime": "18:30",
                "endTime": "19:45",
                "teacherId": "teacher-a",
                "roomId": "room-a",
                "locked": True,
                "status": "NORMAL",
            }
        ],
        "effectiveSolverSessions": [
            {
                "id": "multi-session-1",
                "classId": "multi-class",
                "ordinal": 1,
                "durationMinutes": 75,
                "locked": True,
                "lockedPlacement": {"day": "Monday", "startTime": "18:30", "teacherId": "teacher-a", "roomId": "room-a"},
            },
            {
                "id": "multi-session-2",
                "classId": "multi-class",
                "ordinal": 2,
                "durationMinutes": None,
                "locked": False,
                "lockedPlacement": None,
            },
        ],
        "expectedLockedAssignment": {
            "sessionId": "multi-session-1",
            "day": "Monday",
            "startTime": "18:30",
            "endTime": "19:45",
            "teacherId": "teacher-a",
            "roomId": "room-a",
        },
    }
    write("tests/fixtures/session-lock-semantics.json", json.dumps(fixture, indent=2) + "\n")


def apply_ts_tests() -> None:
    content = r'''import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { ConstraintModelSnapshotV1 } from "@/lib/constraint-ir";
import type { Assignment, ClassDefinition, ClassSession, StudioState } from "@/lib/domain";
import { validateDelegatedSolverPreconditions } from "@/lib/delegated-solver-preflight";
import { buildFeasibilityProblemPayload, runtimeLockBlockers } from "@/lib/solver-problem";
import { validateFeasibleSolverCandidate, type SolverServicePayload } from "@/lib/solver-gateway";

const fixture = JSON.parse(readFileSync(join(process.cwd(), "tests", "fixtures", "session-lock-semantics.json"), "utf8")) as {
  class: Omit<ClassDefinition, "eligibleTeacherIds">;
  teachers: Array<{ id: string; name: string }>;
  rooms: Array<{ id: string; name: string; capacity: number; features: string[] }>;
  planningSessions: Array<{ id: string; classId: string; ordinal: number; durationMinutes: number | null; locked: boolean }>;
  currentAssignments: Assignment[];
  effectiveSolverSessions: Array<Record<string, unknown>>;
  expectedLockedAssignment: Record<string, string>;
};

const now = "2026-09-07T00:00:00Z";

function state(): StudioState {
  const klass: ClassDefinition = { ...fixture.class, eligibleTeacherIds: [] };
  const sessions: ClassSession[] = fixture.planningSessions.map((session) => ({
    id: session.id,
    classId: session.classId,
    ordinal: session.ordinal,
    durationMinutes: session.durationMinutes ?? undefined,
    locked: session.locked,
  }));
  return {
    studioId: "studio",
    studioName: "Fixture Studio",
    teachers: fixture.teachers.map((teacher) => ({ ...teacher, subjects: [] })),
    rooms: fixture.rooms,
    students: [],
    cohorts: [],
    classes: [klass],
    sessions,
    rules: [],
    rulebookVersions: [{ id: "rb", version: 3, name: "v3", createdAt: now, actor: "test", reason: "test", changedRuleIds: [], status: "CURRENT" }],
    enforcementVersions: [],
    planningDatasetVersions: [{
      id: "pd", version: 7, createdAt: now, actor: "test", reason: "test", snapshotHash: "0".repeat(64), status: "CURRENT",
      confirmedForSchedulingAt: now,
      snapshot: {
        schemaVersion: "1.3", studioId: "studio", teacherIds: fixture.teachers.map((teacher) => teacher.id),
        teachers: fixture.teachers, rooms: fixture.rooms, students: [], cohorts: [], classes: [{ ...fixture.class }],
        sessions: fixture.planningSessions.map((session) => ({ ...session })),
      },
    }],
    enforcementProposals: [],
    ruleHistory: [],
    scheduleVersions: [{
      id: "schedule", version: 4, rulebookVersion: 3, enforcementVersion: 3, planningDatasetVersion: 7,
      createdAt: now, actor: "test", reason: "fixture", assignments: fixture.currentAssignments.map((assignment) => ({ ...assignment })), isCurrent: true,
    }],
    scenarios: [],
    auditEvents: [],
  };
}

function model(): ConstraintModelSnapshotV1 {
  return {
    schemaVersion: "1.0",
    compilerVersion: "session-lock-fixture",
    rulebookVersion: 3,
    planningDatasetVersion: 7,
    activeRuleCount: 0,
    hardConstraints: [],
    objectivePrioritySpine: [],
    readinessRuleIds: [],
    governanceAssertions: [],
    uncompiledConstraintRuleIds: [],
    completeHardConstraintCompilation: true,
  };
}

function problemFor(s: StudioState) {
  const m = model();
  return buildFeasibilityProblemPayload(s, m, validateDelegatedSolverPreconditions(s, m));
}

describe("T09 session-specific runtime locks", () => {
  it("uses assignment OR session lock precedence and serializes the shared stable-session fixture", () => {
    const s = state();
    expect(s.sessions[0].locked).toBe(false);
    expect(s.scheduleVersions[0].assignments[0].locked).toBe(true);
    expect(runtimeLockBlockers(s)).toEqual([]);

    const problem = problemFor(s);
    expect(problem.sessions).toEqual(fixture.effectiveSolverSessions);
    expect(problem.sessions[0].id).toBe("multi-session-1");
    expect(problem.sessions[1].locked).toBe(false);
  });

  it("does not let an assignment false cancel a planning-session lock", () => {
    const s = state();
    s.sessions[0].locked = true;
    s.scheduleVersions[0].assignments[0].locked = false;
    const problem = problemFor(s);
    expect(problem.sessions[0]).toMatchObject({ locked: true, lockedPlacement: fixture.effectiveSolverSessions[0].lockedPlacement });
  });

  it("fails missing, stale, and duration-inconsistent runtime locks with stable explanations", () => {
    const missing = state();
    missing.sessions[0].locked = true;
    missing.scheduleVersions[0].assignments = [];
    expect(runtimeLockBlockers(missing)).toEqual([expect.objectContaining({ code: "LOCKED_SESSION_PLACEMENT_UNRESOLVED", entityIds: ["multi-session-1"] })]);

    const stale = state();
    stale.scheduleVersions[0].assignments[0].teacherId = "archived-teacher";
    expect(runtimeLockBlockers(stale)).toEqual([expect.objectContaining({ code: "LOCKED_SESSION_PLACEMENT_STALE" })]);

    const duration = state();
    duration.scheduleVersions[0].assignments[0].endTime = "19:30";
    expect(runtimeLockBlockers(duration)).toEqual([expect.objectContaining({ code: "LOCKED_SESSION_DURATION_MISMATCH" })]);
  });

  it("candidate validation preserves only the exact locked meeting and rejects moving it", () => {
    const s = state();
    const problem = problemFor(s);
    const sibling = {
      sessionId: "multi-session-2",
      day: "Tuesday" as const,
      startTime: "18:30",
      endTime: "19:30",
      teacherId: "teacher-a",
      roomId: "room-a",
    };
    const payload: SolverServicePayload = {
      serviceVersion: "fixture",
      context: { ...problem.context },
      result: { status: "FEASIBLE", assignments: [fixture.expectedLockedAssignment as never, sibling] },
    };
    const accepted = validateFeasibleSolverCandidate(s, problem, payload);
    expect(accepted.ok).toBe(true);
    expect(accepted.assignments.find((assignment) => assignment.sessionId === "multi-session-1")?.locked).toBe(true);
    expect(accepted.assignments.find((assignment) => assignment.sessionId === "multi-session-2")?.locked).toBe(false);

    const moved: SolverServicePayload = {
      ...payload,
      result: {
        status: "FEASIBLE",
        assignments: [{ ...fixture.expectedLockedAssignment, day: "Wednesday" } as never, sibling],
      },
    };
    const rejected = validateFeasibleSolverCandidate(s, problem, moved);
    expect(rejected.ok).toBe(false);
    expect(rejected.blockers.map((blocker) => blocker.code)).toContain("SOLVER_CANDIDATE_LOCKED_PLACEMENT_CHANGED");
  });
});
'''
    write("tests/session-specific-locks.test.ts", content)

    migration_test = r'''import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(join(process.cwd(), "supabase", "migrations", "20260907090000_session_specific_solver_locks_v45.sql"), "utf8");

describe("T09 solver-adoption lock precedence migration", () => {
  it("wraps the canonical v33 writer without rewriting historical migrations", () => {
    expect(sql).toContain("rename to adopt_solver_candidate_v33_pre_v45");
    expect(sql).toContain("create or replace function public.adopt_solver_candidate_v33(");
    expect(sql).toContain("public.adopt_solver_candidate_v33_pre_v45(");
  });

  it("treats either session or assignment lock as protective and carries assignment locks forward", () => {
    expect(sql).toMatch(/s\.locked\s*=\s*true\s+or\s+old_a\.locked\s*=\s*true/i);
    expect(sql).toMatch(/set\s+locked\s*=\s*true/i);
    expect(sql).toContain("SESSION_OR_ASSIGNMENT");
  });

  it("keeps the renamed pre-v45 writer off the service-role surface", () => {
    expect(sql).toMatch(/revoke all on function public\.adopt_solver_candidate_v33_pre_v45[\s\S]*service_role/i);
    expect(sql).toMatch(/grant execute on function public\.adopt_solver_candidate_v33\([\s\S]*service_role/i);
  });
});
'''
    write("tests/session-lock-adoption.test.ts", migration_test)


def apply_python_tests() -> None:
    test_path = "solver/tests/test_service.py"
    text = read(test_path)
    old = r'''def test_service_rejects_ambiguous_multi_session_lock(monkeypatch):
    monkeypatch.setenv("SOLVER_INTERNAL_TOKEN", "internal-secret")
    payload = problem()
    payload["classes"][0]["weeklyFrequency"] = 2
    payload["sessions"] = [
        {
            "id": "session-1",
            "classId": "class",
            "ordinal": 1,
            "durationMinutes": None,
            "locked": True,
            "lockedPlacement": {
                "day": "Monday",
                "startTime": "18:30",
                "teacherId": "teacher",
                "roomId": "room",
            },
        },
        {
            "id": "session-2",
            "classId": "class",
            "ordinal": 2,
            "durationMinutes": None,
            "locked": False,
            "lockedPlacement": None,
        },
    ]

    response = client.post(
        "/v1/feasibility",
        headers={"Authorization": "Bearer internal-secret"},
        json={"problem": payload},
    )
    assert response.status_code == 422
    assert "multi-session class" in response.json()["detail"]
'''
    new = r'''def test_service_preserves_one_locked_meeting_of_multi_session_class(monkeypatch):
    monkeypatch.setenv("SOLVER_INTERNAL_TOKEN", "internal-secret")
    payload = problem()
    payload["classes"][0]["weeklyFrequency"] = 2
    payload["sessions"] = [
        {
            "id": "session-1",
            "classId": "class",
            "ordinal": 1,
            "durationMinutes": 75,
            "locked": True,
            "lockedPlacement": {
                "day": "Monday",
                "startTime": "18:30",
                "teacherId": "teacher",
                "roomId": "room",
            },
        },
        {
            "id": "session-2",
            "classId": "class",
            "ordinal": 2,
            "durationMinutes": None,
            "locked": False,
            "lockedPlacement": None,
        },
    ]
    payload["constraintModel"]["hardConstraints"] = [
        {"id": "teacher-no-overlap", "kind": "RESOURCE_NO_OVERLAP", "ruleIds": [], "selector": {}, "parameters": {"resource": "TEACHER"}, "explanation": "teacher overlap"},
        {"id": "room-no-overlap", "kind": "RESOURCE_NO_OVERLAP", "ruleIds": [], "selector": {}, "parameters": {"resource": "ROOM"}, "explanation": "room overlap"},
    ]

    response = client.post(
        "/v1/feasibility",
        headers={"Authorization": "Bearer internal-secret"},
        json={"problem": payload},
    )
    assert response.status_code == 200
    assignments = {item["sessionId"]: item for item in response.json()["result"]["assignments"]}
    assert assignments["session-1"] == {
        "sessionId": "session-1",
        "day": "Monday",
        "startTime": "18:30",
        "endTime": "19:45",
        "teacherId": "teacher",
        "roomId": "room",
    }
    assert (assignments["session-2"]["day"], assignments["session-2"]["startTime"]) != ("Monday", "18:30")


def test_service_rejects_structurally_stale_runtime_lock(monkeypatch):
    monkeypatch.setenv("SOLVER_INTERNAL_TOKEN", "internal-secret")
    payload = problem()
    payload["sessions"][0]["locked"] = True
    payload["sessions"][0]["lockedPlacement"] = {
        "day": "Monday",
        "startTime": "18:30",
        "teacherId": "missing-teacher",
        "roomId": "room",
    }
    response = client.post(
        "/v1/feasibility",
        headers={"Authorization": "Bearer internal-secret"},
        json={"problem": payload},
    )
    assert response.status_code == 422
    assert response.json()["detail"] == "Runtime lock session references missing teacher 'missing-teacher'"
'''
    text = replace_once(text, old, new, "replace legacy multi-session service test")
    write(test_path, text)

    content = r'''from __future__ import annotations

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
'''
    write("solver/tests/test_session_locks.py", content)


def apply_migration() -> None:
    sql = r'''-- T09 / V4.5 session-specific runtime solver locks.
--
-- Runtime lock precedence is SESSION OR ASSIGNMENT. A true planning-session lock
-- or a true lock on the current ScheduleVersion assignment protects that exact
-- stable session ID and placement. The previous V3.3 writer is retained under a
-- non-service-role name and wrapped so every adoption path carries assignment
-- locks forward while preserving the T08 reviewed-context transaction.

alter function public.adopt_solver_candidate_v33(
  uuid,uuid,text,text,integer,integer,integer,integer,integer,jsonb,jsonb
) rename to adopt_solver_candidate_v33_pre_v45;

revoke all on function public.adopt_solver_candidate_v33_pre_v45(
  uuid,uuid,text,text,integer,integer,integer,integer,integer,jsonb,jsonb
) from public,anon,authenticated,service_role;

create or replace function public.adopt_solver_candidate_v33(
  p_studio_id uuid,
  p_actor_user_id uuid,
  p_actor_label text,
  p_reason text,
  p_expected_schedule_version integer,
  p_expected_rulebook_version integer,
  p_expected_enforcement_version integer,
  p_expected_planning_dataset_version integer,
  p_expected_constraint_model_version integer,
  p_candidate jsonb,
  p_application_validation jsonb
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $function$
declare
  v_current_schedule public.schedule_versions%rowtype;
  v_locked_changed integer := 0;
  v_unresolved integer := 0;
  v_result jsonb;
  v_new_id uuid;
  v_preserved_assignment_locks integer := 0;
begin
  if p_studio_id is null then raise exception 'Studio is required'; end if;
  if p_candidate is null or jsonb_typeof(p_candidate)<>'array' then raise exception 'Candidate must be a JSON array'; end if;

  perform pg_advisory_xact_lock(hashtextextended(p_studio_id::text,0));
  perform pg_advisory_xact_lock(hashtextextended('planning-dataset:'||p_studio_id::text,0));
  perform pg_advisory_xact_lock(hashtextextended('constraint-model:'||p_studio_id::text,0));

  select * into v_current_schedule
  from public.schedule_versions
  where studio_id=p_studio_id and is_current
  limit 1;
  if v_current_schedule.id is null then raise exception 'No current schedule exists'; end if;

  -- A planning-session lock cannot be resolved without exactly one current
  -- assignment. Assignment-only locks necessarily have the assignment row that
  -- carries the lock. Archived sessions/classes are historical and excluded.
  select count(*)::integer into v_unresolved
  from public.class_sessions s
  join public.class_definitions c
    on c.studio_id=s.studio_id and c.id=s.class_id and c.archived_at is null
  where s.studio_id=p_studio_id
    and s.archived_at is null
    and s.locked=true
    and (
      select count(*) from public.assignments old_a
      where old_a.schedule_version_id=v_current_schedule.id and old_a.session_id=s.id
    )<>1;
  if v_unresolved>0 then
    raise exception 'LOCKED_SESSION_PLACEMENT_UNRESOLVED: % active session lock(s) do not have exactly one current assignment',v_unresolved;
  end if;

  -- Effective lock precedence is OR. Assignment false never cancels session true,
  -- and session false never cancels a current assignment lock. Compare the exact
  -- stable session placement before invoking the historical canonical writer.
  select count(*)::integer into v_locked_changed
  from public.class_sessions s
  join public.class_definitions c
    on c.studio_id=s.studio_id and c.id=s.class_id and c.archived_at is null
  join public.assignments old_a
    on old_a.schedule_version_id=v_current_schedule.id and old_a.session_id=s.id
  left join lateral (
    select elem
    from jsonb_array_elements(p_candidate) elem
    where elem->>'sessionId'=s.id
    limit 1
  ) candidate on true
  where s.studio_id=p_studio_id
    and s.archived_at is null
    and (s.locked=true or old_a.locked=true)
    and (
      candidate.elem is null
      or candidate.elem->>'day' is distinct from old_a.day
      or candidate.elem->>'startTime' is distinct from to_char(old_a.start_time,'HH24:MI')
      or candidate.elem->>'teacherId' is distinct from old_a.teacher_id
      or candidate.elem->>'roomId' is distinct from old_a.room_id
    );
  if v_locked_changed>0 then
    raise exception 'LOCKED_SESSION_PLACEMENT_CHANGED: % effective locked placement(s) changed',v_locked_changed;
  end if;

  v_result := public.adopt_solver_candidate_v33_pre_v45(
    p_studio_id,
    p_actor_user_id,
    p_actor_label,
    p_reason,
    p_expected_schedule_version,
    p_expected_rulebook_version,
    p_expected_enforcement_version,
    p_expected_planning_dataset_version,
    p_expected_constraint_model_version,
    p_candidate,
    p_application_validation
  );
  v_new_id := (v_result->>'scheduleId')::uuid;

  -- The historical writer already carries session locks from class_sessions.
  -- Reapply current assignment-only locks so the OR precedence survives adoption.
  update public.assignments new_a
  set locked=true
  from public.assignments old_a
  where new_a.schedule_version_id=v_new_id
    and old_a.schedule_version_id=v_current_schedule.id
    and old_a.session_id=new_a.session_id
    and old_a.locked=true
    and new_a.locked is distinct from true;
  get diagnostics v_preserved_assignment_locks = row_count;

  if exists (
    select 1
    from public.class_sessions s
    join public.class_definitions c
      on c.studio_id=s.studio_id and c.id=s.class_id and c.archived_at is null
    left join public.assignments old_a
      on old_a.schedule_version_id=v_current_schedule.id and old_a.session_id=s.id
    left join public.assignments new_a
      on new_a.schedule_version_id=v_new_id and new_a.session_id=s.id
    where s.studio_id=p_studio_id
      and s.archived_at is null
      and (s.locked=true or coalesce(old_a.locked,false)=true)
      and coalesce(new_a.locked,false) is distinct from true
  ) then
    raise exception 'LOCKED_SESSION_PERSISTENCE_FAILED: effective lock was lost during adoption';
  end if;

  update public.audit_events
  set payload=coalesce(payload,'{}'::jsonb) || jsonb_build_object(
    'runtimeLockPrecedence','SESSION_OR_ASSIGNMENT',
    'preservedAssignmentLocks',v_preserved_assignment_locks
  )
  where studio_id=p_studio_id
    and action='SOLVER_CANDIDATE_ADOPTED'
    and entity_id=v_new_id::text;

  return v_result || jsonb_build_object(
    'runtimeLockPrecedence','SESSION_OR_ASSIGNMENT',
    'preservedAssignmentLocks',v_preserved_assignment_locks
  );
end
$function$;

revoke all on function public.adopt_solver_candidate_v33(
  uuid,uuid,text,text,integer,integer,integer,integer,integer,jsonb,jsonb
) from public,anon,authenticated;
grant execute on function public.adopt_solver_candidate_v33(
  uuid,uuid,text,text,integer,integer,integer,integer,integer,jsonb,jsonb
) to service_role;
'''
    write("supabase/migrations/20260907090000_session_specific_solver_locks_v45.sql", sql)


def apply_db_harness() -> None:
    path = "scripts/test-db.mjs"
    text = read(path)
    marker = "function psql(container, user, sql, label) {\n"
    sql_block = r'''const sessionSpecificLockAdoptionSql = String.raw`
set search_path=public,extensions;

do $block$
declare
  v_studio uuid := '11111111-1111-4111-8111-111111111111';
  v_owner uuid := '10000000-0000-4000-8000-000000000001';
  v_schedule public.schedule_versions%rowtype;
  v_context jsonb;
  v_candidate jsonb;
  v_moved jsonb;
  v_result jsonb;
  v_before_count integer;
  v_after_count integer;
  v_rejected boolean := false;
begin
  select * into v_schedule from public.schedule_versions where studio_id=v_studio and is_current;
  update public.assignments
  set locked=true
  where schedule_version_id=v_schedule.id and session_id='t04-session';
  if not found then raise exception 'T09 fixture has no current t04 assignment to lock'; end if;
  if exists(select 1 from public.class_sessions where id='t04-session' and locked=true) then
    raise exception 'T09 fixture requires an assignment-only lock to prove OR precedence';
  end if;

  select jsonb_build_array(jsonb_build_object(
    'sessionId',a.session_id,
    'day',a.day,
    'startTime',to_char(a.start_time,'HH24:MI'),
    'endTime',to_char(a.end_time,'HH24:MI'),
    'teacherId',a.teacher_id,
    'roomId',a.room_id
  )) into v_candidate
  from public.assignments a
  where a.schedule_version_id=v_schedule.id and a.session_id='t04-session';

  v_context := private.build_solver_candidate_context_v44(v_studio);
  v_result := public.adopt_solver_candidate_v44(
    v_studio,v_owner,'T09 integration actor','Preserve assignment-only runtime lock',
    v_context,v_candidate,'{"valid":true,"hardViolations":0}'::jsonb
  );

  if v_result->>'runtimeLockPrecedence' is distinct from 'SESSION_OR_ASSIGNMENT' then
    raise exception 'T09 canonical adoption did not report effective lock precedence';
  end if;
  if not exists (
    select 1 from public.assignments a
    join public.schedule_versions sv on sv.id=a.schedule_version_id
    where sv.studio_id=v_studio and sv.is_current and a.session_id='t04-session' and a.locked=true
  ) then
    raise exception 'T09 assignment-only lock was lost during adoption';
  end if;
  if exists(select 1 from public.class_sessions where id='t04-session' and locked=true) then
    raise exception 'T09 adoption incorrectly converted assignment-only lock into planning-session lock';
  end if;

  select * into v_schedule from public.schedule_versions where studio_id=v_studio and is_current;
  v_context := private.build_solver_candidate_context_v44(v_studio);
  select jsonb_build_array(jsonb_build_object(
    'sessionId',a.session_id,
    'day',a.day,
    'startTime',to_char(a.start_time + interval '15 minutes','HH24:MI'),
    'endTime',to_char(a.end_time + interval '15 minutes','HH24:MI'),
    'teacherId',a.teacher_id,
    'roomId',a.room_id
  )) into v_moved
  from public.assignments a
  where a.schedule_version_id=v_schedule.id and a.session_id='t04-session';

  select count(*) into v_before_count from public.schedule_versions where studio_id=v_studio;
  begin
    perform public.adopt_solver_candidate_v44(
      v_studio,v_owner,'T09 integration actor','Reject movement of assignment-only runtime lock',
      v_context,v_moved,'{"valid":true,"hardViolations":0}'::jsonb
    );
  exception when others then
    if position('LOCKED_SESSION_PLACEMENT_CHANGED' in sqlerrm)=0 then raise; end if;
    v_rejected:=true;
  end;
  if not v_rejected then raise exception 'T09 moved assignment-only lock was accepted'; end if;
  select count(*) into v_after_count from public.schedule_versions where studio_id=v_studio;
  if v_after_count<>v_before_count then raise exception 'T09 locked-placement rejection was not atomic'; end if;
end
$block$;

select 'T09 PASS: assignment OR session lock precedence survives reviewed adoption; assignment-only lock persists and movement rejects atomically' as result;
`;

'''
    text = replace_once(text, marker, sql_block + marker, "insert T09 DB lifecycle")
    call_marker = "    const candidateStaleOutput = psql(container, 'postgres', candidateStaleBindingSql, 'T08 candidate stale-schedule binding integration tests');\n    process.stdout.write(candidateStaleOutput);\n"
    text = replace_once(
        text,
        call_marker,
        call_marker + "    const sessionLockOutput = psql(container, 'postgres', sessionSpecificLockAdoptionSql, 'T09 session-specific lock adoption integration tests');\n    process.stdout.write(sessionLockOutput);\n",
        "run T09 DB lifecycle",
    )
    write(path, text)


def apply_all() -> None:
    apply_solver_problem()
    apply_feasibility()
    apply_service()
    apply_fixture()
    apply_ts_tests()
    apply_python_tests()
    apply_migration()
    apply_db_harness()


def section(text: str, start: str, end: str) -> tuple[str, str, str]:
    start_i = text.index(start)
    end_i = text.index(end, start_i)
    return text[:start_i], text[start_i:end_i], text[end_i:]


def finalize(code_sha: str, run_id: str) -> None:
    readme = read("plans/README.md")
    readme = replace_once(readme, '- Current task: **T09 — session-specific solver locks**.\n', '- Current task: **T10 — manual MOVE through authoritative IR**.\n', "README current task")
    readme = replace_once(readme, '- Next task: T10 after T09 acceptance.\n', '- Next task: T11 after T10 acceptance.\n', "README next task")
    old_progress = '- Implementation progress: T01 through T08 have verified DONE evidence. T08 now binds every reviewed FEASIBLE candidate to the exact coherent base ScheduleVersion and schedule/lock fingerprint, rejects stale/concurrent/double adoption, and preserves the stale reviewed candidate in the UI with regenerate/re-review guidance. T09 is READY; T10 remains NOT_STARTED pending T09.\n'
    new_progress = '- Implementation progress: T01 through T09 have verified DONE evidence. T09 now binds runtime locks directly to stable session IDs, supports one locked meeting inside a multi-session class, uses SESSION OR ASSIGNMENT lock precedence through solve/validation/adoption, and returns deterministic runtime-lock conflict IDs. T10 is READY; T11 remains NOT_STARTED pending T10.\n'
    readme = replace_once(readme, old_progress, new_progress, "README progress")
    readme = readme.replace('- T09: session-specific solver locks.\n', '- T10: manual MOVE through authoritative IR.\n')
    write("plans/README.md", readme)

    next_md = read("plans/NEXT.md")
    next_md = replace_once(next_md, 'Current Task: T09\nNext Task: T10\n', 'Current Task: T10\nNext Task: T11\n', "NEXT task pointers")
    next_md = next_md.replace('T08 is DONE. T09 is the next executable task; T10 remains pending T09.', 'T09 is DONE. T10 is the next executable task; T11 remains pending T10.')
    write("plans/NEXT.md", next_md)

    tasks = read("plans/TASKS.md")
    tasks = replace_once(tasks, '| [T09](#t09) | Session-specific solver locks | READY |', '| [T09](#t09) | Session-specific solver locks | DONE |', "T09 status index")
    tasks = replace_once(tasks, '| [T10](#t10) | Manual MOVE through authoritative IR | NOT_STARTED |', '| [T10](#t10) | Manual MOVE through authoritative IR | READY |', "T10 status index")

    before, t09, after = section(tasks, '<a id="t09"></a>', '<a id="t10"></a>')
    t09 = replace_once(t09, '| Status | READY |', '| Status | DONE |', "T09 detailed status")
    t09 = t09.replace('- [ ] One selected session of a multi-session activity preserves day/start/teacher/room while other meetings remain movable.', '- [x] One selected session of a multi-session activity preserves day/start/teacher/room while other meetings remain movable.')
    t09 = t09.replace('- [ ] Runtime locks bind stable session IDs and preserve canonical duration.', '- [x] Runtime locks bind stable session IDs and preserve canonical duration.')
    t09 = t09.replace('- [ ] Assignment/session lock precedence is explicit; locked placements cannot be lost at preparation, solve, validation, or adoption.', '- [x] Assignment/session lock precedence is explicit; locked placements cannot be lost at preparation, solve, validation, or adoption.')
    t09 = t09.replace('- [ ] Missing, stale, conflicting, and impossible locks fail with deterministic explanations.', '- [x] Missing, stale, conflicting, and impossible locks fail with deterministic explanations.')
    completion = f'''Task/child: T09\n\nStarting HEAD: `ccd51862a5bc4e981f93ce9c64c35fec837df8a8` on `feat/pre-cami-hardening` (T01–T08 accepted).\n\nImplementation commit: `{code_sha}` (`feat: make solver locks session-specific`).\n\nImplemented outcome:\n- TypeScript preparation now defines effective runtime lock precedence as `SESSION OR ASSIGNMENT`. Either representation protects the exact current placement; a false value on one side cannot cancel a true lock on the other. Active archived-out sessions remain historical rather than current lock obligations.\n- Multi-session classes are no longer rejected merely because one meeting is locked. Solver payloads carry the exact locked `sessionId` and canonical current placement, while sibling sessions remain independently variable.\n- CP-SAT applies runtime locks directly to the selected session variables for day/start/teacher/room. Runtime locks are not converted into class-name `FIXED_ASSIGNMENT` policy nodes; policy-fixed assignments remain separate constraints. Diagnostic solves name runtime assumptions as `runtime-lock:<sessionId>`, so a policy/runtime conflict can report both stable IDs.\n- Canonical duration remains derived from the pinned session override/class duration. Preparation rejects an inconsistent locked current end time rather than silently changing the lock, and solver output derives the locked end from that canonical duration.\n- Candidate validation independently rejects movement of the exact locked session and preserves the effective lock marker only for locked meetings.\n- V4.5 wraps the canonical V3.3 adoption writer. The pre-V4.5 implementation is renamed and removed from the service-role surface; the canonical name now protects `session.locked OR current_assignment.locked`, invokes the historical validated writer, and carries assignment-only locks into the newly adopted ScheduleVersion. T08's reviewed-context V4.4 RPC automatically resolves the wrapped canonical V3.3 function, so no fresh-version substitution was introduced.\n- Shared serialized fixture `tests/fixtures/session-lock-semantics.json` is consumed by TypeScript and Python regressions. It covers a 75-minute locked first meeting of a two-meeting class and an independently movable sibling.\n\nAcceptance criterion → evidence:\n- Multi-session exact meeting: the shared fixture and Python service/CP-SAT tests preserve `multi-session-1` at Monday 18:30 with its teacher/room while the sibling meeting remains movable and non-overlapping.\n- Stable ID + duration: runtime CP-SAT constraints attach to `session['id']`; the fixture's 75-minute override returns 18:30–19:45.\n- Precedence through adoption: TypeScript regressions prove assignment-lock and session-lock OR semantics; the disposable PostgreSQL lifecycle sets an assignment-only lock while `class_sessions.locked=false`, adopts an unchanged reviewed candidate, proves the new assignment remains locked, then proves movement rejects atomically.\n- Deterministic failures: TypeScript returns `LOCKED_SESSION_PLACEMENT_UNRESOLVED`, `LOCKED_SESSION_PLACEMENT_STALE`, and `LOCKED_SESSION_DURATION_MISMATCH`; Python reports `runtime-lock:<sessionId>` for impossible locks and reports both runtime and policy-fixed IDs for a direct conflict.\n\nVerification evidence: GitHub Actions run `{run_id}` passed the required T09 quality matrix. Ubuntu and Windows passed `npm run lint`, `npm run typecheck`, `npm test`, and `npm run build`; Ubuntu additionally passed `npm run test:db` through V4.5 and `python -m pytest -q` in a disposable solver virtual environment. The DB harness emitted the T09 PASS lifecycle for assignment/session lock precedence and atomic movement rejection.\n\nRisks/limitations: no production or staging database was read or mutated, and V4.5 remains a forward migration pending separately authorized deployment. T09 does not redesign lock authoring UI or all schedule mutation commands; T10–T13 still own canonical manual-command authority and legacy-write closure. Policy `FIXED_ASSIGNMENT` remains class-selector based by design and is separate from runtime session locks.\n\nDecision deviations: none. No general locking service or new infrastructure tier was introduced.\n\nNew blockers and unblock condition: none.\n\nResulting task status: DONE.\n\nNewly READY tasks: T10. T11 remains NOT_STARTED pending T10.\n'''
    t09 = replace_once(t09, 'Not yet verified. Record commit SHA, exact commands/exit codes, environment, regression cases, artifact links, manager acceptance where required, and remaining limitations. No implementation task was marked DONE during plan creation.\n', completion, "T09 completion evidence")
    t09 = t09.replace('Waiting for dependency acceptance: T07, T08. This is normal sequencing, not a BLOCKED status.', 'Dependencies T07 and T08 were verified DONE before execution. T09 is accepted with no remaining task-specific blocker; T10 is READY.')
    tasks = before + t09 + after

    before, t10, after = section(tasks, '<a id="t10"></a>', '<a id="t11"></a>')
    t10 = replace_once(t10, '| Status | NOT_STARTED |', '| Status | READY |', "T10 detailed status")
    t10 = t10.replace('Waiting for dependency acceptance: T03, T04, T05, T06, T07, T08, T09. This is normal sequencing, not a BLOCKED status.', 'Dependencies T03 through T09 are verified DONE. T10 is READY and is now the first executable unfinished task.')
    tasks = before + t10 + after
    write("plans/TASKS.md", tasks)

    release = read("plans/DWDE_RELEASE_PLAN.md")
    release = replace_once(
        release,
        '| A07 | Individual multi-session meetings can be locked; locks survive all workflows | T09 | Shared lock fixtures, impossible-lock result, adoption evidence |',
        '| A07 | Individual multi-session meetings can be locked; locks survive all workflows | T09 | T09 verified shared stable-session lock fixture, deterministic impossible/conflict diagnostics, candidate validation, and assignment/session OR lock preservation through transactional adoption |',
        "A07 evidence",
    )
    write("plans/DWDE_RELEASE_PLAN.md", release)


if __name__ == "__main__":
    mode = sys.argv[1] if len(sys.argv) > 1 else "apply"
    if mode == "apply":
        apply_all()
    elif mode == "finalize":
        if len(sys.argv) != 4:
            raise SystemExit("usage: t09-apply.py finalize <code_sha> <run_id>")
        finalize(sys.argv[2], sys.argv[3])
    else:
        raise SystemExit(f"unknown mode: {mode}")
