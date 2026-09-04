from __future__ import annotations

import copy
import hmac
import os
from typing import Any

from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel, ConfigDict, Field

from dwde_solver.feasibility import solve_feasibility

SERVICE_VERSION = "1.0"
MAX_SOLVE_SECONDS = 30.0
VALID_DAYS = {"Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"}


class SolveRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    problem: dict[str, Any]
    maxSeconds: float = Field(default=5.0, gt=0, le=MAX_SOLVE_SECONDS)


class HealthResponse(BaseModel):
    status: str
    serviceVersion: str
    authConfigured: bool


app = FastAPI(
    title="DWDE CP-SAT Feasibility Service",
    version=SERVICE_VERSION,
    docs_url=None,
    redoc_url=None,
    openapi_url=None,
)


def _configured_token() -> str | None:
    value = os.getenv("SOLVER_INTERNAL_TOKEN", "").strip()
    return value or None


def _authorize(authorization: str | None) -> None:
    expected = _configured_token()
    if expected is None:
        raise HTTPException(status_code=503, detail="Solver service authentication is not configured")
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing solver service credential")
    supplied = authorization.removeprefix("Bearer ").strip()
    if not supplied or not hmac.compare_digest(supplied, expected):
        raise HTTPException(status_code=403, detail="Invalid solver service credential")


def _validate_problem_contract(problem: dict[str, Any]) -> dict[str, Any]:
    if problem.get("contractVersion") != "1.0":
        raise HTTPException(status_code=422, detail="Unsupported solver problem contractVersion")

    context = problem.get("context")
    if not isinstance(context, dict):
        raise HTTPException(status_code=422, detail="Solver problem context is required")
    required_context = ("studioId", "rulebookVersion", "planningDatasetVersion", "compilerVersion")
    missing_context = [key for key in required_context if context.get(key) in (None, "")]
    if missing_context:
        raise HTTPException(status_code=422, detail=f"Solver problem context missing: {', '.join(missing_context)}")

    for collection in ("teachers", "rooms", "students", "classes", "sessions"):
        if not isinstance(problem.get(collection), list):
            raise HTTPException(status_code=422, detail=f"Solver problem {collection} must be an array")

    constraint_model = problem.get("constraintModel")
    if not isinstance(constraint_model, dict):
        raise HTTPException(status_code=422, detail="constraintModel is required")
    if constraint_model.get("rulebookVersion") != context.get("rulebookVersion"):
        raise HTTPException(status_code=422, detail="Constraint Model Rulebook version does not match solver context")
    if constraint_model.get("planningDatasetVersion") != context.get("planningDatasetVersion"):
        raise HTTPException(status_code=422, detail="Constraint Model Planning Dataset version does not match solver context")
    if constraint_model.get("compilerVersion") != context.get("compilerVersion"):
        raise HTTPException(status_code=422, detail="Constraint Model compiler version does not match solver context")
    if constraint_model.get("completeHardConstraintCompilation") is not True:
        raise HTTPException(status_code=422, detail="Incomplete Constraint Model may not be solved")
    if constraint_model.get("uncompiledConstraintRuleIds") not in ([], None):
        raise HTTPException(status_code=422, detail="Constraint Model contains uncompiled constraint rules")

    preflight = problem.get("preflight")
    if not isinstance(preflight, dict) or not isinstance(preflight.get("validatedDelegatedConstraintIds"), list):
        raise HTTPException(status_code=422, detail="Delegated preflight proof is required")

    return context


def _normalized_name(value: Any) -> str:
    return "".join(character for character in str(value).lower() if character.isalnum())


def _problem_with_runtime_locks(problem: dict[str, Any]) -> dict[str, Any]:
    locked_sessions = [session for session in problem.get("sessions", []) if session.get("locked") is True]
    if not locked_sessions:
        return problem

    classes = {item.get("id"): item for item in problem.get("classes", [])}
    teachers = {item.get("id"): item for item in problem.get("teachers", [])}
    rooms = {item.get("id"): item for item in problem.get("rooms", [])}
    session_count_by_class: dict[str, int] = {}
    for session in problem.get("sessions", []):
        class_id = str(session.get("classId", ""))
        session_count_by_class[class_id] = session_count_by_class.get(class_id, 0) + 1

    patched = copy.deepcopy(problem)
    hard_constraints = patched["constraintModel"]["hardConstraints"]

    for session in locked_sessions:
        session_id = str(session.get("id", ""))
        class_id = str(session.get("classId", ""))
        klass = classes.get(class_id)
        placement = session.get("lockedPlacement")
        if not session_id or not klass or not isinstance(placement, dict):
            raise HTTPException(status_code=422, detail=f"Locked session {session_id or '<missing>'} has no canonical placement")
        if session_count_by_class.get(class_id) != 1:
            raise HTTPException(
                status_code=422,
                detail=f"Locked session {session_id} belongs to a multi-session class; ordinal-specific runtime locks are not supported yet",
            )

        day = str(placement.get("day", ""))
        start = str(placement.get("startTime", ""))
        teacher_id = str(placement.get("teacherId", ""))
        room_id = str(placement.get("roomId", ""))
        teacher = teachers.get(teacher_id)
        room = rooms.get(room_id)
        if day not in VALID_DAYS or not start or not teacher or not room:
            raise HTTPException(status_code=422, detail=f"Locked session {session_id} has an invalid canonical placement")

        class_name = str(klass.get("name", ""))
        same_name_classes = [item for item in classes.values() if _normalized_name(item.get("name")) == _normalized_name(class_name)]
        if not class_name or len(same_name_classes) != 1:
            raise HTTPException(status_code=422, detail=f"Locked session {session_id} class name is not uniquely resolvable")

        hard_constraints.append(
            {
                "id": f"runtime-lock:{session_id}",
                "kind": "FIXED_ASSIGNMENT",
                "ruleIds": [],
                "selector": {
                    "classNames": [class_name],
                    "teacherNames": [str(teacher.get("name", ""))],
                    "roomNames": [str(room.get("name", ""))],
                },
                "parameters": {"day": day, "start": start},
                "explanation": f"Preserve current placement for locked session {session_id}",
            }
        )

    return patched


@app.get("/healthz", response_model=HealthResponse)
def health() -> HealthResponse:
    return HealthResponse(status="ok", serviceVersion=SERVICE_VERSION, authConfigured=_configured_token() is not None)


@app.post("/v1/feasibility")
def feasibility(request: SolveRequest, authorization: str | None = Header(default=None)) -> dict[str, Any]:
    _authorize(authorization)
    context = _validate_problem_contract(request.problem)
    solver_problem = _problem_with_runtime_locks(request.problem)

    try:
        result = solve_feasibility(solver_problem, max_seconds=request.maxSeconds)
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error

    return {
        "serviceVersion": SERVICE_VERSION,
        "context": context,
        "result": result,
    }
