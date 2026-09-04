import { describe, expect, it } from "vitest";
import { PLANNING_CLASS_STRUCTURE_REQUIREMENTS } from "@/lib/planning-class-structure";
import { BALLET_STRUCTURE_REQUIREMENTS } from "@/lib/schedule-readiness";

describe("planning class structure requirement parity", () => {
  it("keeps the lightweight repair definition identical to deterministic schedule readiness", () => {
    expect(PLANNING_CLASS_STRUCTURE_REQUIREMENTS).toEqual(BALLET_STRUCTURE_REQUIREMENTS);
  });
});
