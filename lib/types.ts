export type RuleStrength =
  | "HARD"
  | "VERY_STRONG"
  | "MODERATE"
  | "LIGHT"
  | "BASELINE";

export type RuleStatus = "VERIFIED" | "NEEDS_REVIEW" | "NEEDS_DISCUSSION";

export type RuleCategory =
  | "Studio Operations"
  | "Rooms"
  | "Teachers"
  | "Dancers / Cohorts"
  | "Classes"
  | "Sequencing"
  | "Attendance"
  | "Timing"
  | "Capacity"
  | "Company"
  | "Preferences"
  | "Assumptions"
  | "Exceptions";

export interface StudioRule {
  id: string;
  title: string;
  description: string;
  strength: RuleStrength;
  category: RuleCategory;
  relatedEntities: string[];
  status: RuleStatus;
  source: string;
  lastModified: string;
  versionIntroduced: string;
  reason?: string;
}

export type ScheduleStatus = "LOCKED" | "WARNING" | "AI_PROPOSED" | "NORMAL";

export interface ScheduleAssignment {
  id: string;
  className: string;
  teacher: string;
  day: "Monday" | "Tuesday" | "Wednesday" | "Thursday" | "Friday" | "Saturday";
  room: "Studio A" | "Studio B" | "Studio C";
  startTime: string;
  endTime: string;
  level: string;
  status: ScheduleStatus[];
  enrollment: number;
  rules: string[];
}

export interface RecentChange {
  title: string;
  detail: string;
  timestamp: string;
  actor: string;
}
