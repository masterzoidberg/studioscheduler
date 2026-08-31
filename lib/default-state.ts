import type { Assignment, ClassDefinition, ClassSession, StudioRule, StudioState } from "@/lib/domain";

const now = "2026-08-30T21:30:00-04:00";

export const teachers = [
  { id: "teacher-cami", name: "Cami", subjects: ["Jazz", "Tap", "Contemporary", "Lyrical"] },
  { id: "teacher-aimee", name: "Aimée", subjects: ["Ballet", "Pointe", "Pre-Pointe"] },
  { id: "teacher-karly", name: "Karly", subjects: ["Ballet", "Pointe", "Contemporary", "Lyrical"] },
  { id: "teacher-denise", name: "Denise", subjects: ["Jazz", "Tap"] },
  { id: "teacher-sydni", name: "Sydni", subjects: ["Ballet", "Jazz", "Elementary"] },
  { id: "teacher-jalyn", name: "Jalyn", subjects: ["Hip Hop"] },
  { id: "teacher-jae", name: "Jae", subjects: ["Hip Hop"] },
  { id: "teacher-khyre", name: "Khyre", subjects: ["Hip Hop"] },
  { id: "teacher-melina", name: "Melina", subjects: ["Ballet", "Jazz", "Lyrical"] },
];

export const rooms = [
  { id: "room-studio-a", name: "Studio A", capacity: 24, features: ["Marley flooring", "Ballet barres"] },
  { id: "room-studio-b", name: "Studio B", capacity: 22 },
  { id: "room-studio-c", name: "Studio C", capacity: 15 },
];

export const students = [
  { id: "student-poppy", name: "Poppy Boggs", level: "Level 2" },
  { id: "student-karly-daughter", name: "Karly's daughter", level: "Level 4B" },
  { id: "student-kiran", name: "Kiran Landis", level: "Level 5" },
  ...Array.from({ length: 28 }, (_, i) => ({ id: `student-${i + 1}`, name: `Dancer ${i + 1}`, level: i < 8 ? "Elementary 2" : i < 18 ? "Level 1" : "Level 3" })),
];

const classRows: Array<[string, string, string, string, number, number, string[], string[]]> = [
  ["class-ballet-3", "Ballet 3", "Ballet", "Level 3", 90, 2, ["student-19", "student-20", "student-21", "student-22"], ["teacher-aimee", "teacher-karly", "teacher-melina"]],
  ["class-pre-pointe", "Pre-Pointe", "Pre-Pointe", "Level 3", 30, 1, ["student-19", "student-20", "student-21"], ["teacher-aimee", "teacher-karly"]],
  ["class-ballet-4b-5", "Ballet 4B/5", "Ballet", "Levels 4B/5", 105, 2, ["student-karly-daughter", "student-kiran"], ["teacher-aimee", "teacher-karly"]],
  ["class-jazz-1", "Jazz 1", "Jazz", "Level 1", 45, 1, ["student-9", "student-10", "student-11", "student-12"], ["teacher-cami", "teacher-denise", "teacher-sydni"]],
  ["class-lyrical-1", "Lyrical 1", "Lyrical", "Level 1", 45, 1, ["student-9", "student-10", "student-11", "student-12"], ["teacher-cami", "teacher-karly", "teacher-melina"]],
  ["class-adult-tap", "Adult Tap", "Tap", "Adult", 60, 1, [], ["teacher-cami", "teacher-denise"]],
  ["class-adult-jazz", "Adult Jazz", "Jazz", "Adult", 60, 1, [], ["teacher-cami", "teacher-denise"]],
  ["class-elem-jazz-1", "Elementary Jazz 1", "Jazz", "Elementary 1", 45, 1, ["student-1", "student-2", "student-3", "student-4", "student-5", "student-6"], ["teacher-sydni", "teacher-melina"]],
  ["class-elem-ballet-2", "Elementary Ballet 2", "Ballet", "Elementary 2", 60, 1, ["student-1", "student-2", "student-3", "student-4", "student-5", "student-6", "student-7", "student-8"], ["teacher-sydni", "teacher-aimee", "teacher-karly"]],
  ["class-jazz-3", "Jazz 3", "Jazz", "Level 3", 45, 1, ["student-19", "student-20", "student-21", "student-22"], ["teacher-cami", "teacher-denise", "teacher-sydni"]],
  ["class-contemporary-3", "Contemporary 3", "Contemporary", "Level 3", 45, 1, ["student-19", "student-20", "student-21", "student-22"], ["teacher-cami", "teacher-karly"]],
  ["class-hiphop-2", "Hip Hop 2", "Hip Hop", "Level 2", 60, 1, ["student-poppy"], ["teacher-jalyn", "teacher-jae", "teacher-khyre"]],
  ["class-combo-1", "Combo 1", "Combo", "Elementary 1", 60, 1, ["student-1", "student-2"], ["teacher-sydni", "teacher-melina"]],
  ["class-combo-2", "Combo 2", "Combo", "Elementary 2", 60, 1, ["student-3", "student-4"], ["teacher-sydni", "teacher-melina"]],
];

