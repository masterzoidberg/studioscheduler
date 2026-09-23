const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CODE_PATTERN = /^SOLVER_[A-Z0-9_]{1,64}$/;
const RESULT_STATUSES = new Set(["FEASIBLE", "INFEASIBLE", "UNKNOWN", "BLOCKED"]);

export function solverFeasibilityDiagnostic(input: {
  requestId: string;
  httpStatus: number;
  durationMs: number;
  solverStatus?: unknown;
  code?: unknown;
}) {
  const httpStatus = Number.isInteger(input.httpStatus) && input.httpStatus >= 100 && input.httpStatus <= 599
    ? input.httpStatus
    : 500;
  const solverStatus = typeof input.solverStatus === "string" && RESULT_STATUSES.has(input.solverStatus)
    ? input.solverStatus
    : null;
  const code = typeof input.code === "string" && CODE_PATTERN.test(input.code) ? input.code : null;
  const outcome = httpStatus === 504
    ? "TIMEOUT"
    : httpStatus === 503
      ? "UNAVAILABLE"
    : httpStatus >= 500
      ? "ERROR"
      : solverStatus || (httpStatus === 409 ? "BLOCKED" : httpStatus < 400 ? "UNKNOWN" : "REJECTED");

  return {
    event: "solver_feasibility_request",
    requestId: UUID_PATTERN.test(input.requestId) ? input.requestId : null,
    httpStatus,
    durationMs: Number.isFinite(input.durationMs) && input.durationMs >= 0 ? Math.round(input.durationMs) : 0,
    outcome,
    failure: httpStatus >= 500,
    ...(code ? { code } : {}),
  } as const;
}

export function safeSolverSupportBundle(input: {
  requestId?: unknown;
  code?: unknown;
  httpStatus?: unknown;
}) {
  return {
    schemaVersion: "studio-scheduler/solver-support-v1",
    requestId: typeof input.requestId === "string" && UUID_PATTERN.test(input.requestId) ? input.requestId : null,
    code: typeof input.code === "string" && CODE_PATTERN.test(input.code) ? input.code : null,
    httpStatus: Number.isInteger(input.httpStatus) && Number(input.httpStatus) >= 100 && Number(input.httpStatus) <= 599
      ? Number(input.httpStatus)
      : null,
  } as const;
}
