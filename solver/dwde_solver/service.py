from __future__ import annotations

import hmac
import os
from typing import Any

from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel, ConfigDict, Field

from dwde_solver.feasibility import solve_feasibility

SERVICE_VERSION = "1.0"
MAX_SOLVE_SECONDS = 30.0


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


@app.get("/healthz", response_model=HealthResponse)
def health() -> HealthResponse:
    return HealthResponse(status="ok", serviceVersion=SERVICE_VERSION, authConfigured=_configured_token() is not None)


@app.post("/v1/feasibility")
def feasibility(request: SolveRequest, authorization: str | None = Header(default=None)) -> dict[str, Any]:
    _authorize(authorization)
    context = _validate_problem_contract(request.problem)

    try:
        result = solve_feasibility(request.problem, max_seconds=request.maxSeconds)
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error

    return {
        "serviceVersion": SERVICE_VERSION,
        "context": context,
        "result": result,
    }
