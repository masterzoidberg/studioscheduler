export type ConstraintIRKind =
  | "RESOURCE_NO_OVERLAP"
  | "TIME_GRID"
  | "DAY_TIME_WINDOW"
  | "NO_DAY"
  | "MAX_GAP"
  | "MAX_WORKDAYS"
  | "LATEST_FINISH_BY_LEVEL"
  | "MAX_ATTENDANCE_DAYS"
  | "REQUIRED_ROOM"
  | "REQUIRED_TEACHER"
  | "TEACHER_SUBJECT_DOMAIN"
  | "TEACHER_DAY_WINDOW"
  | "DIRECTLY_AFTER"
  | "FIXED_ASSIGNMENT"
  | "ROOM_CAPACITY"
  | "RELATIONSHIP_START_WINDOW";

export interface ConstraintSelectorIR {
  classNames?: string[];
  subjects?: string[];
  levels?: string[];
  teacherNames?: string[];
  roomNames?: string[];
  studentRelation?: string;
}

export interface ConstraintIRNode {
  id: string;
  kind: ConstraintIRKind;
  ruleIds: string[];
  selector: ConstraintSelectorIR;
  parameters: Record<string, unknown>;
  explanation: string;
}

export interface ObjectivePriorityIR {
  ruleId: string;
  rank: number;
  title: string;
  description: string;
}

export interface GovernanceAssertionIR {
  ruleId: string;
  family: string;
  assertion: string;
}

export interface ConstraintModelSnapshotV1 {
  schemaVersion: "1.0";
  compilerVersion: string;
  rulebookVersion: number;
  planningDatasetVersion: number | null;
  activeRuleCount: number;
  hardConstraints: ConstraintIRNode[];
  objectivePrioritySpine: ObjectivePriorityIR[];
  readinessRuleIds: string[];
  governanceAssertions: GovernanceAssertionIR[];
  uncompiledConstraintRuleIds: string[];
  completeHardConstraintCompilation: boolean;
}