export const classes: ClassDefinition[] = classRows.map(([id, name, subject, level, durationMinutes, weeklyFrequency, rosterStudentIds, eligibleTeacherIds]) => ({ id, name, subject, level, durationMinutes, weeklyFrequency, rosterStudentIds, eligibleTeacherIds, companyOnly: false }));

export const sessions: ClassSession[] = classes.flatMap((item) => Array.from({ length: item.weeklyFrequency }, (_, i) => ({ id: `session-${item.id.replace("class-", "")}-${i + 1}`, classId: item.id, ordinal: i + 1, locked: item.id === "class-adult-tap" || item.id === "class-adult-jazz" || item.id.startsWith("class-combo") })));

export const rules: StudioRule[] = [
  { id: "rule-room-ballet-studio-a", category: "ROOM", type: "REQUIRED_ROOM", title: "Ballet Levels 1–5 require Studio A", description: "Ballet Levels 1–5 must use Studio A because of flooring requirements.", strength: "HARD", status: "ACTIVE", verificationStatus: "VERIFIED", affectedEntityIds: ["class-ballet-3", "class-ballet-4b-5"], parameters: { required_room_id: "room-studio-a", subject: "Ballet", levels: ["Level 1", "Level 2", "Level 3", "Level 4A", "Level 4B", "Level 5", "Levels 4B/5"] }, source: { type: "SYSTEM_SEED", note: "Representative rule pending canonical import" }, versionIntroduced: 1, updatedAt: now },
  { id: "rule-room-pointe-studio-a", category: "ROOM", type: "REQUIRED_ROOM", title: "Pointe and Pre-Pointe require Studio A", description: "All Pointe and Pre-Pointe sessions require Studio A.", strength: "HARD", status: "ACTIVE", verificationStatus: "VERIFIED", affectedEntityIds: ["class-pre-pointe"], parameters: { required_room_id: "room-studio-a", subjects: ["Pointe", "Pre-Pointe"] }, source: { type: "SYSTEM_SEED" }, versionIntroduced: 1, updatedAt: now },
  { id: "rule-cami-workdays", category: "TEACHER", type: "MAX_TEACHER_WORKDAYS", title: "Cami Maximum Regular Workdays", description: "Cami may teach regular Monday–Saturday classes on no more than four days because Sunday Company work counts toward her five total working days.", strength: "HARD", status: "ACTIVE", verificationStatus: "VERIFIED", affectedEntityIds: ["teacher-cami"], parameters: { teacher_id: "teacher-cami", max_days: 4 }, source: { type: "SYSTEM_SEED", note: "Confirmed scheduling rule" }, versionIntroduced: 1, updatedAt: now },
  { id: "rule-cami-no-hiphop", category: "TEACHER", type: "TEACHER_QUALIFICATION", title: "Cami cannot teach Hip Hop", description: "Do not assign Hip Hop classes to Cami.", strength: "HARD", status: "ACTIVE", verificationStatus: "VERIFIED", affectedEntityIds: ["teacher-cami"], parameters: { teacher_id: "teacher-cami", prohibited_subjects: ["Hip Hop"] }, source: { type: "SYSTEM_SEED" }, versionIntroduced: 1, updatedAt: now },
  { id: "rule-cami-no-elementary1", category: "TEACHER", type: "TEACHER_QUALIFICATION", title: "Cami cannot teach Elementary 1", description: "Elementary 1 classes must be assigned to another qualified teacher.", strength: "HARD", status: "ACTIVE", verificationStatus: "VERIFIED", affectedEntityIds: ["teacher-cami"], parameters: { teacher_id: "teacher-cami", prohibited_levels: ["Elementary 1"] }, source: { type: "SYSTEM_SEED" }, versionIntroduced: 1, updatedAt: now },
  { id: "rule-karly-no-tap-hiphop", category: "TEACHER", type: "TEACHER_QUALIFICATION", title: "Karly cannot teach Tap or Hip Hop", description: "Karly may not be assigned to Tap or Hip Hop classes.", strength: "HARD", status: "ACTIVE", verificationStatus: "VERIFIED", affectedEntityIds: ["teacher-karly"], parameters: { teacher_id: "teacher-karly", prohibited_subjects: ["Tap", "Hip Hop"] }, source: { type: "SYSTEM_SEED" }, versionIntroduced: 1, updatedAt: now },
  { id: "rule-jalyn-window", category: "TEACHER", type: "TEACHER_AVAILABLE_WINDOW", title: "Jalyn Thursday Hip Hop window", description: "Jalyn can teach Hip Hop Thursday 6:00–8:00 PM only.", strength: "HARD", status: "ACTIVE", verificationStatus: "VERIFIED", affectedEntityIds: ["teacher-jalyn"], parameters: { teacher_id: "teacher-jalyn", day: "Thursday", start: "18:00", end: "20:00" }, source: { type: "SYSTEM_SEED" }, versionIntroduced: 1, updatedAt: now },
  { id: "rule-jae-window", category: "TEACHER", type: "TEACHER_AVAILABLE_WINDOW", title: "Jae Saturday morning window", description: "Jae can teach Hip Hop Saturday 9:00 AM–12:00 PM only.", strength: "HARD", status: "ACTIVE", verificationStatus: "VERIFIED", affectedEntityIds: ["teacher-jae"], parameters: { teacher_id: "teacher-jae", day: "Saturday", start: "09:00", end: "12:00" }, source: { type: "SYSTEM_SEED" }, versionIntroduced: 1, updatedAt: now },
  { id: "rule-khyre-window", category: "TEACHER", type: "TEACHER_AVAILABLE_WINDOW", title: "Khyre Saturday window", description: "Khyre can teach Hip Hop Saturday 11:00 AM–2:00 PM only.", strength: "HARD", status: "ACTIVE", verificationStatus: "VERIFIED", affectedEntityIds: ["teacher-khyre"], parameters: { teacher_id: "teacher-khyre", day: "Saturday", start: "11:00", end: "14:00" }, source: { type: "SYSTEM_SEED" }, versionIntroduced: 1, updatedAt: now },
  { id: "rule-teacher-gap", category: "TIMING", type: "MAX_TEACHER_GAP", title: "Teacher gaps cannot exceed one hour", description: "A teacher's gap between regular classes on the same day cannot exceed 60 minutes.", strength: "HARD", status: "ACTIVE", verificationStatus: "VERIFIED", affectedEntityIds: [], parameters: { minutes: 60 }, source: { type: "SYSTEM_SEED" }, versionIntroduced: 1, updatedAt: now },
  { id: "rule-student-gap", category: "TIMING", type: "MAX_STUDENT_GAP", title: "Student gaps cannot exceed one hour", description: "A dancer's gap between required classes on the same day cannot exceed 60 minutes.", strength: "HARD", status: "ACTIVE", verificationStatus: "VERIFIED", affectedEntityIds: [], parameters: { minutes: 60 }, source: { type: "SYSTEM_SEED" }, versionIntroduced: 1, updatedAt: now },
  { id: "rule-elementary1-finish", category: "TIMING", type: "LATEST_FINISH", title: "Elementary 1 must finish by 7:00 PM", description: "Elementary 1 sessions must end no later than 7:00 PM.", strength: "HARD", status: "ACTIVE", verificationStatus: "VERIFIED", affectedEntityIds: [], parameters: { levels: ["Elementary 1"], time: "19:00" }, source: { type: "SYSTEM_SEED" }, versionIntroduced: 1, updatedAt: now },
  { id: "rule-elementary2-level2-finish", category: "TIMING", type: "LATEST_FINISH", title: "Elementary 2 and Levels 1–2 finish by 8:30 PM", description: "Elementary 2 and Levels 1–2 must end no later than 8:30 PM.", strength: "HARD", status: "ACTIVE", verificationStatus: "VERIFIED", affectedEntityIds: [], parameters: { levels: ["Elementary 2", "Level 1", "Level 2"], time: "20:30" }, source: { type: "SYSTEM_SEED" }, versionIntroduced: 1, updatedAt: now },
  { id: "rule-level3-4b-finish", category: "TIMING", type: "LATEST_FINISH", title: "Levels 3–4B finish by 9:30 PM", description: "Levels 3 through 4B must finish no later than 9:30 PM.", strength: "HARD", status: "ACTIVE", verificationStatus: "VERIFIED", affectedEntityIds: [], parameters: { levels: ["Level 3", "Level 4A", "Level 4B", "Levels 4B/5"], time: "21:30" }, source: { type: "SYSTEM_SEED" }, versionIntroduced: 1, updatedAt: now },
  { id: "rule-level5-finish", category: "TIMING", type: "LATEST_FINISH", title: "Level 5 may finish by 9:45 PM", description: "Level 5 classes may finish as late as 9:45 PM.", strength: "HARD", status: "ACTIVE", verificationStatus: "VERIFIED", affectedEntityIds: [], parameters: { levels: ["Level 5"], time: "21:45" }, source: { type: "SYSTEM_SEED" }, versionIntroduced: 1, updatedAt: now },
  { id: "rule-level4b5-no-friday", category: "ATTENDANCE", type: "NO_DAY", title: "Level 4B and Level 5 cannot attend Friday", description: "Do not schedule required Level 4B or Level 5 classes on Friday.", strength: "HARD", status: "ACTIVE", verificationStatus: "VERIFIED", affectedEntityIds: [], parameters: { levels: ["Level 4B", "Level 5", "Levels 4B/5"], day: "Friday" }, source: { type: "SYSTEM_SEED" }, versionIntroduced: 1, updatedAt: now },
  { id: "rule-jazz1-lyrical1", category: "SEQUENCING", type: "DIRECTLY_AFTER", title: "Jazz 1 must be directly followed by Lyrical 1", description: "Jazz 1 must be directly followed by Lyrical 1 with no gap.", strength: "HARD", status: "ACTIVE", verificationStatus: "VERIFIED", affectedEntityIds: ["class-jazz-1", "class-lyrical-1"], parameters: { first_class_id: "class-jazz-1", second_class_id: "class-lyrical-1" }, source: { type: "SYSTEM_SEED" }, versionIntroduced: 1, updatedAt: now },
  { id: "rule-jazz3-contemporary3", category: "SEQUENCING", type: "DIRECTLY_AFTER", title: "Jazz 3 must be directly followed by Contemporary 3", description: "Jazz 3 must be directly followed by Contemporary 3 with no gap.", strength: "HARD", status: "ACTIVE", verificationStatus: "VERIFIED", affectedEntityIds: ["class-jazz-3", "class-contemporary-3"], parameters: { first_class_id: "class-jazz-3", second_class_id: "class-contemporary-3" }, source: { type: "SYSTEM_SEED" }, versionIntroduced: 1, updatedAt: now },
  { id: "rule-ballet3-prepointe", category: "SEQUENCING", type: "DIRECTLY_AFTER", title: "Ballet 3 designated meeting followed by Pre-Pointe", description: "One designated weekly Ballet 3 meeting must be directly followed by Pre-Pointe.", strength: "HARD", status: "ACTIVE", verificationStatus: "VERIFIED", affectedEntityIds: ["class-ballet-3", "class-pre-pointe"], parameters: { first_session_id: "session-ballet-3-1", second_session_id: "session-pre-pointe-1" }, source: { type: "SYSTEM_SEED" }, versionIntroduced: 1, updatedAt: now },
  { id: "rule-studio-c-capacity", category: "CAPACITY", type: "ROOM_CAPACITY", title: "Studio C preferred maximum is 15 dancers", description: "Studio C normally has a preferred maximum of 15 dancers. Elementary program classes may exceed it.", strength: "VERY_STRONG", status: "ACTIVE", verificationStatus: "NEEDS_REVIEW", affectedEntityIds: ["room-studio-c"], parameters: { room_id: "room-studio-c", capacity: 15 }, exceptions: [{ id: "exception-elementary-capacity", title: "Elementary classes may exceed 15", when: { level_prefix: "Elementary" }, override: { allow_over_capacity: true } }], source: { type: "SYSTEM_SEED" }, versionIntroduced: 1, updatedAt: now },
  { id: "rule-denise-fixed", category: "CLASS", type: "FIXED_ASSIGNMENT", title: "Denise's current classes are fixed in Studio B", description: "Denise's current assignments are fixed unless this rule changes.", strength: "HARD", status: "ACTIVE", verificationStatus: "VERIFIED", affectedEntityIds: ["teacher-denise"], parameters: { teacher_id: "teacher-denise", room_id: "room-studio-b" }, source: { type: "SYSTEM_SEED" }, versionIntroduced: 1, updatedAt: now },
  { id: "rule-combo1-fixed", category: "CLASS", type: "FIXED_ASSIGNMENT", title: "Combo 1 Saturday 9:00–10:00 is fixed", description: "Combo 1 remains Saturday 9:00–10:00.", strength: "HARD", status: "ACTIVE", verificationStatus: "VERIFIED", affectedEntityIds: ["class-combo-1"], parameters: { session_id: "session-combo-1-1", day: "Saturday", start: "09:00", end: "10:00" }, source: { type: "SYSTEM_SEED" }, versionIntroduced: 1, updatedAt: now },
  { id: "rule-combo2-fixed", category: "CLASS", type: "FIXED_ASSIGNMENT", title: "Combo 2 Saturday 10:00–11:00 is fixed", description: "Combo 2 remains Saturday 10:00–11:00.", strength: "HARD", status: "ACTIVE", verificationStatus: "VERIFIED", affectedEntityIds: ["class-combo-2"], parameters: { session_id: "session-combo-2-1", day: "Saturday", start: "10:00", end: "11:00" }, source: { type: "SYSTEM_SEED" }, versionIntroduced: 1, updatedAt: now },
  { id: "rule-karly-arrival", category: "RELATIONSHIP", type: "RELATIONSHIP_ARRIVAL_WINDOW", title: "Karly and daughter arrival relationship", description: "Karly's first teaching assignment must remain compatible with her daughter's arrival timing.", strength: "HARD", status: "NEEDS_REVIEW", verificationStatus: "NEEDS_REVIEW", affectedEntityIds: ["teacher-karly", "student-karly-daughter"], parameters: { teacher_id: "teacher-karly", student_id: "student-karly-daughter", max_minutes_before_student: 60 }, source: { type: "SYSTEM_SEED" }, versionIntroduced: 1, updatedAt: now },
  { id: "rule-kiran-lower-level-exception", category: "EXCEPTION", type: "REQUIRED_LOWER_LEVEL", title: "Kiran Landis flexible lower-level placement", description: "Kiran Landis is a flexible exception to normal lower-level participation.", strength: "HARD", status: "ACTIVE", verificationStatus: "VERIFIED", affectedEntityIds: ["student-kiran"], parameters: { student_id: "student-kiran", flexible_exception: true }, source: { type: "SYSTEM_SEED" }, versionIntroduced: 1, updatedAt: now },
];

