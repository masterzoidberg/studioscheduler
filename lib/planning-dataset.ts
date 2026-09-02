import type { PlanningDatasetSnapshotV1, StudioState } from "@/lib/domain";

const sortStrings = (values: string[] | undefined) => [...(values || [])].sort((a, b) => a.localeCompare(b));

export function buildPlanningDatasetSnapshot(state: StudioState): PlanningDatasetSnapshotV1 {
  return {
    schemaVersion: "1.0",
    studioId: state.studioId,
    teacherIds: state.teachers.map((teacher) => teacher.id).sort((a, b) => a.localeCompare(b)),
    rooms: state.rooms
      .map((room) => ({
        id: room.id,
        capacity: room.capacity ?? null,
        features: sortStrings(room.features),
      }))
      .sort((a, b) => a.id.localeCompare(b.id)),
    students: state.students
      .map((student) => ({
        id: student.id,
        level: student.level,
        cohortIds: sortStrings(student.cohortIds),
      }))
      .sort((a, b) => a.id.localeCompare(b.id)),
    cohorts: state.cohorts
      .map((cohort) => ({
        id: cohort.id,
        studentIds: sortStrings(cohort.studentIds),
      }))
      .sort((a, b) => a.id.localeCompare(b.id)),
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
      .sort((a, b) => a.id.localeCompare(b.id)),
    sessions: state.sessions
      .map((session) => ({
        id: session.id,
        classId: session.classId,
        ordinal: session.ordinal,
        locked: Boolean(session.locked),
      }))
      .sort((a, b) => a.id.localeCompare(b.id)),
  };
}

export function canonicalPlanningDatasetJson(snapshot: PlanningDatasetSnapshotV1) {
  return JSON.stringify(snapshot);
}

export function planningDatasetMatches(a: PlanningDatasetSnapshotV1, b: PlanningDatasetSnapshotV1) {
  return canonicalPlanningDatasetJson(a) === canonicalPlanningDatasetJson(b);
}
