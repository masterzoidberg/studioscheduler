import type { StudioState } from "@/lib/domain";
import { rulebookClassStructureRepairs } from "@/lib/planning-structure-repair";
import { rulebookRosterRepairs } from "@/lib/planning-roster-repair";

export type SetupSectionId =
  | "studio"
  | "teachers"
  | "classes"
  | "students"
  | "requirements"
  | "preferences"
  | "review";

export type SetupSectionStatus = "NEEDS_ACTION" | "READY_FOR_NOW" | "COMING_LATER";

export interface SetupSectionProgress {
  id: SetupSectionId;
  title: string;
  description: string;
  status: SetupSectionStatus;
  href?: string;
  actionLabel?: string;
}

export interface SetupProgress {
  firstEntry: boolean;
  sections: SetupSectionProgress[];
  actionableSections: SetupSectionProgress[];
  nextAction: SetupSectionProgress | null;
}

function plural(count: number, one: string, many = `${one}s`) {
  return `${count} ${count === 1 ? one : many}`;
}

export function buildSetupProgress(state: StudioState): SetupProgress {
  const roomsMissingCapacity = state.rooms.filter(
    (room) => typeof room.capacity !== "number" || !Number.isFinite(room.capacity) || room.capacity <= 0,
  );
  const structureRepairs = rulebookClassStructureRepairs({
    classes: state.classes,
    sessions: state.sessions,
  });
  const rosterRepairs = rulebookRosterRepairs({
    classes: state.classes,
    students: state.students,
  });
  const currentPlanning = state.planningDatasetVersions?.find((version) => version.status === "CURRENT") ?? null;
  const planningConfirmed = Boolean(currentPlanning?.confirmedForSchedulingAt);
  const firstEntry = state.rooms.length === 0
    && state.teachers.length === 0
    && state.classes.length === 0
    && state.students.length === 0;

  const studio: SetupSectionProgress = state.rooms.length === 0
    ? {
      id: "studio",
      title: "Studio",
      description: "Add the rooms you schedule in. Room capacity is required before the setup can be reviewed safely.",
      status: "NEEDS_ACTION",
      href: "/people",
      actionLabel: "Add rooms",
    }
    : roomsMissingCapacity.length > 0
      ? {
        id: "studio",
        title: "Studio",
        description: `${plural(roomsMissingCapacity.length, "room")} still need a usable capacity. Room details can be corrected in the current People & Rooms editor.`,
        status: "NEEDS_ACTION",
        href: "/people",
        actionLabel: "Review rooms",
      }
      : {
        id: "studio",
        title: "Studio",
        description: `${plural(state.rooms.length, "room")} are recorded with capacity. Operating hours will move into this section in a later setup step.`,
        status: "READY_FOR_NOW",
        href: "/people",
        actionLabel: "Review rooms",
      };

  const teachers: SetupSectionProgress = state.teachers.length === 0
    ? {
      id: "teachers",
      title: "Teachers",
      description: "Add at least one teacher before building a schedule.",
      status: "NEEDS_ACTION",
      href: "/people",
      actionLabel: "Add teachers",
    }
    : {
      id: "teachers",
      title: "Teachers",
      description: `${plural(state.teachers.length, "teacher")} are in the working inventory. Availability and qualification editing will move here in a later setup step.`,
      status: "READY_FOR_NOW",
      href: "/people",
      actionLabel: "Review teachers",
    };

  const classes: SetupSectionProgress = state.classes.length === 0
    ? {
      id: "classes",
      title: "Classes",
      description: "Add the classes that need weekly schedule time.",
      status: "NEEDS_ACTION",
      href: "/classes",
      actionLabel: "Add classes",
    }
    : {
      id: "classes",
      title: "Classes",
      description: `${plural(state.classes.length, "class", "classes")} are in the working catalog. Weekly structure and rosters remain editable in the current Classes editor.`,
      status: "READY_FOR_NOW",
      href: "/classes",
      actionLabel: "Review classes",
    };

  const students: SetupSectionProgress = state.students.length === 0 && state.classes.length > 0
    ? {
      id: "students",
      title: "Students",
      description: "No dancers are recorded yet. Add current students before relying on roster overlap or attendance rules.",
      status: "NEEDS_ACTION",
      href: "/people",
      actionLabel: "Add students",
    }
    : {
      id: "students",
      title: "Students",
      description: state.students.length > 0
        ? `${plural(state.students.length, "student")} are in the working inventory. Student restrictions and scheduling relationships will move here later.`
        : "No students are recorded yet. You can add them when the current season's roster is available.",
      status: "READY_FOR_NOW",
      href: "/people",
      actionLabel: "Review students",
    };

  const repairCount = structureRepairs.length + rosterRepairs.length;
  const requirements: SetupSectionProgress = repairCount > 0
    ? {
      id: "requirements",
      title: "Requirements",
      description: `${plural(repairCount, "Rulebook-backed setup item")} need review before the planning snapshot can be trusted.`,
      status: "NEEDS_ACTION",
      href: "/planning-repairs",
      actionLabel: "Review requirements",
    }
    : {
      id: "requirements",
      title: "Requirements",
      description: "No deterministic class or roster repair is currently outstanding. Additional manager-facing requirement editors will be added in later setup steps.",
      status: "READY_FOR_NOW",
      href: "/planning-repairs",
      actionLabel: "Review requirements",
    };

  const preferences: SetupSectionProgress = {
    id: "preferences",
    title: "Preferences",
    description: "Preference editing is not available in Setup yet. Current reviewed preferences remain authoritative and are not guessed from prose or AI.",
    status: "COMING_LATER",
  };

  const review: SetupSectionProgress = !currentPlanning
    ? {
      id: "review",
      title: "Review",
      description: "A current planning snapshot has not been established yet. Finish the available setup sections first.",
      status: "NEEDS_ACTION",
      href: "/readiness",
      actionLabel: "Open current review",
    }
    : !planningConfirmed
      ? {
        id: "review",
        title: "Review",
        description: "The current setup snapshot still needs manager confirmation before automatic scheduling can rely on it.",
        status: "NEEDS_ACTION",
        href: "/readiness",
        actionLabel: "Review current setup",
      }
      : {
        id: "review",
        title: "Review",
        description: "The current planning snapshot is manager-confirmed. Any meaningful setup edit will create a new snapshot that needs review again.",
        status: "READY_FOR_NOW",
        href: "/readiness",
        actionLabel: "View current review",
      };

  const sections = [studio, teachers, classes, students, requirements, preferences, review];
  const actionableSections = sections.filter((section) => section.status === "NEEDS_ACTION");
  return {
    firstEntry,
    sections,
    actionableSections,
    nextAction: actionableSections[0] ?? null,
  };
}
