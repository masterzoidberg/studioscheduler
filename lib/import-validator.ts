import type { CanonicalImportPackage, RuleType, StudioRule } from "@/lib/domain";

const strengths = new Set(["HARD", "VERY_STRONG", "MODERATE", "LIGHT", "BASELINE"]);
const statuses = new Set(["ACTIVE", "NEEDS_REVIEW", "DISABLED", "RETIRED"]);
const verificationStatuses = new Set(["VERIFIED", "NEEDS_REVIEW", "UNVERIFIED"]);
const days = new Set(["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]);
const ruleTypes = new Set<RuleType>([
  "REQUIRED_ROOM", "PREFERRED_ROOM", "TEACHER_QUALIFICATION", "TEACHER_UNAVAILABLE", "TEACHER_AVAILABLE_WINDOW", "REQUIRED_TEACHER", "PREFERRED_TEACHER", "MAX_TEACHER_GAP", "MAX_TEACHER_WORKDAYS", "MAX_STUDENT_GAP", "MAX_STUDENT_ATTENDANCE_DAYS", "MIN_STUDENT_ATTENDANCE_DAYS", "LATEST_FINISH", "EARLIEST_START", "DIRECTLY_AFTER", "NO_OVERLAP", "FIXED_ASSIGNMENT", "ROOM_CAPACITY", "ROOM_CAPACITY_EXCEPTION", "REQUIRED_LOWER_LEVEL", "NO_DAY", "PREFERRED_DAY", "AVOID_DAY", "RELATIONSHIP_ARRIVAL_WINDOW",
]);

export interface ImportIssue { level: "ERROR" | "WARNING"; path: string; message: string }
export interface ImportValidation { valid: boolean; errors: ImportIssue[]; warnings: ImportIssue[]; summary: { teachers: number; rooms: number; classes: number; students: number; cohorts: number; rules: number; assignments: number; hard: number; veryStrong: number; moderate: number; light: number; baseline: number } }

const isTime = (value: unknown) => typeof value === "string" && /^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(value);
const isStableId = (value: unknown) => typeof value === "string" && /^[a-z0-9][a-z0-9-]*$/.test(value);

export function validateImportPackage(input: unknown): ImportValidation {
  const errors: ImportIssue[] = [];
  const warnings: ImportIssue[] = [];
  const fail = (path: string, message: string) => errors.push({ level: "ERROR", path, message });
  const warn = (path: string, message: string) => warnings.push({ level: "WARNING", path, message });
  if (!input || typeof input !== "object") return { valid: false, errors: [{ level: "ERROR", path: "$", message: "The file must contain a JSON object." }], warnings, summary: emptySummary() };
  const pkg = input as Partial<CanonicalImportPackage>;
  if (pkg.format_version !== "1.0") fail("format_version", "Supported format_version is 1.0.");
  if (!pkg.rulebook?.id || !isStableId(pkg.rulebook.id)) fail("rulebook.id", "Rulebook needs a stable lowercase ID.");
  if (!pkg.rulebook?.name) fail("rulebook.name", "Rulebook name is required.");
  if (!pkg.entities || typeof pkg.entities !== "object") fail("entities", "entities is required.");
  if (!Array.isArray(pkg.rules)) fail("rules", "rules must be an array.");

  const entities = pkg.entities || { teachers: [], rooms: [], classes: [], students: [], cohorts: [] };
  const collections: Array<[string, Array<{ id: string }>]> = [
    ["teachers", Array.isArray(entities.teachers) ? entities.teachers : []], ["rooms", Array.isArray(entities.rooms) ? entities.rooms : []], ["classes", Array.isArray(entities.classes) ? entities.classes : []], ["students", Array.isArray(entities.students) ? entities.students : []], ["cohorts", Array.isArray(entities.cohorts) ? entities.cohorts : []], ["sessions", Array.isArray(entities.sessions) ? entities.sessions : []], ["rules", Array.isArray(pkg.rules) ? pkg.rules : []],
  ];
  const allIds = new Set<string>();
  for (const [name, rows] of collections) {
    const seen = new Set<string>();
    rows.forEach((row, index) => {
      if (!isStableId(row?.id)) fail(`${name}[${index}].id`, "Stable IDs must use lowercase letters, numbers, and hyphens.");
      else if (seen.has(row.id)) fail(`${name}[${index}].id`, `Duplicate stable ID ${row.id}.`);
      else { seen.add(row.id); allIds.add(row.id); }
    });
  }

  const teacherIds = new Set((entities.teachers || []).map((x) => x.id));
  const roomIds = new Set((entities.rooms || []).map((x) => x.id));
  const studentIds = new Set((entities.students || []).map((x) => x.id));
  const classIds = new Set((entities.classes || []).map((x) => x.id));
  const sessionIds = new Set((entities.sessions || []).map((x) => x.id));

  (entities.classes || []).forEach((klass, i) => {
    if (!klass.name || !klass.subject || !klass.level) fail(`entities.classes[${i}]`, "Class name, subject, and level are required.");
    if (!Number.isFinite(klass.durationMinutes) || klass.durationMinutes <= 0) fail(`entities.classes[${i}].durationMinutes`, "Duration must be a positive number.");
    klass.eligibleTeacherIds?.forEach((id) => { if (!teacherIds.has(id)) fail(`entities.classes[${i}].eligibleTeacherIds`, `Teacher ${id} does not exist.`); });
    klass.rosterStudentIds?.forEach((id) => { if (!studentIds.has(id)) fail(`entities.classes[${i}].rosterStudentIds`, `Student ${id} does not exist.`); });
  });
  (entities.sessions || []).forEach((session, i) => { if (!classIds.has(session.classId)) fail(`entities.sessions[${i}].classId`, `Class ${session.classId} does not exist.`); });

  (pkg.rules || []).forEach((rule, i) => {
    const path = `rules[${i}]`;
    if (!ruleTypes.has(rule.type)) fail(`${path}.type`, `Unknown rule type ${rule.type}.`);
    if (!strengths.has(rule.strength)) fail(`${path}.strength`, `Invalid strength ${rule.strength}.`);
    if (!statuses.has(rule.status)) fail(`${path}.status`, `Invalid status ${rule.status}.`);
    if (!verificationStatuses.has(rule.verificationStatus)) fail(`${path}.verificationStatus`, `Invalid verification status ${rule.verificationStatus}.`);
    if (!rule.title || !rule.description) fail(path, "Every rule requires a human-readable title and description.");
    (rule.affectedEntityIds || []).forEach((id) => { if (/^(teacher|room|class|student|cohort|session)-/.test(id) && !allIds.has(id)) fail(`${path}.affectedEntityIds`, `Referenced entity ${id} does not exist.`); });
    const params = rule.parameters || {};
    const ref = (key: string, set: Set<string>) => { const id = params[key]; if (typeof id === "string" && !set.has(id)) fail(`${path}.parameters.${key}`, `Referenced ID ${id} does not exist.`); };
    ref("teacher_id", teacherIds); ref("required_teacher_id", teacherIds); ref("room_id", roomIds); ref("required_room_id", roomIds); ref("student_id", studentIds); ref("class_id", classIds); ref("before_class_id", classIds); ref("after_class_id", classIds);
    if (["LATEST_FINISH", "EARLIEST_START"].includes(rule.type) && !isTime(params.time)) fail(`${path}.parameters.time`, "Time must use 24-hour HH:MM format.");
    if (rule.type === "TEACHER_AVAILABLE_WINDOW") { if (!days.has(String(params.day))) fail(`${path}.parameters.day`, "Invalid day."); if (!isTime(params.start) || !isTime(params.end)) fail(`${path}.parameters`, "Availability window needs valid start and end times."); }
    if (["NO_DAY", "PREFERRED_DAY", "AVOID_DAY"].includes(rule.type) && !days.has(String(params.day))) fail(`${path}.parameters.day`, "Invalid day.");
    if (rule.type === "MAX_TEACHER_WORKDAYS" && (!Number.isFinite(Number(params.max_days)) || Number(params.max_days) < 1)) fail(`${path}.parameters.max_days`, "Maximum workdays must be at least 1.");
    if (["MAX_TEACHER_GAP", "MAX_STUDENT_GAP"].includes(rule.type) && (!Number.isFinite(Number(params.minutes)) || Number(params.minutes) < 0)) fail(`${path}.parameters.minutes`, "Gap minutes must be zero or greater.");
    if (rule.status === "NEEDS_REVIEW" || rule.verificationStatus !== "VERIFIED") warn(path, `${rule.title || rule.id} still needs review.`);
  });

  (pkg.assignments || []).forEach((a, i) => {
    if (!sessionIds.has(a.sessionId)) fail(`assignments[${i}].sessionId`, `Session ${a.sessionId} does not exist.`);
    if (!teacherIds.has(a.teacherId)) fail(`assignments[${i}].teacherId`, `Teacher ${a.teacherId} does not exist.`);
    if (!roomIds.has(a.roomId)) fail(`assignments[${i}].roomId`, `Room ${a.roomId} does not exist.`);
    if (!days.has(a.day)) fail(`assignments[${i}].day`, "Invalid day.");
    if (!isTime(a.startTime) || !isTime(a.endTime)) fail(`assignments[${i}]`, "Assignment start and end must use 24-hour HH:MM format.");
  });

  const rules = pkg.rules || [];
  const summary = {
    teachers: entities.teachers?.length || 0, rooms: entities.rooms?.length || 0, classes: entities.classes?.length || 0, students: entities.students?.length || 0, cohorts: entities.cohorts?.length || 0, rules: rules.length, assignments: pkg.assignments?.length || 0,
    hard: rules.filter((r) => r.strength === "HARD").length, veryStrong: rules.filter((r) => r.strength === "VERY_STRONG").length, moderate: rules.filter((r) => r.strength === "MODERATE").length, light: rules.filter((r) => r.strength === "LIGHT").length, baseline: rules.filter((r) => r.strength === "BASELINE").length,
  };
  return { valid: errors.length === 0, errors, warnings, summary };
}

function emptySummary() { return { teachers: 0, rooms: 0, classes: 0, students: 0, cohorts: 0, rules: 0, assignments: 0, hard: 0, veryStrong: 0, moderate: 0, light: 0, baseline: 0 }; }

function stableComparable(rule: StudioRule) {
  const { source: _source, updatedAt: _updatedAt, versionIntroduced: _versionIntroduced, ...rest } = rule;
  return JSON.stringify(rest, Object.keys(rest).sort());
}

export function diffImportedRules(current: StudioRule[], imported: StudioRule[]) {
  const currentMap = new Map(current.map((r) => [r.id, r]));
  const importedMap = new Map(imported.map((r) => [r.id, r]));
  const unchanged: string[] = []; const modified: string[] = []; const added: string[] = []; const missing: string[] = [];
  for (const rule of imported) {
    const existing = currentMap.get(rule.id);
    if (!existing) added.push(rule.id);
    else if (stableComparable(existing) === stableComparable(rule)) unchanged.push(rule.id);
    else modified.push(rule.id);
  }
  for (const rule of current) if (!importedMap.has(rule.id)) missing.push(rule.id);
  return { unchanged, modified, added, missing };
}
