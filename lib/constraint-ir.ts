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
  | "REQUIRED_LOWER_LEVEL"
  | "TEACHER_SUBJECT_DOMAIN"
  | "TEACHER_DAY_WINDOW"
  | "STUDIO_OPERATING_WINDOWS"
  | "ROOM_UNAVAILABLE_WINDOWS"
  | "TEACHER_CLASS_DOMAIN"
  | "ROOM_REQUIRED_FEATURES"
  | "DIRECTLY_AFTER"
  | "FIXED_ASSIGNMENT"
  | "ROOM_CAPACITY"
  | "RELATIONSHIP_START_WINDOW";

export interface ConstraintSelectorIR {
  /** Stable-ID class targets for typed policy. */
  classIds?: string[];
  classNames?: string[];
  subjects?: string[];
  levels?: string[];
  /** Stable-ID target for typed teacher policy. Legacy static policy may still use teacherNames during transition. */
  teacherIds?: string[];
  teacherNames?: string[];
  /** Stable-ID room targets for typed policy. */
  roomIds?: string[];
  roomNames?: string[];
  studentNames?: string[];
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
