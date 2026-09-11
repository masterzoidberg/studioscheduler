import type { ConstraintIRNode, GovernanceAssertionIR, ObjectivePriorityIR } from "@/lib/constraint-ir";
import type { RulebookVersion, StudioRule, StudioState } from "@/lib/domain";
import {
  executionDispositionForRule,
  RULE_EXECUTION_BY_ID,
  type RuleExecutionDisposition,
  type RuleExecutionEntry,
  type RuleExecutionFamily,
} from "@/lib/rule-execution-registry";
import { parseTypedPolicy, type TypedPolicyV1 } from "@/lib/typed-policy";

export const TENANT_POLICY_MANIFEST_KEY = "tenantPolicyManifest" as const;
export const TENANT_POLICY_MANIFEST_SCHEMA_VERSION = "1.0" as const;

export type TenantPolicyRuntimeLayer = RuleExecutionEntry["runtimeLayer"];

export interface TenantRuleProvenanceV1 {
  sourceRuleId: string;
  sourceRulebookVersion: number;
  sourceRulebookId: string | null;
  sourceHash: string | null;
  conversion: "REVIEWED_RULEBOOK_TO_TENANT_RECORDS";
}

export interface TenantRuleRecordV1 {
  schemaVersion: typeof TENANT_POLICY_MANIFEST_SCHEMA_VERSION;
  ruleId: string;
  provenance: TenantRuleProvenanceV1;
  disposition: RuleExecutionDisposition;
  family: RuleExecutionFamily;
  runtimeLayer: TenantPolicyRuntimeLayer;
  rationale: string;
  constraintIds: string[];
  preconditionIds: string[];
  typedPolicy: TypedPolicyV1 | null;
}

export type TenantPreconditionKind =
  | "CLASS_STRUCTURE"
  | "ROSTER_MEMBERSHIP"
  | "ENTITY_EXISTS"
  | "RELATIONSHIP";

export interface TenantPreconditionV1 {
  schemaVersion: typeof TENANT_POLICY_MANIFEST_SCHEMA_VERSION;
  id: string;
  kind: TenantPreconditionKind;
  ruleIds: string[];
  classId?: string;
  expectedFrequency?: number;
  expectedDurations?: number[];
  requiredStudentIds?: string[];
  entityType?: "CLASS" | "TEACHER" | "ROOM" | "STUDENT" | "SESSION";
  entityIds?: string[];
  relationshipKind?: string;
}

export interface TenantPolicyManifestV1 {
  schemaVersion: typeof TENANT_POLICY_MANIFEST_SCHEMA_VERSION;
  sourceRulebookVersion: number;
  sourceRulebookId: string | null;
  sourceHash: string | null;
  activeRuleIds: string[];
  records: TenantRuleRecordV1[];
  constraints: ConstraintIRNode[];
  objectivePrioritySpine: ObjectivePriorityIR[];
  readinessRuleIds: string[];
  governanceAssertions: GovernanceAssertionIR[];
  preconditions: TenantPreconditionV1[];
  conversion: {
    kind: "REVIEWED_RULEBOOK_TO_TENANT_RECORDS";
    sourceVersion: number;
    sourceRuleCount: number;
  };
}

export type TenantPolicyManifestParseResult =
  | { status: "MISSING" }
  | { status: "VALID"; manifest: TenantPolicyManifestV1 }
  | { status: "INVALID"; code: string; message: string; ruleIds: string[] };

export interface TenantClassStructureRequirement {
  classId: string;
  ruleIds: string[];
  expectedFrequency: number;
  expectedDurations: number[] | null;
}

export interface TenantRosterRequirement {
  classId: string;
  studentIds: string[];
  ruleIds: string[];
  relationshipLabel: string;
}

