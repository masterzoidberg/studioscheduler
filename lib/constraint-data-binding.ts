import type { ConstraintIRNode, ConstraintModelSnapshotV1 } from "@/lib/constraint-ir";
import type { StudioState } from "@/lib/domain";

export type ConstraintBindingEntityType = "CLASS" | "TEACHER" | "ROOM" | "STUDENT";
export type ConstraintBindingStatus = "BOUND" | "MISSING" | "AMBIGUOUS";

export interface ConstraintBindingReference {
  constraintId: string;
  ruleIds: string[];
  entityType: ConstraintBindingEntityType;
  expectedName: string;
  source: string;
  status: ConstraintBindingStatus;
  matchedEntityIds: string[];
}

export interface ConstraintDataBindingReport {
  valid: boolean;
  checkedReferences: number;
  boundReferences: number;
  issues: ConstraintBindingReference[];
  references: ConstraintBindingReference[];
}

type NamedEntity = { id: string; name: string };

type PendingReference = {
  entityType: ConstraintBindingEntityType;
  expectedName: string;
  source: string;
};

export function canonicalBindingName(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function strings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map(String).map((item) => item.trim()).filter(Boolean);
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function add(
  references: PendingReference[],
  entityType: ConstraintBindingEntityType,
  expectedName: string | null,
  source: string,
) {
  if (!expectedName) return;
  references.push({ entityType, expectedName, source });
}

function addMany(
  references: PendingReference[],
  entityType: ConstraintBindingEntityType,
  names: string[],
  source: string,
) {
  for (const name of names) add(references, entityType, name, source);
}

function referencesForNode(node: ConstraintIRNode): PendingReference[] {
  const references: PendingReference[] = [];

  addMany(references, "CLASS", node.selector.classNames ?? [], "selector.classNames");
  addMany(references, "TEACHER", node.selector.teacherNames ?? [], "selector.teacherNames");
  addMany(references, "ROOM", node.selector.roomNames ?? [], "selector.roomNames");
  addMany(references, "STUDENT", node.selector.studentNames ?? [], "selector.studentNames");

  // Relationship selectors currently carry the canonical related student's display name.
  // Treat that as a real planning-data binding instead of allowing the constraint to
  // evaluate vacuously when the relationship target is absent.
  add(references, "STUDENT", stringValue(node.selector.studentRelation), "selector.studentRelation");

  add(references, "TEACHER", stringValue(node.parameters.teacherName), "parameters.teacherName");
  add(references, "ROOM", stringValue(node.parameters.roomName), "parameters.roomName");
  add(references, "CLASS", stringValue(node.parameters.predecessor), "parameters.predecessor");
  add(references, "CLASS", stringValue(node.parameters.successor), "parameters.successor");
  addMany(references, "CLASS", strings(node.parameters.daughterClassNames), "parameters.daughterClassNames");

  // V3 lower-level exceptions are named dancer exceptions. If the dancer cannot be
  // resolved, the exception semantics cannot safely be applied by a solver.
  if (Array.isArray(node.parameters.exceptions)) {
    for (const [index, value] of node.parameters.exceptions.entries()) {
      if (!value || typeof value !== "object" || Array.isArray(value)) continue;
      const exception = value as Record<string, unknown>;
      add(references, "STUDENT", stringValue(exception.studentName), `parameters.exceptions[${index}].studentName`);
    }
  }

  // De-duplicate the same semantic reference when a compiler node intentionally
  // repeats it in both selector and parameters (for example DIRECTLY_AFTER).
  const seen = new Set<string>();
  return references.filter((reference) => {
    const key = `${reference.entityType}|${canonicalBindingName(reference.expectedName)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function entitiesFor(state: StudioState, type: ConstraintBindingEntityType): NamedEntity[] {
  if (type === "CLASS") return state.classes;
  if (type === "TEACHER") return state.teachers;
  if (type === "ROOM") return state.rooms;
  return state.students;
}

function bindReference(
  state: StudioState,
  node: ConstraintIRNode,
  pending: PendingReference,
): ConstraintBindingReference {
  const expected = canonicalBindingName(pending.expectedName);
  const matches = entitiesFor(state, pending.entityType)
    .filter((entity) => canonicalBindingName(entity.name) === expected);
  return {
    constraintId: node.id,
    ruleIds: node.ruleIds,
    entityType: pending.entityType,
    expectedName: pending.expectedName,
    source: pending.source,
    status: matches.length === 1 ? "BOUND" : matches.length === 0 ? "MISSING" : "AMBIGUOUS",
    matchedEntityIds: matches.map((entity) => entity.id).sort(),
  };
}

/**
 * Proves that every concrete named entity referenced by the compiled HARD model
 * resolves to exactly one current Planning Dataset entity.
 *
 * Compiler completeness answers "did we translate the Rulebook?". This report
 * separately answers "does that translation bind to today's planning facts?".
 * Without both, a named constraint can silently become a no-op.
 */
export function validateConstraintModelBindings(
  state: StudioState,
  model: ConstraintModelSnapshotV1,
): ConstraintDataBindingReport {
  const references = model.hardConstraints.flatMap((node) =>
    referencesForNode(node).map((reference) => bindReference(state, node, reference)),
  );
  const issues = references.filter((reference) => reference.status !== "BOUND");
  return {
    valid: issues.length === 0,
    checkedReferences: references.length,
    boundReferences: references.length - issues.length,
    issues,
    references,
  };
}