const assignmentRows: Array<[string, string, Assignment["day"], string, string, string, string, boolean?]> = [
  ["assignment-ballet3", "session-ballet-3-1", "Monday", "16:45", "18:15", "teacher-aimee", "room-studio-a"],
  ["assignment-prepointe", "session-pre-pointe-1", "Monday", "18:15", "18:45", "teacher-aimee", "room-studio-a", true],
  ["assignment-ballet4b5", "session-ballet-4b-5-1", "Monday", "18:45", "20:30", "teacher-aimee", "room-studio-a"],
  ["assignment-jazz1", "session-jazz-1-1", "Monday", "16:45", "17:30", "teacher-cami", "room-studio-b"],
  ["assignment-lyrical1", "session-lyrical-1-1", "Monday", "17:30", "18:15", "teacher-cami", "room-studio-b"],
  ["assignment-adulttap", "session-adult-tap-1", "Monday", "18:30", "19:30", "teacher-denise", "room-studio-b", true],
  ["assignment-adultjazz", "session-adult-jazz-1", "Monday", "19:30", "20:30", "teacher-denise", "room-studio-b", true],
  ["assignment-elemjazz", "session-elem-jazz-1-1", "Monday", "16:45", "17:30", "teacher-sydni", "room-studio-c"],
  ["assignment-elemballet", "session-elem-ballet-2-1", "Monday", "17:30", "18:30", "teacher-sydni", "room-studio-c"],
  ["assignment-jazz3", "session-jazz-3-1", "Monday", "18:45", "19:30", "teacher-cami", "room-studio-c"],
  ["assignment-contemporary3", "session-contemporary-3-1", "Monday", "19:30", "20:15", "teacher-cami", "room-studio-c"],
  ["assignment-combo1", "session-combo-1-1", "Saturday", "09:00", "10:00", "teacher-sydni", "room-studio-b", true],
  ["assignment-combo2", "session-combo-2-1", "Saturday", "10:00", "11:00", "teacher-sydni", "room-studio-b", true],
];