const DISPOSITIONS = new Set<RuleExecutionDisposition>([
  "HARD_CONSTRAINT", "HARD_DATA_PRECONDITION", "FIXED_ANCHOR", "SOFT_OBJECTIVE",
  "DATA_FACT", "EXCEPTION", "INFORMATIONAL", "NO_RUNTIME_EFFECT",
]);
const RUNTIME_LAYERS = new Set<TenantPolicyRuntimeLayer>(["READY_GATE", "CONSTRAINT_IR", "OBJECTIVE_IR", "DATASET", "GOVERNANCE", "HUMAN_REVIEW"]);
const PRECONDITION_KINDS = new Set<TenantPreconditionKind>(["CLASS_STRUCTURE", "ROSTER_MEMBERSHIP", "ENTITY_EXISTS", "RELATIONSHIP"]);
const canonicalString = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const sortStrings = (values: Iterable<string>) => [...new Set(values)].sort(canonicalString);

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort(canonicalString).map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function activeIds(rules: StudioRule[]) {
  return sortStrings(rules.filter((rule) => rule.status === "ACTIVE").map((rule) => rule.id));
}

function runtimeLayerFor(disposition: RuleExecutionDisposition): TenantPolicyRuntimeLayer {
  if (disposition === "HARD_DATA_PRECONDITION") return "READY_GATE";
  if (["HARD_CONSTRAINT", "FIXED_ANCHOR", "EXCEPTION"].includes(disposition)) return "CONSTRAINT_IR";
  if (disposition === "SOFT_OBJECTIVE") return "OBJECTIVE_IR";
  if (disposition === "DATA_FACT") return "DATASET";
  if (disposition === "INFORMATIONAL") return "HUMAN_REVIEW";
  return "GOVERNANCE";
}

function validPrecondition(value: unknown): value is TenantPreconditionV1 {
  const item = record(value);
  if (!item || item.schemaVersion !== TENANT_POLICY_MANIFEST_SCHEMA_VERSION
      || typeof item.id !== "string" || !item.id.trim()
      || typeof item.kind !== "string" || !PRECONDITION_KINDS.has(item.kind as TenantPreconditionKind)
      || !Array.isArray(item.ruleIds) || item.ruleIds.some((id) => typeof id !== "string" || !id.trim())) return false;
  if (item.kind === "CLASS_STRUCTURE") {
    return typeof item.classId === "string" && item.classId.trim().length > 0
      && Number.isInteger(item.expectedFrequency) && Number(item.expectedFrequency) > 0
      && (!Object.prototype.hasOwnProperty.call(item, "expectedDurations") || (Array.isArray(item.expectedDurations) && item.expectedDurations.every((duration) => Number.isInteger(duration) && Number(duration) > 0)));
  }
  if (item.kind === "ROSTER_MEMBERSHIP") {
    return typeof item.classId === "string" && item.classId.trim().length > 0
      && Array.isArray(item.requiredStudentIds) && item.requiredStudentIds.every((id) => typeof id === "string" && id.trim().length > 0);
  }
  if (item.kind === "ENTITY_EXISTS") {
    return typeof item.entityType === "string" && ["CLASS", "TEACHER", "ROOM", "STUDENT", "SESSION"].includes(item.entityType)
      && Array.isArray(item.entityIds) && item.entityIds.length > 0 && item.entityIds.every((id) => typeof id === "string" && id.trim().length > 0);
  }
  return typeof item.relationshipKind === "string" && item.relationshipKind.trim().length > 0
    && Array.isArray(item.entityIds) && item.entityIds.length > 0 && item.entityIds.every((id) => typeof id === "string" && id.trim().length > 0);
}

function validConstraint(value: unknown): value is ConstraintIRNode {
  const item = record(value);
  return Boolean(item && typeof item.id === "string" && item.id.trim()
    && typeof item.kind === "string" && Array.isArray(item.ruleIds)
    && item.ruleIds.length > 0 && item.ruleIds.every((id) => typeof id === "string" && id.trim())
    && record(item.selector) && record(item.parameters) && typeof item.explanation === "string");
}

