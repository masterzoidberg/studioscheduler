import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const card = readFileSync("components/solver-feasibility-card.tsx", "utf8");
const outcome = readFileSync("lib/solver-outcome.ts", "utf8");

describe("UX-01 solver journey", () => {
  it("exposes a bounded Build schedule flow with safe cancellation", () => {
    expect(card).toContain("Setup review → schedule");
    expect(card).toContain("Build schedule");
    expect(card).toContain("Check current Setup");
    expect(card).toContain("Build a candidate");
    expect(card).toContain("Validate the proposal");
    expect(card).toContain("new AbortController()");
    expect(card).toContain("solveRequestId.current");
    expect(card).toContain("requestId !== solveRequestId.current");
    expect(card).toContain("solveAbortController.current?.abort()");
    expect(card).toContain("Cancel");
  });

  it("keeps raw gateway context and solver details behind Advanced diagnostics", () => {
    expect(card).toContain("Advanced diagnostics");
    expect(card).toContain("Candidate context");
    expect(card).toContain("Raw blocker codes");
    expect(card).toContain("outcome?.message");
    expect(card).toContain("Review requirements");
    expect(outcome).toContain("Review locks");
  });

  it("keeps candidate review and adoption guarded by the current context", () => {
    expect(card).toContain("candidateContext");
    expect(card).toContain("candidateIsStale");
    expect(card).toContain("reviewAcknowledged");
    expect(card).toContain("Schedule created");
    expect(card).toContain("Adopt reviewed candidate");
    expect(card).toContain('fetch("/api/solver/adopt"');
  });
});
