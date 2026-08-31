import type { ValidationResult } from "@/lib/domain";

export type ScheduleRepairDecision =
  | { ok: true }
  | { ok: false; error: string };

/**
 * V2.2 schedule mutation invariant:
 * - a clean schedule may not gain a detected HARD violation;
 * - an already-invalid schedule may only accept a move that strictly lowers
 *   the detected HARD-violation count.
 *
 * The database independently enforces the same rule. This helper keeps client
 * previews and server behavior aligned without making the browser authoritative.
 */
export function scheduleRepairDecision(
  current: Pick<ValidationResult, "hardViolations">,
  proposed: Pick<ValidationResult, "hardViolations">,
): ScheduleRepairDecision {
  if (current.hardViolations === 0 && proposed.hardViolations > 0) {
    return { ok: false, error: "The proposed move creates a detected HARD violation." };
  }

  if (current.hardViolations > 0 && proposed.hardViolations >= current.hardViolations) {
    return {
      ok: false,
      error: `Repair mode: this schedule currently has ${current.hardViolations} HARD violation(s). A move must strictly reduce that count.`,
    };
  }

  return { ok: true };
}