function parseManifestShape(value: unknown): TenantPolicyManifestV1 | null {
  const item = record(value);
  if (!item || item.schemaVersion !== TENANT_POLICY_MANIFEST_SCHEMA_VERSION
      || typeof item.sourceRulebookVersion !== "number"
      || (item.sourceRulebookId !== null && typeof item.sourceRulebookId !== "string")
      || (item.sourceHash !== null && typeof item.sourceHash !== "string")
      || !Array.isArray(item.activeRuleIds) || !Array.isArray(item.records)
      || !Array.isArray(item.constraints) || !Array.isArray(item.objectivePrioritySpine)
      || !Array.isArray(item.readinessRuleIds) || !Array.isArray(item.governanceAssertions)
      || !Array.isArray(item.preconditions) || !record(item.conversion)) return null;
  const conversion = item.conversion as Record<string, unknown>;
  if (conversion.kind !== "REVIEWED_RULEBOOK_TO_TENANT_RECORDS"
      || conversion.sourceVersion !== item.sourceRulebookVersion
      || typeof conversion.sourceRuleCount !== "number") return null;
  return item as unknown as TenantPolicyManifestV1;
}

export function buildTenantPolicyManifest(input: {
  rulebook: RulebookVersion;
  rules: StudioRule[];
  entries?: RuleExecutionEntry[];
  constraints: ConstraintIRNode[];
  objectivePrioritySpine?: ObjectivePriorityIR[];
  readinessRuleIds?: string[];
  governanceAssertions?: GovernanceAssertionIR[];
  preconditions?: TenantPreconditionV1[];
}): TenantPolicyManifestV1 {
  const rulesById = new Map(input.rules.filter((rule) => rule.status === "ACTIVE").map((rule) => [rule.id, rule]));
  const entriesById = new Map((input.entries ?? [...rulesById.keys()].map((ruleId) => RULE_EXECUTION_BY_ID.get(ruleId)).filter((entry): entry is RuleExecutionEntry => Boolean(entry))).map((entry) => [entry.ruleId, entry]));
  const constraintIdsByRule = new Map<string, string[]>();
  for (const constraint of input.constraints) {
    for (const ruleId of constraint.ruleIds) {
      constraintIdsByRule.set(ruleId, [...(constraintIdsByRule.get(ruleId) ?? []), constraint.id]);
    }
  }
  const preconditionIdsByRule = new Map<string, string[]>();
  for (const precondition of input.preconditions ?? []) {
    for (const ruleId of precondition.ruleIds) {
      preconditionIdsByRule.set(ruleId, [...(preconditionIdsByRule.get(ruleId) ?? []), precondition.id]);
    }
  }

  const records = activeIds(input.rules).map((ruleId) => {
    const rule = rulesById.get(ruleId)!;
    const entry = entriesById.get(ruleId);
    if (!entry) throw new Error(`TENANT_POLICY_EXECUTION_ENTRY_MISSING: active rule ${ruleId} has no disposition/family accounting.`);
    const parsed = parseTypedPolicy(rule);
    return {
      schemaVersion: TENANT_POLICY_MANIFEST_SCHEMA_VERSION,
      ruleId,
      provenance: {
        sourceRuleId: ruleId,
        sourceRulebookVersion: input.rulebook.version,
        sourceRulebookId: input.rulebook.rulebookId ?? null,
        sourceHash: input.rulebook.sourceHash ?? null,
        conversion: "REVIEWED_RULEBOOK_TO_TENANT_RECORDS" as const,
      },
      disposition: entry.disposition,
      family: entry.family,
      runtimeLayer: entry.runtimeLayer,
      rationale: entry.rationale,
      constraintIds: sortStrings(constraintIdsByRule.get(ruleId) ?? []),
      preconditionIds: sortStrings(preconditionIdsByRule.get(ruleId) ?? []),
      typedPolicy: parsed.status === "VALID" ? parsed.policy : null,
    } satisfies TenantRuleRecordV1;
  });

  return {
    schemaVersion: TENANT_POLICY_MANIFEST_SCHEMA_VERSION,
    sourceRulebookVersion: input.rulebook.version,
    sourceRulebookId: input.rulebook.rulebookId ?? null,
    sourceHash: input.rulebook.sourceHash ?? null,
    activeRuleIds: activeIds(input.rules),
    records,
    constraints: [...input.constraints].sort((a, b) => canonicalString(a.id, b.id)),
    objectivePrioritySpine: [...(input.objectivePrioritySpine ?? [])],
    readinessRuleIds: sortStrings(input.readinessRuleIds ?? []),
    governanceAssertions: [...(input.governanceAssertions ?? [])].sort((a, b) => canonicalString(a.ruleId, b.ruleId)),
    preconditions: [...(input.preconditions ?? [])].sort((a, b) => canonicalString(a.id, b.id)),
    conversion: {
      kind: "REVIEWED_RULEBOOK_TO_TENANT_RECORDS",
      sourceVersion: input.rulebook.version,
      sourceRuleCount: activeIds(input.rules).length,
    },
  };
}

