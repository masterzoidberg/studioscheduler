import type { StudioRule } from "@/lib/domain";

export type RuleExecutionDisposition =
  | "HARD_CONSTRAINT"
  | "HARD_DATA_PRECONDITION"
  | "FIXED_ANCHOR"
  | "SOFT_OBJECTIVE"
  | "DATA_FACT"
  | "EXCEPTION"
  | "INFORMATIONAL"
  | "NO_RUNTIME_EFFECT";

export type RuleExecutionFamily =
  | "ADVANCED_PROGRESSION"
  | "TEACHER_POLICY"
  | "CLASS_STRUCTURE"
  | "CURRICULUM_INTEGRITY"
  | "DATA_GOVERNANCE"
  | "FIXED_ASSIGNMENT"
  | "FRIDAY_POLICY"
  | "STUDIO_OPERATIONS"
  | "OPTIMIZATION_PRIORITY"
  | "ROOM_POLICY"
  | "SEQUENCING"
  | "DANCER_POLICY"
  | "REVIEW_RESOLUTION";

export interface RuleExecutionEntry {
  ruleId: string;
  disposition: RuleExecutionDisposition;
  family: RuleExecutionFamily;
  runtimeLayer: "READY_GATE" | "CONSTRAINT_IR" | "OBJECTIVE_IR" | "DATASET" | "GOVERNANCE" | "HUMAN_REVIEW";
  rationale: string;
}

const HARD_DATA_PRECONDITION = [
  "BAL-001", "BAL-002", "BAL-003", "BAL-004", "BAL-005", "BAL-006", "BAL-007",
  "BAL-008", "BAL-009", "BAL-010", "BAL-011", "BAL-012", "BAL-013", "BAL-014",
  "CUR-001", "CUR-002", "CUR-003", "CUR-004", "CUR-005", "CUR-006",
  "STU-002", "REV-001",
] as const;

const FIXED_ANCHOR = [
  "DEN-002", "DEN-003", "DEN-004", "DEN-005", "FIX-001", "FIX-002", "FIX-004",
] as const;

const EXCEPTION = [
  "ADV-003", "ADV-004", "FRI-002", "KAR-002", "OPS-004", "ROOM-008", "SEQ-004",
  "STU-020", "STU-021",
] as const;

const DATA_FACT = [
  "ADV-002", "KAR-008",
  "DATA-001", "DATA-002", "DATA-003", "DATA-004", "DATA-005", "DATA-006", "DATA-007",
  "ROOM-001", "ROOM-004", "ROOM-005", "ROOM-006",
] as const;

const INFORMATIONAL = ["REV-002"] as const;

const NO_RUNTIME_EFFECT = [
  "CUR-007", "DATA-008", "FIX-003", "JAE-003", "KAR-010", "OPS-011", "OPS-012", "OPS-016",
  "SEQ-009", "STU-001", "STU-004", "STU-022",
] as const;

const SOFT_OBJECTIVE = [
  "AIM-002", "AIM-004", "AIM-005", "AIM-007", "AIM-008", "AIM-009",
  "CAM-004", "CAM-005", "CAM-012", "CAM-013", "CAM-014", "CAM-015", "CAM-016",
  "CAM-017", "CAM-018", "CAM-019",
  "FRI-001",
  "KAR-005", "KAR-006", "KAR-007", "KAR-011", "KAR-012", "KAR-013", "KAR-014",
  "MEL-002", "MEL-003",
  "OPS-002", "OPS-015",
  "OPT-001", "OPT-002", "OPT-003", "OPT-004", "OPT-005", "OPT-006", "OPT-007",
  "OPT-008", "OPT-009",
  "ROOM-010", "ROOM-011", "ROOM-012", "ROOM-013", "ROOM-014",
  "STU-018", "SYD-003", "SYD-004",
] as const;

const HARD_CONSTRAINT = [
  "ADV-001",
  "AIM-001", "AIM-003", "AIM-006",
  "CAM-001", "CAM-002", "CAM-003", "CAM-006", "CAM-007", "CAM-008", "CAM-009",
  "CAM-010", "CAM-011",
  "CUR-008", "CUR-009",
  "DEN-001",
  "FRI-003",
  "JAE-001", "JAE-002",
  "JAL-001", "JAL-002", "JAL-003",
  "KAR-001", "KAR-003", "KAR-004", "KAR-009",
  "KHY-001", "KHY-002", "KHY-003",
  "MEL-001",
  "OPS-001", "OPS-003", "OPS-005", "OPS-006", "OPS-007", "OPS-008", "OPS-009",
  "OPS-010", "OPS-013", "OPS-014", "OPS-017",
  "ROOM-002", "ROOM-003", "ROOM-007", "ROOM-009",
  "SEQ-001", "SEQ-002", "SEQ-003", "SEQ-005", "SEQ-006", "SEQ-007", "SEQ-008",
  "STU-003", "STU-005", "STU-006", "STU-007", "STU-008", "STU-009", "STU-010",
  "STU-011", "STU-012", "STU-013", "STU-014", "STU-015", "STU-016", "STU-017",
  "STU-019",
  "SYD-001", "SYD-002",
] as const;

const compareCanonicalStrings = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