export const assignments: Assignment[] = assignmentRows.map(([id, sessionId, day, startTime, endTime, teacherId, roomId, locked]) => ({ id, sessionId, day, startTime, endTime, teacherId, roomId, locked, status: "NORMAL" }));

export const defaultStudioState: StudioState = {
  studioId: "dwde",
  studioName: "DWDE Studio",
  teachers,
  rooms,
  students,
  cohorts: [],
  classes,
  sessions,
  rules,
  rulebookVersions: [{ id: "rulebook-v1", version: 1, name: "DWDE Master Rulebook", createdAt: now, actor: "System", reason: "Initial working state", changedRuleIds: rules.map((r) => r.id) }],
  ruleHistory: rules.map((rule) => ({ id: `history-${rule.id}-v1`, ruleId: rule.id, rulebookVersion: 1, changedAt: now, actor: "System", reason: "Initial working state", before: null, after: rule })),
  scheduleVersions: [{ id: "schedule-v1", version: 1, rulebookVersion: 1, createdAt: now, actor: "System", reason: "Initial working schedule", assignments }],
  scenarios: [],
  auditEvents: [{ id: "audit-initial", at: now, actor: "System", action: "INITIALIZE", entityType: "Studio", entityId: "dwde", detail: "Created initial DWDE workspace." }],
};