export function parseTenantPolicyManifest(
  rulebook: RulebookVersion | null,
  rules: StudioRule[],
): TenantPolicyManifestParseResult {
  const raw = rulebook?.sourceMetadata?.[TENANT_POLICY_MANIFEST_KEY];
  if (raw === undefined) return { status: "MISSING" };
  const manifest = parseManifestShape(raw);
  const fail = (code: string, message: string, ruleIds: string[] = []) => ({ status: "INVALID" as const, code, message, ruleIds: sortStrings(ruleIds) });
  if (!rulebook || !manifest) return fail("TENANT_POLICY_MANIFEST_INVALID", "Tenant Rulebook conversion manifest is malformed.");
  const currentIds = activeIds(rules);
  if (manifest.sourceRulebookVersion !== rulebook.version || manifest.sourceRulebookId !== (rulebook.rulebookId ?? null)
      || manifest.sourceHash !== (rulebook.sourceHash ?? null)) {
    return fail("TENANT_POLICY_MANIFEST_SOURCE_MISMATCH", "Tenant Rulebook conversion manifest is not bound to the current immutable Rulebook source.");
  }
  if (canonical(manifest.activeRuleIds) !== canonical(currentIds)) {
    return fail("TENANT_POLICY_ACTIVE_RULE_SET_MISMATCH", "Tenant Rulebook conversion manifest does not account for exactly the current active Rulebook rule set.", [...manifest.activeRuleIds, ...currentIds]);
  }
  const recordIds = manifest.records.map((item) => item?.ruleId);
  if (manifest.records.length !== currentIds.length || recordIds.some((id) => typeof id !== "string") || canonical(recordIds) !== canonical(currentIds)) {
    return fail("TENANT_POLICY_RECORD_ACCOUNTING_INCOMPLETE", "Each active Rulebook rule must have exactly one tenant disposition/provenance record.", recordIds.filter((id): id is string => typeof id === "string"));
  }
  const ruleIdSet = new Set(currentIds);
  const recordsById = new Map<string, TenantRuleRecordV1>();
  for (const item of manifest.records) {
    const ruleRecord = record(item);
    const provenance = ruleRecord ? record(ruleRecord.provenance) : null;
    if (!ruleRecord || ruleRecord.schemaVersion !== TENANT_POLICY_MANIFEST_SCHEMA_VERSION || typeof ruleRecord.ruleId !== "string"
        || recordsById.has(ruleRecord.ruleId) || !ruleIdSet.has(ruleRecord.ruleId)
        || !provenance || provenance.sourceRuleId !== ruleRecord.ruleId
        || provenance.sourceRulebookVersion !== rulebook.version
        || provenance.sourceRulebookId !== (rulebook.rulebookId ?? null)
        || provenance.sourceHash !== (rulebook.sourceHash ?? null)
        || provenance.conversion !== "REVIEWED_RULEBOOK_TO_TENANT_RECORDS"
        || typeof ruleRecord.family !== "string" || !DISPOSITIONS.has(ruleRecord.disposition as RuleExecutionDisposition)
        || typeof ruleRecord.runtimeLayer !== "string" || !RUNTIME_LAYERS.has(ruleRecord.runtimeLayer as TenantPolicyRuntimeLayer)
        || ruleRecord.runtimeLayer !== runtimeLayerFor(ruleRecord.disposition as RuleExecutionDisposition)
        || typeof ruleRecord.rationale !== "string"
        || !Array.isArray(ruleRecord.constraintIds) || !Array.isArray(ruleRecord.preconditionIds)) {
      return fail("TENANT_POLICY_RECORD_INVALID", `Tenant Rulebook record ${String(ruleRecord?.ruleId ?? "(missing)")} is malformed or has invalid provenance/disposition.`, typeof ruleRecord?.ruleId === "string" ? [ruleRecord.ruleId] : []);
    }
    const expectedRule = rules.find((rule) => rule.id === ruleRecord.ruleId)!;
    const parsed = parseTypedPolicy(expectedRule);
    if (parsed.status === "VALID" && canonical(ruleRecord.typedPolicy) !== canonical(parsed.policy)) {
      return fail("TENANT_POLICY_TYPED_RECORD_MISMATCH", `Tenant typed policy record ${ruleRecord.ruleId} differs from the canonical Rulebook rule.`, [ruleRecord.ruleId]);
    }
    const hard = ["HARD_CONSTRAINT", "FIXED_ANCHOR", "EXCEPTION"].includes(String(ruleRecord.disposition));
    if (hard && ruleRecord.constraintIds.length === 0) {
      return fail("TENANT_POLICY_HARD_RULE_UNACCOUNTED", `HARD Rulebook rule ${ruleRecord.ruleId} has no owned Constraint IR record.`, [ruleRecord.ruleId]);
    }
    if (ruleRecord.disposition === "HARD_DATA_PRECONDITION" && ruleRecord.preconditionIds.length === 0) {
      return fail("TENANT_POLICY_PRECONDITION_UNACCOUNTED", `HARD data precondition ${ruleRecord.ruleId} has no typed precondition record.`, [ruleRecord.ruleId]);
    }
    recordsById.set(ruleRecord.ruleId, ruleRecord as unknown as TenantRuleRecordV1);
  }

  const constraintIds = new Set<string>();
  for (const value of manifest.constraints) {
    if (!validConstraint(value)) return fail("TENANT_POLICY_CONSTRAINT_INVALID", "Tenant conversion manifest contains a malformed Constraint IR record.");
    if (constraintIds.has(value.id)) return fail("TENANT_POLICY_CONSTRAINT_DUPLICATE", `Tenant conversion manifest contains duplicate Constraint IR ${value.id}.`);
    constraintIds.add(value.id);
    const owners = value.ruleIds.filter((ruleId) => ruleIdSet.has(ruleId));
    if (owners.length !== value.ruleIds.length) return fail("TENANT_POLICY_CONSTRAINT_RULE_UNKNOWN", `Constraint IR ${value.id} references a rule outside the active Rulebook.`, value.ruleIds);
    for (const ruleId of owners) {
      if (!recordsById.get(ruleId)!.constraintIds.includes(value.id)) return fail("TENANT_POLICY_CONSTRAINT_OWNERSHIP_MISMATCH", `Constraint IR ${value.id} is not declared by rule ${ruleId}.`, [ruleId]);
    }
  }
  const preconditionIds = new Set<string>();
  for (const value of manifest.preconditions) {
    if (!validPrecondition(value)) return fail("TENANT_POLICY_PRECONDITION_INVALID", "Tenant conversion manifest contains a malformed typed precondition.");
    if (preconditionIds.has(value.id)) return fail("TENANT_POLICY_PRECONDITION_DUPLICATE", `Tenant conversion manifest contains duplicate precondition ${value.id}.`);
    preconditionIds.add(value.id);
    for (const ruleId of value.ruleIds) {
      if (!ruleIdSet.has(ruleId)) return fail("TENANT_POLICY_PRECONDITION_RULE_UNKNOWN", `Precondition ${value.id} references a rule outside the active Rulebook.`, value.ruleIds);
      if (!recordsById.get(ruleId)!.preconditionIds.includes(value.id)) return fail("TENANT_POLICY_PRECONDITION_OWNERSHIP_MISMATCH", `Precondition ${value.id} is not declared by rule ${ruleId}.`, [ruleId]);
    }
  }
  for (const item of manifest.records) {
    if (item.constraintIds.some((id) => !constraintIds.has(id)) || item.preconditionIds.some((id) => !preconditionIds.has(id))) {
      return fail("TENANT_POLICY_RECORD_REFERENCE_MISSING", `Tenant Rulebook record ${item.ruleId} references a missing typed record.`, [item.ruleId]);
    }
  }
  if (manifest.readinessRuleIds.some((id) => !ruleIdSet.has(id)) || manifest.governanceAssertions.some((item) => !ruleIdSet.has(item.ruleId))) {
    return fail("TENANT_POLICY_DERIVED_REFERENCE_UNKNOWN", "Tenant conversion manifest references a rule outside the active Rulebook.");
  }
  return { status: "VALID", manifest };
}

