import { describe, expect, it } from "vitest";
import { safeSolverSupportBundle, solverFeasibilityDiagnostic } from "@/lib/solver-operations";

const requestId = "4c6d1ec2-7d8b-4d42-8f13-02ead226812c";

describe("solver operations diagnostics", () => {
  it("records correlation, outcome, timing, and a countable failure without request payloads", () => {
    const input = Object.assign({
      requestId,
      httpStatus: 503,
      durationMs: 21.4,
      code: "SOLVER_SERVICE_UNAVAILABLE",
    }, {
      solverStatus: "UNKNOWN",
      studentName: "Synthetic Private Student",
      authorization: "Bearer private-token",
      requestBody: { roster: ["Synthetic Private Student"] },
    });

    const event = solverFeasibilityDiagnostic(input);

    expect(event).toEqual({
      event: "solver_feasibility_request",
      requestId,
      httpStatus: 503,
      durationMs: 21,
      outcome: "UNAVAILABLE",
      failure: true,
      code: "SOLVER_SERVICE_UNAVAILABLE",
    });
    expect(JSON.stringify(event)).not.toContain("Synthetic Private Student");
    expect(JSON.stringify(event)).not.toContain("private-token");
  });

  it("keeps proven infeasibility distinct from service failure and labels timeouts", () => {
    expect(solverFeasibilityDiagnostic({ requestId, httpStatus: 200, durationMs: 8, solverStatus: "INFEASIBLE" }))
      .toMatchObject({ outcome: "INFEASIBLE", failure: false });
    expect(solverFeasibilityDiagnostic({ requestId, httpStatus: 504, durationMs: 1001, code: "SOLVER_SERVICE_TIMEOUT" }))
      .toMatchObject({
        event: "solver_feasibility_request",
        requestId,
        httpStatus: 504,
        durationMs: 1001,
        outcome: "TIMEOUT",
        failure: true,
        code: "SOLVER_SERVICE_TIMEOUT",
      });
  });

  it("exports only the safe reference fields for support", () => {
    const input = Object.assign({ requestId, code: "SOLVER_SERVICE_UNAVAILABLE", httpStatus: 503 }, {
      studentName: "Synthetic Private Student",
      assignments: [{ teacher: "Synthetic Teacher", room: "Private Room" }],
      requestBody: { roster: ["Synthetic Private Student"] },
    });

    const bundle = safeSolverSupportBundle(input);

    expect(bundle).toEqual({
      schemaVersion: "studio-scheduler/solver-support-v1",
      requestId,
      code: "SOLVER_SERVICE_UNAVAILABLE",
      httpStatus: 503,
    });
    expect(JSON.stringify(bundle)).not.toMatch(/Synthetic Private Student|Synthetic Teacher|Private Room|roster|assignment/i);
  });
});
