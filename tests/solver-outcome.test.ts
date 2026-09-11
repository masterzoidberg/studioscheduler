import { describe, expect, it } from "vitest";
import {
  cancelledSolverOutcome,
  presentSolverOutcome,
} from "@/lib/solver-outcome";

describe("solver outcome presentation", () => {
  it("turns a validated feasible result into a reviewable candidate", () => {
    const outcome = presentSolverOutcome({
      responseOk: true,
      payload: { status: "FEASIBLE", candidate: { assignments: [{ sessionId: "s1" }] } },
    });

    expect(outcome.kind).toBe("CANDIDATE");
    expect(outcome.title).toBe("Review a proposed schedule");
    expect(outcome.message).toContain("current schedule is unchanged");
  });

  it("treats a feasible response without a candidate as incomplete", () => {
    const outcome = presentSolverOutcome({
      responseOk: true,
      payload: { status: "FEASIBLE", candidate: null },
    });

    expect(outcome.kind).toBe("INCOMPLETE");
    expect(outcome.title).toBe("The proposed schedule is incomplete");
  });

  it("never labels proven infeasibility as a saved or promised schedule", () => {
    const outcome = presentSolverOutcome({
      responseOk: true,
      payload: { status: "INFEASIBLE" },
    });

    expect(outcome.kind).toBe("INFEASIBLE");
    expect(outcome.title).toBe("No complete schedule was proven");
    expect(outcome.message).toContain("current schedule is unchanged");
    expect(outcome.message).not.toMatch(/created|saved|adopted/i);
  });

  it("keeps unknown and timeout distinct from infeasible", () => {
    const unknown = presentSolverOutcome({
      responseOk: true,
      payload: { status: "UNKNOWN" },
    });
    const timeout = presentSolverOutcome({
      responseOk: false,
      httpStatus: 504,
      payload: { code: "SOLVER_SERVICE_TIMEOUT", error: "The internal solver service timed out." },
    });

    expect(unknown.kind).toBe("UNKNOWN");
    expect(timeout.kind).toBe("UNKNOWN");
    expect(timeout.title).toBe("We could not determine whether a schedule exists");
    expect(timeout.message).not.toMatch(/impossible|infeasible/i);
  });

  it("maps blocked, unsupported, stale, incomplete, and unavailable responses to actions", () => {
    expect(presentSolverOutcome({ responseOk: false, httpStatus: 409, payload: { status: "BLOCKED", code: "SOLVER_CONTEXT_CHANGED_RETRY" } })).toMatchObject({ kind: "STALE" });
    expect(presentSolverOutcome({ responseOk: false, httpStatus: 502, payload: { code: "SOLVER_CONTRACT_DRIFT" } })).toMatchObject({ kind: "UNSUPPORTED" });
    expect(presentSolverOutcome({ responseOk: false, httpStatus: 409, payload: { status: "BLOCKED", code: "SOLVER_GATEWAY_BLOCKED" } })).toMatchObject({ kind: "BLOCKED" });
    expect(presentSolverOutcome({ responseOk: false, httpStatus: 502, payload: { code: "SOLVER_CANDIDATE_REJECTED" } })).toMatchObject({ kind: "INCOMPLETE" });
    expect(presentSolverOutcome({ responseOk: false, httpStatus: 503, payload: { code: "SOLVER_SERVICE_NOT_CONFIGURED" } })).toMatchObject({ kind: "UNAVAILABLE" });
  });

  it("offers retry after a transport failure without creating a candidate", () => {
    const outcome = presentSolverOutcome({
      responseOk: false,
      transportError: "Failed to fetch",
    });

    expect(outcome).toMatchObject({ kind: "UNAVAILABLE", retryable: true });
    expect(outcome.message).toContain("current schedule is unchanged");
  });

  it("represents cancellation as a non-destructive terminal state", () => {
    expect(cancelledSolverOutcome()).toEqual(expect.objectContaining({
      kind: "CANCELLED",
      title: "Schedule build cancelled",
      retryable: true,
    }));
  });
});