export function currentTenantPolicyManifest(state: StudioState): TenantPolicyManifestV1 | null {
  const current = state.rulebookVersions.find((version) => version.status === "CURRENT") ?? null;
  const parsed = parseTenantPolicyManifest(current, state.rules);
  return parsed.status === "VALID" ? parsed.manifest : null;
}

export function tenantClassStructureRequirements(manifest: TenantPolicyManifestV1 | null): TenantClassStructureRequirement[] {
  return (manifest?.preconditions ?? [])
    .filter((item): item is TenantPreconditionV1 & { kind: "CLASS_STRUCTURE"; classId: string; expectedFrequency: number } => item.kind === "CLASS_STRUCTURE" && Boolean(item.classId) && Number.isInteger(item.expectedFrequency))
    .map((item) => ({ classId: item.classId, ruleIds: sortStrings(item.ruleIds), expectedFrequency: item.expectedFrequency, expectedDurations: item.expectedDurations ? [...item.expectedDurations] : null }));
}

export function tenantRosterRequirements(manifest: TenantPolicyManifestV1 | null): TenantRosterRequirement[] {
  return (manifest?.preconditions ?? [])
    .filter((item): item is TenantPreconditionV1 & { kind: "ROSTER_MEMBERSHIP"; classId: string; requiredStudentIds: string[] } => item.kind === "ROSTER_MEMBERSHIP" && Boolean(item.classId) && Array.isArray(item.requiredStudentIds))
    .map((item) => ({ classId: item.classId, studentIds: sortStrings(item.requiredStudentIds), ruleIds: sortStrings(item.ruleIds), relationshipLabel: item.relationshipKind ?? "Reviewed tenant roster requirement" }));
}

