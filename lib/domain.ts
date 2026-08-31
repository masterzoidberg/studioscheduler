export type RuleStrength = "HARD" | "VERY_STRONG" | "MODERATE" | "LIGHT" | "BASELINE";
export type RuleStatus = "ACTIVE" | "NEEDS_REVIEW" | "DISABLED" | "RETIRED";
export type VerificationStatus = "VERIFIED" | "NEEDS_REVIEW" | "UNVERIFIED";
export type EnforcementStatus = "IMPLEMENTED" | "PARTIAL" | "NOT_IMPLEMENTED" | "NOT_APPLICABLE";
export type Day = "Monday" | "Tuesday" | "Wednesday" | "Thursday" | "Friday" | "Saturday";
export type StudioRole = "OWNER" | "EDITOR" | "VIEWER";

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
  fingerprint?: string;
  parentRulebookVersion?: number;
}

export interface ReviewedRuleHistory {
  decision?: string;
  verified?: boolean;
  reviewed_at?: string;
  original_text?: string;
  correction_raw?: string;
  [key: string]: unknown;
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
  type: RuleType | null;
  title: string;
  description: string;
  strength: RuleStrength | null;
  classificationRaw?: string;
  status: RuleStatus;
  verificationStatus: VerificationStatus;
  reviewStatus?: VerificationStatus;
  review?: ReviewedRuleHistory;
  affectedEntityIds: string[];
  parameters: Record<string, unknown>;
  exceptions?: RuleException[];
  source: SourceInfo;
  sourceRaw?: Record<string, unknown>;
  enforcementStatus?: EnforcementStatus;
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
  rulebookId?: string;
  status?: "CURRENT" | "HISTORICAL";
  importedAt?: string;
  sourceHash?: string;
  sourceFileHash?: string;
  ruleCount?: number;
  parentVersion?: number;
  formatVersion?: string;
  documentType?: string;
  sourceMetadata?: Record<string, unknown>;
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

export interface ValidatorCoverage {
  applicableHardRules: number;
  implementedHardRules: number;
  partialHardRules: number;
  notImplementedHardRules: number;
  notApplicableHardRules?: number;
  uncoveredHardRuleIds: string[];
}

export interface ValidationResult {
  valid: boolean;
  fullyValidated: boolean;
  hardViolations: number;
  warnings: number;
  violations: ValidationViolation[];
  coverage: ValidatorCoverage;
}

export interface ScheduleVersion {
  id: string;
  version: number;
  rulebookVersion: number;
  createdAt: string;
  actor: string;
  reason: string;
  assignments: Assignment[];
  isCurrent?: boolean;
  validationResult?: ValidationResult | null;
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

export interface StudioMember {
  userId: string;
  role: StudioRole;
  displayName?: string;
  email?: string;
  createdAt?: string;
}

export interface StudioInvite {
  id: string;
  email: string;
  role: StudioRole;
  createdAt: string;
  acceptedAt?: string | null;
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

export interface ReviewedRuleRecord {
  id: string;
  category: string;
  classification: string;
  title: string;
  text: string;
  status: RuleStatus;
  review_status: VerificationStatus;
  review: ReviewedRuleHistory;
  source: Record<string, unknown>;
}

export interface ReviewedRulebookPackage {
  format_version: "2.0";
  document_type: "DWDE_SITE_RULEBOOK";
  rulebook: {
    id: string;
    name: string;
    version: number;
    status: string;
    total_rules: number;
    reviewed_rules: number;
    source_review_completed_at?: string;
    approved_without_edit: number;
    edited_and_approved: number;
    rules_sha256: string;
  };
  schema_notes?: Record<string, unknown>;
  review_summary?: Record<string, unknown>;
  rules: ReviewedRuleRecord[];
}

export interface SchedulingEngine {
  solve(state: StudioState, options?: Record<string, unknown>): Promise<ScheduleVersion[]>;
}

export interface CurrentUser {
  id: string;
  displayName: string;
  role: StudioRole;
}

export interface AuthProvider {
  getCurrentUser(): Promise<CurrentUser | null>;
  signOut(): Promise<void>;
}
