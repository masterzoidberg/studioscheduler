import type { ConstraintIRNode, ConstraintModelSnapshotV1 } from "@/lib/constraint-ir";
import type { StudioState } from "@/lib/domain";

export type ConstraintBindingEntityType = "CLASS" | "TEACHER" | "ROOM" | "STUDENT" | "SESSION";
export type ConstraintBindingStatus = "BOUND" | "MISSING" | "AMBIGUOUS";

export interface ConstraintBindingReference {
  constraintId: string;
  ruleIds: string[];
  entityType: ConstraintBindingEntityType;
  expectedName?: string;
  expectedId?: string;
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

export interface ConstraintIdentityMaterialization {
  nodes: ConstraintIRNode[];
  invalidRuleIds: string[];
  changed: boolean;
  issues: ConstraintBindingReference[];
}

type NamedEntity = { id: string; name: string };

type PendingReference = {
  entityType: ConstraintBindingEntityType;
  expectedName?: string;
  expectedId?: string;
  source: string;
};

export function canonicalBindingName(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function strings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map(String).map((item) => item.trim()).filter(Boolean);
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function addName(
  references: PendingReference[],
  entityType: ConstraintBindingEntityType,
  expectedName: string | null,
  source: string,
) {
  if (!expectedName) return;
  references.push({ entityType, expectedName, source });
}

function addNames(
  references: PendingReference[],
  entityType: ConstraintBindingEntityType,
  names: string[],
  source: string,
) {
  for (const name of names) addName(references, entityType, name, source);
}

function addIds(
  references: PendingReference[],
  entityType: ConstraintBindingEntityType,
  ids: string[],
  source: string,
) {
  for (const raw of ids) {
    const expectedId = String(raw).trim();
    if (expectedId) references.push({ entityType, expectedId, source });
  }
}

function referencesForNode(node: ConstraintIRNode): PendingReference[] {
  const references: PendingReference[] = [];

  addIds(references, "CLASS", node.selector.classIds ?? [], "selector.classIds");
  addNames(references, "CLASS", node.selector.classNames ?? [], "selector.classNames");
  addIds(references, "TEACHER", node.selector.teacherIds ?? [], "selector.teacherIds");
  addNames(references, "TEACHER", node.selector.teacherNames ?? [], "selector.teacherNames");
  addIds(references, "ROOM", node.selector.roomIds ?? [], "selector.roomIds");
  addNames(references, "ROOM", node.selector.roomNames ?? [], "selector.roomNames");
  addNames(references, "STUDENT", node.selector.studentNames ?? [], "selector.studentNames");
  addIds(references, "STUDENT", node.selector.participantIds ?? [], "selector.participantIds");
  addIds(references, "SESSION", node.selector.sessionIds ?? [], "selector.sessionIds");

  // Relationship selectors currently carry the canonical related student's display name.
  // Treat that as a real planning-data binding instead of allowing the constraint to
  // evaluate vacuously when the relationship target is absent.
  addName(references, "STUDENT", stringValue(node.selector.studentRelation), "selector.studentRelation");

  addName(references, "TEACHER", stringValue(node.parameters.teacherName), "parameters.teacherName");
  addName(references, "ROOM", stringValue(node.parameters.roomName), "parameters.roomName");
  addName(references, "CLASS", stringValue(node.parameters.predecessor), "parameters.predecessor");
  addName(references, "CLASS", stringValue(node.parameters.successor), "parameters.successor");
  addNames(references, "CLASS", strings(node.parameters.daughterClassNames), "parameters.daughterClassNames");
  addNames(references, "CLASS", strings(node.parameters.exceptionClasses), "parameters.exceptionClasses");
  addIds(references, "TEACHER", [stringValue(node.parameters.teacherId)].filter((value): value is string => Boolean(value)), "parameters.teacherId");
  addIds(references, "ROOM", [stringValue(node.parameters.roomId)].filter((value): value is string => Boolean(value)), "parameters.roomId");
  addIds(references, "CLASS", [stringValue(node.parameters.predecessorClassId), stringValue(node.parameters.successorClassId)].filter((value): value is string => Boolean(value)), "parameters class endpoint");
  addIds(references, "CLASS", strings(node.parameters.daughterClassIds), "parameters.daughterClassIds");
  addIds(references, "CLASS", strings(node.parameters.exceptionClassIds), "parameters.exceptionClassIds");
  addIds(references, "CLASS", strings(node.parameters.classIds), "parameters.classIds");
  addIds(references, "CLASS", strings(node.parameters.exemptClassIds), "parameters.exemptClassIds");
  addIds(references, "SESSION", [stringValue(node.parameters.predecessorSessionId), stringValue(node.parameters.successorSessionId)].filter((value): value is string => Boolean(value)), "parameters session endpoint");
  addIds(references, "STUDENT", [stringValue(node.parameters.participantId)].filter((value): value is string => Boolean(value)), "parameters.participantId");

  // V3 lower-level exceptions are named dancer exceptions. If the dancer cannot be
  // resolved, the exception semantics cannot safely be applied by a solver.
  if (Array.isArray(node.parameters.exceptions)) {
    for (const [index, value] of node.parameters.exceptions.entries()) {
      if (!value || typeof value !== "object" || Array.isArray(value)) continue;
      const exception = value as Record<string, unknown>;
      addName(references, "STUDENT", stringValue(exception.studentName), `parameters.exceptions[${index}].studentName`);
      addIds(references, "STUDENT", [stringValue(exception.participantId)].filter((item): item is string => Boolean(item)), `parameters.exceptions[${index}].participantId`);
    }
  }

  // De-duplicate the same semantic reference when a compiler node intentionally
  // repeats it in both selector and parameters. Stable IDs and display names are
  // deliberately distinct keys during the transition so a node cannot hide a bad
  // typed ID behind a coincidentally matching legacy name.
  const seen = new Set<string>();
  return references.filter((reference) => {
    const key = reference.expectedId
      ? `${reference.entityType}|ID|${reference.expectedId}`
      : `${reference.entityType}|NAME|${canonicalBindingName(reference.expectedName || "")}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function entitiesFor(state: StudioState, type: ConstraintBindingEntityType): NamedEntity[] {
  if (type === "CLASS") return state.classes;
  if (type === "TEACHER") return state.teachers;
  if (type === "ROOM") return state.rooms;
  if (type === "STUDENT") return state.students;
  return state.sessions.map((session) => ({ id: session.id, name: session.id }));
}

function bindReference(
  state: StudioState,
  node: ConstraintIRNode,
  pending: PendingReference,
): ConstraintBindingReference {
  const entities = entitiesFor(state, pending.entityType);
  const matches = pending.expectedId
    ? entities.filter((entity) => entity.id === pending.expectedId)
    : entities.filter((entity) => canonicalBindingName(entity.name) === canonicalBindingName(pending.expectedName || ""));
  return {
    constraintId: node.id,
    ruleIds: node.ruleIds,
    entityType: pending.entityType,
    ...(pending.expectedId ? { expectedId: pending.expectedId } : { expectedName: pending.expectedName || "" }),
    source: pending.source,
    status: matches.length === 1 ? "BOUND" : matches.length === 0 ? "MISSING" : "AMBIGUOUS",
    matchedEntityIds: matches.map((entity) => entity.id).sort(),
  };
}

function referenceForName(
  state: StudioState,
  node: ConstraintIRNode,
  entityType: ConstraintBindingEntityType,
  expectedName: string,
  source: string,
): ConstraintBindingReference {
  return bindReference(state, node, { entityType, expectedName, source });
}

function referenceForId(
  state: StudioState,
  node: ConstraintIRNode,
  entityType: ConstraintBindingEntityType,
  expectedId: string,
  source: string,
): ConstraintBindingReference {
  return bindReference(state, node, { entityType, expectedId, source });
}

function materializeName(
  state: StudioState,
  node: ConstraintIRNode,
  entityType: ConstraintBindingEntityType,
  name: string,
  source: string,
  issues: ConstraintBindingReference[],
): string | null {
  const reference = referenceForName(state, node, entityType, name, source);
  if (reference.status !== "BOUND") {
    issues.push(reference);
    return null;
  }
  return reference.matchedEntityIds[0] || null;
}

function materializeNames(
  state: StudioState,
  node: ConstraintIRNode,
  entityType: ConstraintBindingEntityType,
  names: string[],
  source: string,
  issues: ConstraintBindingReference[],
): string[] | null {
  const canonicalNames = names.map(canonicalBindingName);
  if (new Set(canonicalNames).size !== canonicalNames.length) {
    for (const [index, name] of names.entries()) {
      issues.push({
        ...referenceForName(state, node, entityType, name, `${source}[${index}]`),
        status: "AMBIGUOUS",
        matchedEntityIds: [],
      });
    }
    return null;
  }
  const ids = names.map((name, index) => materializeName(state, node, entityType, name, `${source}[${index}]`, issues));
  return ids.every((id): id is string => Boolean(id)) ? ids : null;
}

function validateIds(
  state: StudioState,
  node: ConstraintIRNode,
  entityType: ConstraintBindingEntityType,
  ids: string[],
  source: string,
  issues: ConstraintBindingReference[],
) {
  if (new Set(ids).size !== ids.length) {
    for (const [index, id] of ids.entries()) {
      issues.push({
        ...referenceForId(state, node, entityType, id, `${source}[${index}]`),
        status: "AMBIGUOUS",
        matchedEntityIds: [],
      });
    }
    return;
  }
  for (const [index, id] of ids.entries()) {
    const reference = referenceForId(state, node, entityType, id, `${source}[${index}]`);
    if (reference.status !== "BOUND") issues.push(reference);
  }
}

function idsMatch(left: string[] | undefined, right: string[] | null) {
  if (!left?.length || !right || left.length !== right.length) return false;
  const leftSorted = [...left].sort();
  const rightSorted = [...right].sort();
  return leftSorted.every((id, index) => id === rightSorted[index]);
}

function addIdentityConflict(
  state: StudioState,
  node: ConstraintIRNode,
  entityType: ConstraintBindingEntityType,
  expectedId: string,
  source: string,
  issues: ConstraintBindingReference[],
) {
  issues.push({
    ...referenceForId(state, node, entityType, expectedId, source),
    status: "AMBIGUOUS",
    matchedEntityIds: [],
  });
}

function materializeSelector(
  state: StudioState,
  node: ConstraintIRNode,
  issues: ConstraintBindingReference[],
) {
  const selector = { ...node.selector };
  const classNames = selector.classNames;
  const teacherNames = selector.teacherNames;
  const roomNames = selector.roomNames;
  const studentNames = selector.studentNames;
  const existingClassIds = selector.classIds?.slice();
  const existingTeacherIds = selector.teacherIds?.slice();
  const existingRoomIds = selector.roomIds?.slice();
  const existingParticipantIds = selector.participantIds?.slice();

  delete selector.classNames;
  delete selector.teacherNames;
  delete selector.roomNames;
  delete selector.studentNames;
  delete selector.studentRelation;

  if (existingClassIds?.length) validateIds(state, node, "CLASS", existingClassIds, "selector.classIds", issues);
  if (existingTeacherIds?.length) validateIds(state, node, "TEACHER", existingTeacherIds, "selector.teacherIds", issues);
  if (existingRoomIds?.length) validateIds(state, node, "ROOM", existingRoomIds, "selector.roomIds", issues);
  if (existingParticipantIds?.length) validateIds(state, node, "STUDENT", existingParticipantIds, "selector.participantIds", issues);

  const materializedClassIds = classNames?.length
    ? materializeNames(state, node, "CLASS", classNames, "selector.classNames", issues)
    : null;
  const materializedTeacherIds = teacherNames?.length
    ? materializeNames(state, node, "TEACHER", teacherNames, "selector.teacherNames", issues)
    : null;
  const materializedRoomIds = roomNames?.length
    ? materializeNames(state, node, "ROOM", roomNames, "selector.roomNames", issues)
    : null;
  const materializedParticipantIds = studentNames?.length
    ? materializeNames(state, node, "STUDENT", studentNames, "selector.studentNames", issues)
    : null;

  if (materializedClassIds) {
    if (existingClassIds?.length && !idsMatch(existingClassIds, materializedClassIds)) addIdentityConflict(state, node, "CLASS", existingClassIds[0], "selector.classIds", issues);
    else selector.classIds = existingClassIds?.length ? existingClassIds : materializedClassIds;
  }
  if (materializedTeacherIds) {
    if (existingTeacherIds?.length && !idsMatch(existingTeacherIds, materializedTeacherIds)) addIdentityConflict(state, node, "TEACHER", existingTeacherIds[0], "selector.teacherIds", issues);
    else selector.teacherIds = existingTeacherIds?.length ? existingTeacherIds : materializedTeacherIds;
  }
  if (materializedRoomIds) {
    if (existingRoomIds?.length && !idsMatch(existingRoomIds, materializedRoomIds)) addIdentityConflict(state, node, "ROOM", existingRoomIds[0], "selector.roomIds", issues);
    else selector.roomIds = existingRoomIds?.length ? existingRoomIds : materializedRoomIds;
  }
  if (materializedParticipantIds) {
    if (existingParticipantIds?.length && !idsMatch(existingParticipantIds, materializedParticipantIds)) addIdentityConflict(state, node, "STUDENT", existingParticipantIds[0], "selector.participantIds", issues);
    else selector.participantIds = existingParticipantIds?.length ? existingParticipantIds : materializedParticipantIds;
  }

  if (selector.classIds) validateIds(state, node, "CLASS", selector.classIds, "selector.classIds", issues);
  if (selector.teacherIds) validateIds(state, node, "TEACHER", selector.teacherIds, "selector.teacherIds", issues);
  if (selector.roomIds) validateIds(state, node, "ROOM", selector.roomIds, "selector.roomIds", issues);
  if (selector.participantIds) validateIds(state, node, "STUDENT", selector.participantIds, "selector.participantIds", issues);
  if (selector.sessionIds) validateIds(state, node, "SESSION", selector.sessionIds, "selector.sessionIds", issues);

  return selector;
}

function materializeParameters(
  state: StudioState,
  node: ConstraintIRNode,
  issues: ConstraintBindingReference[],
) {
  const parameters = { ...node.parameters };
  const teacherName = stringValue(parameters.teacherName);
  const roomName = stringValue(parameters.roomName);
  const predecessor = stringValue(parameters.predecessor);
  const successor = stringValue(parameters.successor);
  const daughterClassNames = strings(parameters.daughterClassNames);
  const exceptionClasses = strings(parameters.exceptionClasses);
  const existingTeacherId = stringValue(parameters.teacherId);
  const existingRoomId = stringValue(parameters.roomId);
  const existingPredecessorClassId = stringValue(parameters.predecessorClassId);
  const existingSuccessorClassId = stringValue(parameters.successorClassId);
  const existingDaughterClassIds = strings(parameters.daughterClassIds);
  const existingExceptionClassIds = strings(parameters.exceptionClassIds);
  const existingClassIds = strings(parameters.classIds);
  const existingExemptClassIds = strings(parameters.exemptClassIds);
  const existingParticipantId = stringValue(parameters.participantId);

  delete parameters.teacherName;
  delete parameters.roomName;
  delete parameters.predecessor;
  delete parameters.successor;
  delete parameters.daughterClassNames;
  delete parameters.exceptionClasses;

  if (existingDaughterClassIds.length) validateIds(state, node, "CLASS", existingDaughterClassIds, "parameters.daughterClassIds", issues);
  if (existingExceptionClassIds.length) validateIds(state, node, "CLASS", existingExceptionClassIds, "parameters.exceptionClassIds", issues);
  if (existingClassIds.length) validateIds(state, node, "CLASS", existingClassIds, "parameters.classIds", issues);
  if (existingExemptClassIds.length) validateIds(state, node, "CLASS", existingExemptClassIds, "parameters.exemptClassIds", issues);
  for (const [entityType, expectedId, source] of [
    ["TEACHER", existingTeacherId, "parameters.teacherId"],
    ["ROOM", existingRoomId, "parameters.roomId"],
    ["CLASS", existingPredecessorClassId, "parameters.predecessorClassId"],
    ["CLASS", existingSuccessorClassId, "parameters.successorClassId"],
    ["STUDENT", existingParticipantId, "parameters.participantId"],
  ] as const) {
    if (!expectedId) continue;
    const reference = referenceForId(state, node, entityType, expectedId, source);
    if (reference.status !== "BOUND") issues.push(reference);
  }
  for (const [key, source] of [
    ["predecessorSessionId", "parameters.predecessorSessionId"],
    ["successorSessionId", "parameters.successorSessionId"],
  ] as const) {
    const expectedId = stringValue(parameters[key]);
    if (!expectedId) continue;
    const reference = referenceForId(state, node, "SESSION", expectedId, source);
    if (reference.status !== "BOUND") issues.push(reference);
  }

  if (teacherName) {
    const materialized = materializeName(state, node, "TEACHER", teacherName, "parameters.teacherName", issues);
    if (existingTeacherId && materialized && existingTeacherId !== materialized) addIdentityConflict(state, node, "TEACHER", existingTeacherId, "parameters.teacherId", issues);
    parameters.teacherId = existingTeacherId || materialized || "";
  }
  if (roomName) {
    const materialized = materializeName(state, node, "ROOM", roomName, "parameters.roomName", issues);
    if (existingRoomId && materialized && existingRoomId !== materialized) addIdentityConflict(state, node, "ROOM", existingRoomId, "parameters.roomId", issues);
    parameters.roomId = existingRoomId || materialized || "";
  }
  if (predecessor) {
    const materialized = materializeName(state, node, "CLASS", predecessor, "parameters.predecessor", issues);
    if (existingPredecessorClassId && materialized && existingPredecessorClassId !== materialized) addIdentityConflict(state, node, "CLASS", existingPredecessorClassId, "parameters.predecessorClassId", issues);
    parameters.predecessorClassId = existingPredecessorClassId || materialized || "";
  }
  if (successor) {
    const materialized = materializeName(state, node, "CLASS", successor, "parameters.successor", issues);
    if (existingSuccessorClassId && materialized && existingSuccessorClassId !== materialized) addIdentityConflict(state, node, "CLASS", existingSuccessorClassId, "parameters.successorClassId", issues);
    parameters.successorClassId = existingSuccessorClassId || materialized || "";
  }
  if (daughterClassNames.length) {
    const materialized = materializeNames(state, node, "CLASS", daughterClassNames, "parameters.daughterClassNames", issues);
    if (existingDaughterClassIds.length && !idsMatch(existingDaughterClassIds, materialized)) addIdentityConflict(state, node, "CLASS", existingDaughterClassIds[0], "parameters.daughterClassIds", issues);
    else parameters.daughterClassIds = existingDaughterClassIds.length ? existingDaughterClassIds : materialized || [];
  }
  if (exceptionClasses.length) {
    const materialized = materializeNames(state, node, "CLASS", exceptionClasses, "parameters.exceptionClasses", issues);
    if (existingExceptionClassIds.length && !idsMatch(existingExceptionClassIds, materialized)) addIdentityConflict(state, node, "CLASS", existingExceptionClassIds[0], "parameters.exceptionClassIds", issues);
    else parameters.exceptionClassIds = existingExceptionClassIds.length ? existingExceptionClassIds : materialized || [];
  }

  if (typeof node.selector.studentRelation === "string" && node.selector.studentRelation.trim()) {
    const materialized = materializeName(state, node, "STUDENT", node.selector.studentRelation, "selector.studentRelation", issues);
    if (existingParticipantId && materialized && existingParticipantId !== materialized) addIdentityConflict(state, node, "STUDENT", existingParticipantId, "parameters.participantId", issues);
    parameters.participantId = existingParticipantId || materialized || "";
  }

  if (Array.isArray(parameters.exceptions)) {
    parameters.exceptions = parameters.exceptions.map((value, index) => {
      if (!value || typeof value !== "object" || Array.isArray(value)) return value;
      const exception = { ...(value as Record<string, unknown>) };
      const studentName = stringValue(exception.studentName);
      const participantId = stringValue(exception.participantId);
      delete exception.studentName;
      if (participantId) {
        const reference = referenceForId(state, node, "STUDENT", participantId, `parameters.exceptions[${index}].participantId`);
        if (reference.status !== "BOUND") issues.push(reference);
      }
      if (studentName) {
        const materialized = materializeName(state, node, "STUDENT", studentName, `parameters.exceptions[${index}].studentName`, issues);
        if (participantId && materialized && participantId !== materialized) addIdentityConflict(state, node, "STUDENT", participantId, `parameters.exceptions[${index}].participantId`, issues);
        exception.participantId = participantId || materialized || "";
      }
      return exception;
    });
  }

  return parameters;
}

/**
 * Materializes reviewed legacy DWDE target labels into current planning IDs.
 * Historical snapshots remain readable by the name-compatible runtime; current
 * canonical models do not carry name-bound target dispatch.
 */
export function materializeConstraintIdentityTargets(
  state: StudioState,
  nodes: ConstraintIRNode[],
): ConstraintIdentityMaterialization {
  const issues: ConstraintBindingReference[] = [];
  const invalidRuleIds = new Set<string>();
  let changed = false;
  const materialized = nodes.flatMap((node) => {
    const before = JSON.stringify({ selector: node.selector, parameters: node.parameters });
    const selector = materializeSelector(state, node, issues);
    const parameters = materializeParameters(state, node, issues);
    for (const [parameterKey, selectorKey] of [
      ["teacherId", "teacherIds"],
      ["roomId", "roomIds"],
      ["participantId", "participantIds"],
    ] as const) {
      const id = parameters[parameterKey];
      if (typeof id !== "string" || !id) continue;
      const selected = selector[selectorKey];
      if (selected?.length && (selected.length !== 1 || selected[0] !== id)) {
        issues.push({
          ...referenceForId(state, node, selectorKey === "teacherIds" ? "TEACHER" : selectorKey === "roomIds" ? "ROOM" : "STUDENT", id, `parameters.${parameterKey}`),
          status: "AMBIGUOUS",
          matchedEntityIds: [],
        });
      } else if (!selected?.length) {
        selector[selectorKey] = [id];
      }
    }
    const nodeIssues = issues.filter((issue) => issue.constraintId === node.id);
    if (nodeIssues.length) {
      node.ruleIds.forEach((ruleId) => invalidRuleIds.add(ruleId));
      return [];
    }
    const next = { ...node, selector, parameters };
    changed = changed || before !== JSON.stringify({ selector, parameters });
    return [next];
  });

  return {
    nodes: materialized,
    invalidRuleIds: [...invalidRuleIds].sort(),
    changed,
    issues,
  };
}

/**
 * Proves that every concrete entity referenced by the compiled HARD model
 * resolves to exactly one current Planning Dataset entity.
 *
 * Legacy constraints may still bind by reviewed display name while typed policy
 * binds by stable ID. Compiler completeness answers "did we translate the
 * Rulebook?"; this report separately answers "does that translation bind to
 * today's planning facts?". Without both, a constraint can silently become a
 * no-op.
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