export function tenantExecutionEntryForRule(ruleId: string, manifest: TenantPolicyManifestV1 | null = null): RuleExecutionEntry | null {
  const item = manifest?.records.find((entry) => entry.ruleId === ruleId);
  if (item) return { ruleId: item.ruleId, disposition: item.disposition, family: item.family, runtimeLayer: item.runtimeLayer, rationale: item.rationale };
  return RULE_EXECUTION_BY_ID.get(ruleId) ?? null;
}

export function tenantRulebookConversionSummary(manifest: TenantPolicyManifestV1) {
  const dispositions = new Map<RuleExecutionDisposition, number>();
  for (const item of manifest.records) dispositions.set(item.disposition, (dispositions.get(item.disposition) ?? 0) + 1);
  return {
    sourceRulebookVersion: manifest.sourceRulebookVersion,
    activeRuleCount: manifest.activeRuleIds.length,
    accountedRuleCount: manifest.records.length,
    hardConstraintCount: manifest.records.filter((item) => ["HARD_CONSTRAINT", "FIXED_ANCHOR", "EXCEPTION"].includes(item.disposition)).length,
    typedPreconditionCount: manifest.preconditions.length,
    dispositions: Object.fromEntries([...dispositions.entries()].sort((a, b) => canonicalString(a[0], b[0]))),
  };
}

export function legacyDispositionForRule(ruleId: string) {
  return executionDispositionForRule(ruleId);
}
