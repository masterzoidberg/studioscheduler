export type PlanningClassStructureRequirement = {
  ruleIds: string[];
  className: string;
  frequency: number;
  durations?: number[];
};

// Client-safe mirror of the verified Ballet/Pointe structure requirements used
// by schedule readiness. A parity test against BALLET_STRUCTURE_REQUIREMENTS
// prevents this small UI-facing definition from drifting from the validator.
export const PLANNING_CLASS_STRUCTURE_REQUIREMENTS: PlanningClassStructureRequirement[] = [
  { ruleIds: ["BAL-001"], className: "Elementary Ballet 1", frequency: 1, durations: [60] },
  { ruleIds: ["BAL-002"], className: "Elementary Ballet 2", frequency: 2, durations: [75, 75] },
  { ruleIds: ["BAL-003"], className: "Ballet 1", frequency: 2, durations: [90, 90] },
  { ruleIds: ["BAL-004"], className: "Ballet 2", frequency: 2, durations: [90, 90] },
  { ruleIds: ["BAL-005"], className: "Ballet 3", frequency: 2, durations: [90, 90] },
  { ruleIds: ["BAL-006"], className: "Ballet 4A", frequency: 1 },
  { ruleIds: ["BAL-006", "BAL-007", "BAL-010"], className: "Ballet 4A/4B", frequency: 1, durations: [90] },
  { ruleIds: ["BAL-007", "BAL-008", "BAL-009"], className: "Ballet 4B/5", frequency: 2, durations: [90, 105] },
  { ruleIds: ["BAL-008", "BAL-011"], className: "Ballet 5", frequency: 1, durations: [90] },
  { ruleIds: ["BAL-012"], className: "Pre-Pointe", frequency: 1, durations: [30] },
  { ruleIds: ["BAL-013"], className: "Pointe 1", frequency: 1, durations: [30] },
  { ruleIds: ["BAL-014"], className: "Pointe 2/3", frequency: 1, durations: [60] },
];
