export type RuleStrength = "HARD" | "VERY_STRONG" | "MODERATE" | "LIGHT" | "BASELINE";
export type RuleStatus = "ACTIVE" | "NEEDS_REVIEW" | "DISABLED" | "RETIRED";
export type VerificationStatus = "VERIFIED" | "NEEDS_REVIEW" | "UNVERIFIED";
export type Day = "Monday" | "Tuesday" | "Wednesday" | "Thursday" | "Friday" | "Saturday";

export type RuleType =
  | "REQUIRED_ROOM"
  | "PREFERRED_ROOM"
  | "TEACHER_QUALIFICATION"
  | "TEACHER_UNAVAILABLE"
  | "TEACHER_AVAILABLE_WINDOW"
  | "REQUIRED_TEACHER"
  | "PREFERRED_TEACHER"
  | "MAX_TEACHER_GAP"
  | "MAX_TEACHER_WORKDAYS"
  | "MAX_STUDENT_GAP"
  | "MAX_STUDENT_ATTENDANCE_DAYS"
  | "MIN_STUDENT_ATTENDANCE_DAYS"
  | "LATEST_FINISH"
  | "EARLIEST_START"
  | "DIRECTLY_AFTER"
  | "NO_OVERLAP"
  | "FIXED_ASSIGNMENT"
  | "ROOM_CAPACITY"
  | "ROOM_CAPACITY_EXCEPTION"
  | "REQUIRED_LOWER_LEVEL"
  | "NO_DAY"
  | "PREFERRED_DAY"
  | "AVOID_DAY"
  | "RELATIONSHIP_ARRIVAL_WINDOW";

export interface SourceInfo {
  type: "IMPORT" | "USER_EDIT" | "AI_PROPOSAL_APPROVED" | "SYSTEM_SEED";
  document?: string;
  version?: string;
  note?: string;
}

export interface RuleException {
  id: string;
  title: string;
  when: Record<string, unknown>;
  override: Record<string, unknown>;
}

export interface StudioRule {
  id: string;
  category: string;
  type: RuleType;
  title: string;
  description: string;
  strength: RuleStrength;
  status: RuleStatus;
  verificationStatus: VerificationStatus;
  affectedEntityIds: string[];
  parameters: Record<string, unknown>;
  exceptions?: RuleException[];
  source: SourceInfo;
  versionIntroduced: number;
  updatedAt: string;
}

export interface Teacher {
  id: string;
  name: string;
  subjects: string[];
  notes?: string;
}

export interface Room {
  id: string;
  name: string;
  capacity?: number;
  features?: string[];
}

export interface Student {
  id: string;
  name: string;
  level: string;
  cohortIds?: string[];
}

export interface Cohort {
  id: string;
  name: string;
  studentIds: string[];
}

export interface ClassDefinition {
  id: string;
  name: string;
  subject: string;
  level: string;
  durationMinutes: number;
  weeklyFrequency: number;
  rosterStudentIds: string[];
  eligibleTeacherIds: string[];
  companyOnly?: boolean;
}

export interface ClassSession {
  id: string;
  classId: string;
  ordinal: number;
  locked?: boolean;
}

export interface Assignment {
  id: string;
  sessionId: string;
  day: Day;
  startTime: string;
  endTime: string;
  teacherId: string;
  roomId: string;
  locked?: boolean;
  status?: "NORMAL" | "WARNING" | "AI_PROPOSED";
}

export interface RulebookVersion {
  id: string;
  version: number;
  name: string;
  createdAt: string;
  actor: string;
  reason: string;
  changedRuleIds: string[];
}

export interface ScheduleVersion {
  id: string;
  version: number;
  rulebookVersion: number;
  createdAt: string;
  actor: string;
  reason: string;
  assignments: Assignment[];
}

export interface RuleHistoryEntry {
  id: string;
  ruleId: string;
  rulebookVersion: number;
  changedAt: string;
  actor: string;
  reason: string;
  before: StudioRule | null;
  after: StudioRule | null;
  aiProposed?: boolean;
}

export interface ValidationViolation {
  constraintId: string;
  severity: RuleStrength;
  message: string;
  affectedEntityIds: string[];
  assignmentIds: string[];
  suggestedAction?: string;
}

export interface ValidationResult {
  valid: boolean;
  hardViolations: number;
  warnings: number;
  violations: ValidationViolation[];
}

export interface RulePatch {
  id: string;
  ruleId?: string;
  operation: "CREATE" | "UPDATE" | "RETIRE" | "DISABLE" | "ENABLE";
  changes: Partial<StudioRule>;
  reason: string;
  proposedBy: "USER" | "AI";
}

export interface SchedulePatch {
  id: string;
  operation: "MOVE" | "ASSIGN" | "UNASSIGN";
  assignmentId: string;
  changes: Partial<Assignment>;
  reason: string;
  proposedBy: "USER" | "AI";
}

export interface Scenario {
  id: string;
  name: string;
  baseRulebookVersion: number;
  baseScheduleVersion: number;
  rulePatches: RulePatch[];
  schedulePatches: SchedulePatch[];
  createdAt: string;
}

export interface AuditEvent {
  id: string;
  at: string;
  actor: string;
  action: string;
  entityType: string;
  entityId?: string;
  detail: string;
}

export interface StudioState {
  studioId: string;
  studioName: string;
  teachers: Teacher[];
  rooms: Room[];
  students: Student[];
  cohorts: Cohort[];
  classes: ClassDefinition[];
  sessions: ClassSession[];
  rules: StudioRule[];
  rulebookVersions: RulebookVersion[];
  ruleHistory: RuleHistoryEntry[];
  scheduleVersions: ScheduleVersion[];
  scenarios: Scenario[];
  auditEvents: AuditEvent[];
}

export interface CanonicalImportPackage {
  format_version: "1.0";
  rulebook: { id: string; name: string; version: number };
  entities: {
    teachers: Teacher[];
    rooms: Room[];
    classes: ClassDefinition[];
    students: Student[];
    cohorts: Cohort[];
    sessions?: ClassSession[];
  };
  rules: StudioRule[];
  assignments?: Assignment[];
}

export interface SchedulingEngine {
  solve(state: StudioState, options?: Record<string, unknown>): Promise<ScheduleVersion[]>;
}

export interface CurrentUser {
  id: string;
  displayName: string;
  role: "OWNER" | "EDITOR" | "VIEWER";
}

export interface AuthProvider {
  getCurrentUser(): Promise<CurrentUser | null>;
  signOut(): Promise<void>;
}
