import type { PlanningDatasetSnapshotV1, StudioState } from "@/lib/domain";

// Canonical planning snapshots must sort identically on every runtime/ICU locale.
// Compare UTF-16 code units directly instead of using localeCompare.
const compareCanonicalStrings = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const sortStrings = (values: string[] | undefined) => [...(values || [])].sort(compareCanonicalStrings);

export function buildPlanningDatasetSnapshot(state: StudioState): PlanningDatasetSnapshotV1 {
  return {
    schemaVersion: "1.1",
    studioId: state.studioId,
    teacherIds: state.teachers.map((teacher) => teacher.id).sort(compareCanonicalStrings),
    rooms: state.rooms
      .map((room) => ({
        id: room.id,
        capacity: room.capacity ?? null,
        features: sortStrings(room.features),
      }))
      .sort((a, b) => compareCanonicalStrings(a.id, b.id)),
    students: state.students
      .map((student) => ({
        id: student.id,
        level: student.level,
        cohortIds: sortStrings(student.cohortIds),
      }))
      .sort((a, b) => compareCanonicalStrings(a.id, b.id)),
    cohorts: state.cohorts
      .map((cohort) => ({
        id: cohort.id,
        studentIds: sortStrings(cohort.studentIds),
      }))
      .sort((a, b) => compareCanonicalStrings(a.id, b.id)),
    classes: state.classes
      .map((klass) => ({
        id: klass.id,
        subject: klass.subject,
        level: klass.level,
        durationMinutes: klass.durationMinutes,
        weeklyFrequency: klass.weeklyFrequency,
        rosterStudentIds: sortStrings(klass.rosterStudentIds),
        companyOnly: Boolean(klass.companyOnly),
      }))
      .sort((a, b) => compareCanonicalStrings(a.id, b.id)),
    sessions: state.sessions
      .map((session) => ({
        id: session.id,
        classId: session.classId,
        ordinal: session.ordinal,
        locked: Boolean(session.locked),
        durationMinutes: session.durationMinutes ?? null,
      }))
      .sort((a, b) => compareCanonicalStrings(a.id, b.id)),
  };
}

export function canonicalPlanningDatasetJson(snapshot: PlanningDatasetSnapshotV1) {
  return JSON.stringify(snapshot);
}

export function planningDatasetMatches(a: PlanningDatasetSnapshotV1, b: PlanningDatasetSnapshotV1) {
  return canonicalPlanningDatasetJson(a) === canonicalPlanningDatasetJson(b);
}
