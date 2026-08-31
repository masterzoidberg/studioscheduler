import { describe, expect, it } from "vitest";
import { validateCopilotProposal, type CopilotProposalContext } from "@/lib/copilot-contract";

const context: CopilotProposalContext = {
  ruleIds: new Set(["OPS-006"]),
  assignmentIds: new Set(["assignment-open", "assignment-locked"]),
  lockedAssignmentIds: new Set(["assignment-locked"]),
  teacherIds: new Set(["teacher-cami"]),
  roomIds: new Set(["room-studio-a"]),
  rulebookVersion: 2,
  scheduleVersion: 2,
};

describe("Copilot proposal contract", () => {
  it("accepts a governed rule update and binds it to canonical versions", () => {
    const result = validateCopilotProposal({
      kind: "RULE_PATCH",
      title: "Clarify Saturday close",
      patch: { id: "patch-ai-1", ruleId: "OPS-006", operation: "UPDATE", changes: { description: "Saturday closes at 3:00 PM." }, reason: "Clarify wording", proposedBy: "AI" },
    }, context);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.proposal.patch).toMatchObject({ baseRulebookVersion: 2, baseScheduleVersion: 2, proposedBy: "AI" });
  });

  it("rejects invalid stable IDs, duplicate CREATEs, and unsupported rule fields", () => {
    expect(validateCopilotProposal({ kind: "RULE_PATCH", patch: { operation: "UPDATE", ruleId: "bad-id", changes: {}, reason: "x", proposedBy: "AI" } }, context).ok).toBe(false);
    expect(validateCopilotProposal({ kind: "RULE_PATCH", patch: { operation: "CREATE", changes: { id: "OPS-006" }, reason: "x", proposedBy: "AI" } }, context).ok).toBe(false);
    expect(validateCopilotProposal({ kind: "RULE_PATCH", patch: { operation: "UPDATE", ruleId: "OPS-006", changes: { secretMutation: true }, reason: "x", proposedBy: "AI" } }, context).ok).toBe(false);
  });

  it("allows only MOVE proposals for existing unlocked assignments", () => {
    const valid = validateCopilotProposal({
      kind: "SCHEDULE_PATCH",
      patch: { id: "patch-ai-2", operation: "MOVE", assignmentId: "assignment-open", changes: { day: "Tuesday", startTime: "17:00", endTime: "18:00", teacherId: "teacher-cami", roomId: "room-studio-a" }, reason: "Move class", proposedBy: "AI" },
    }, context);
    expect(valid.ok).toBe(true);
    if (valid.ok) expect(valid.proposal.patch).toMatchObject({ baseRulebookVersion: 2, baseScheduleVersion: 2 });

    expect(validateCopilotProposal({ kind: "SCHEDULE_PATCH", patch: { operation: "ASSIGN", assignmentId: "assignment-open", changes: {}, reason: "x", proposedBy: "AI" } }, context).ok).toBe(false);
    expect(validateCopilotProposal({ kind: "SCHEDULE_PATCH", patch: { operation: "MOVE", assignmentId: "missing", changes: {}, reason: "x", proposedBy: "AI" } }, context).ok).toBe(false);
    expect(validateCopilotProposal({ kind: "SCHEDULE_PATCH", patch: { operation: "MOVE", assignmentId: "assignment-locked", changes: {}, reason: "x", proposedBy: "AI" } }, context).ok).toBe(false);
  });

  it("rejects unknown entities and malformed schedule values", () => {
    expect(validateCopilotProposal({ kind: "SCHEDULE_PATCH", patch: { operation: "MOVE", assignmentId: "assignment-open", changes: { teacherId: "teacher-missing" }, reason: "x", proposedBy: "AI" } }, context).ok).toBe(false);
    expect(validateCopilotProposal({ kind: "SCHEDULE_PATCH", patch: { operation: "MOVE", assignmentId: "assignment-open", changes: { roomId: "room-missing" }, reason: "x", proposedBy: "AI" } }, context).ok).toBe(false);
    expect(validateCopilotProposal({ kind: "SCHEDULE_PATCH", patch: { operation: "MOVE", assignmentId: "assignment-open", changes: { day: "Sunday" }, reason: "x", proposedBy: "AI" } }, context).ok).toBe(false);
    expect(validateCopilotProposal({ kind: "SCHEDULE_PATCH", patch: { operation: "MOVE", assignmentId: "assignment-open", changes: { startTime: "5pm" }, reason: "x", proposedBy: "AI" } }, context).ok).toBe(false);
  });
});