function familyFor(ruleId: string): RuleExecutionFamily {
  if (ruleId.startsWith("ADV-")) return "ADVANCED_PROGRESSION";
  if (ruleId.startsWith("BAL-")) return "CLASS_STRUCTURE";
  if (ruleId.startsWith("CUR-")) return "CURRICULUM_INTEGRITY";
  if (ruleId.startsWith("DATA-")) return "DATA_GOVERNANCE";
  if (ruleId.startsWith("DEN-") || ruleId.startsWith("FIX-")) return "FIXED_ASSIGNMENT";
  if (ruleId.startsWith("FRI-")) return "FRIDAY_POLICY";
  if (ruleId.startsWith("OPS-")) return "STUDIO_OPERATIONS";
  if (ruleId.startsWith("OPT-")) return "OPTIMIZATION_PRIORITY";
  if (ruleId.startsWith("REV-")) return "REVIEW_RESOLUTION";
  if (ruleId.startsWith("ROOM-")) return "ROOM_POLICY";
  if (ruleId.startsWith("SEQ-")) return "SEQUENCING";
  if (ruleId.startsWith("STU-")) return "DANCER_POLICY";
  return "TEACHER_POLICY";
}

function runtimeLayer(disposition: RuleExecutionDisposition): RuleExecutionEntry["runtimeLayer"] {
  if (disposition === "HARD_DATA_PRECONDITION") return "READY_GATE";
  if (disposition === "HARD_CONSTRAINT" || disposition === "FIXED_ANCHOR" || disposition === "EXCEPTION") return "CONSTRAINT_IR";
  if (disposition === "SOFT_OBJECTIVE") return "OBJECTIVE_IR";
  if (disposition === "DATA_FACT") return "DATASET";
  if (disposition === "INFORMATIONAL") return "HUMAN_REVIEW";
  return "GOVERNANCE";
}

function rationale(disposition: RuleExecutionDisposition) {
  switch (disposition) {
    case "HARD_CONSTRAINT": return "Deterministic legality rule to compile into the canonical constraint model.";
    case "HARD_DATA_PRECONDITION": return "Authoritative planning fact that must be structurally represented and verified before solving.";
    case "FIXED_ANCHOR": return "Human-reviewed placement/assignment anchor that becomes a fixed solver constraint.";
    case "SOFT_OBJECTIVE": return "Human-reviewed preference or priority that may rank feasible schedules but cannot legalize an infeasible one.";
    case "DATA_FACT": return "Canonical fact/provenance used by planning or presentation rather than an independent legality check.";
    case "EXCEPTION": return "Explicit modifier to another rule; compile as scoped exception semantics rather than a standalone prose check.";
    case "INFORMATIONAL": return "Human workflow/review instruction with no automatic schedule legality effect.";
    case "NO_RUNTIME_EFFECT": return "Explicit absence/safety statement that prevents invented constraints but creates no independent runtime check.";
  }
}

function entries(ids: readonly string[], disposition: RuleExecutionDisposition): RuleExecutionEntry[] {
  return ids.map((ruleId) => ({
    ruleId,
    disposition,
    family: familyFor(ruleId),
    runtimeLayer: runtimeLayer(disposition),
    rationale: rationale(disposition),
  }));
}

export const RULE_EXECUTION_REGISTRY: RuleExecutionEntry[] = [
  ...entries(HARD_CONSTRAINT, "HARD_CONSTRAINT"),
  ...entries(HARD_DATA_PRECONDITION, "HARD_DATA_PRECONDITION"),
  ...entries(FIXED_ANCHOR, "FIXED_ANCHOR"),
  ...entries(SOFT_OBJECTIVE, "SOFT_OBJECTIVE"),
  ...entries(DATA_FACT, "DATA_FACT"),
  ...entries(EXCEPTION, "EXCEPTION"),
  ...entries(INFORMATIONAL, "INFORMATIONAL"),
  ...entries(NO_RUNTIME_EFFECT, "NO_RUNTIME_EFFECT"),
].sort((a, b) => compareCanonicalStrings(a.ruleId, b.ruleId));

export const RULE_EXECUTION_BY_ID = new Map(RULE_EXECUTION_REGISTRY.map((entry) => [entry.ruleId, entry]));

export function ruleExecutionCoverage(rules: StudioRule[]) {
  const activeIds = new Set(rules.filter((rule) => rule.status === "ACTIVE").map((rule) => rule.id));
  const registryIds = new Set(RULE_EXECUTION_REGISTRY.map((entry) => entry.ruleId));
  const missingRuleIds = [...activeIds].filter((id) => !registryIds.has(id)).sort(compareCanonicalStrings);
  const unknownRuleIds = [...registryIds].filter((id) => !activeIds.has(id)).sort(compareCanonicalStrings);
  return {
    activeRules: activeIds.size,
    accountedRules: [...activeIds].filter((id) => registryIds.has(id)).length,
    missingRuleIds,
    unknownRuleIds,
    complete: missingRuleIds.length === 0 && unknownRuleIds.length === 0,
  };
}

export function executionDispositionForRule(ruleId: string) {
  return RULE_EXECUTION_BY_ID.get(ruleId)?.disposition ?? null;
}
