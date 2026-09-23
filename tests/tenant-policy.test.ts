import { describe, expect, it } from "vitest";
import type { ConstraintIRNode } from "@/lib/constraint-ir";
import type { RulebookVersion, StudioRule } from "@/lib/domain";
import {
  buildTenantPolicyManifest,
  parseTenantPolicyManifest,
  tenantRulebookConversionSummary,
} from "@/lib/tenant-policy";
import { ruleExecutionCoverage } from "@/lib/rule-execution-registry";
import { compileConstraintModel } from "@/lib/constraint-compiler-v3";
import type { StudioState } from "@/lib/domain";
import { evaluateScheduleReadiness } from "@/lib/schedule-readiness";

function rule(id: string, parameters: Record<string, unknown> = {}): StudioRule {
  return {
    id, category: "TEST", type: null, title: id, description: `${id} policy`, strength: "HARD",
    classificationRaw: "HARD", status: "ACTIVE", verificationStatus: "VERIFIED", reviewStatus: "VERIFIED",
    review: { decision: "APPROVED", verified: true }, affectedEntityIds: [], parameters, exceptions: [],
    source: { type: "IMPORT" }, sourceRaw: { sourceRuleId: id }, versionIntroduced: 1, updatedAt: "2026-09-11T00:00:00Z",
  };
}

const rulebook: RulebookVersion = {
  id: "rulebook-tenant", version: 8, name: "Tenant Rulebook", createdAt: "2026-09-11", actor: "test",
  reason: "conversion", changedRuleIds: [], rulebookId: "tenant-rulebook", status: "CURRENT", sourceHash: "a".repeat(64),
};

const constraint: ConstraintIRNode = {
  id: "tenant-time-grid", kind: "TIME_GRID", ruleIds: ["TENANT-001"], selector: {},
  parameters: { minutes: 15 }, explanation: "Tenant time grid",
};

function converted() {
  const rules = [rule("TENANT-001"), rule("TENANT-002")];
  const precondition = {
    schemaVersion: "1.0" as const, id: "tenant-class-structure", kind: "CLASS_STRUCTURE" as const,
    ruleIds: ["TENANT-002"], classId: "class-1", expectedFrequency: 1, expectedDurations: [60],
  };
  const manifest = buildTenantPolicyManifest({
    rulebook, rules,
    entries: [
      { ruleId: "TENANT-001", disposition: "HARD_CONSTRAINT", family: "ROOM_POLICY", runtimeLayer: "CONSTRAINT_IR", rationale: "Room legality" },
      { ruleId: "TENANT-002", disposition: "HARD_DATA_PRECONDITION", family: "CLASS_STRUCTURE", runtimeLayer: "READY_GATE", rationale: "Class structure" },
    ],
    constraints: [constraint], preconditions: [precondition], readinessRuleIds: ["TENANT-002"],
  });
  const current = { ...rulebook, sourceMetadata: { tenantPolicyManifest: manifest } };
  return { rules, manifest, current };
}

function genericReadinessState() {
  const value = converted();
  const state: StudioState = {
    studioId: "tenant",
    studioName: "Tenant",
    teachers: [{ id: "teacher-1", name: "Teacher One", subjects: ["Science"] }],
    rooms: [{ id: "room-1", name: "Room One", capacity: 12, features: [] }],
    students: [{ id: "student-1", name: "Karly's daughter", level: "Level 9", cohortIds: [] }],
    cohorts: [],
    classes: [{
      id: "class-1", name: "Science Lab", subject: "Science", level: "Level 9", durationMinutes: 60,
      weeklyFrequency: 1, rosterStudentIds: ["student-1"], eligibleTeacherIds: ["teacher-1"], companyOnly: false,
    }],
    sessions: [{ id: "session-1", classId: "class-1", ordinal: 1, durationMinutes: 60, locked: false }],
    rules: value.rules,
    rulebookVersions: [value.current],
    enforcementVersions: [{ id: "enforcement-1", version: 1, rulebookVersion: value.current.version, createdAt: "2026-09-11", actor: "test", reason: "test", changedRuleIds: [], snapshot: [], status: "CURRENT" }],
    enforcementProposals: [],
    ruleHistory: [],
    scheduleVersions: [{ id: "schedule-1", version: 1, rulebookVersion: value.current.version, enforcementVersion: 1, planningDatasetVersion: 1, createdAt: "2026-09-11", actor: "test", reason: "test", assignments: [], isCurrent: true }],
    scenarios: [],
    auditEvents: [],
  };
  return { state, value };
}

describe("tenant Rulebook policy conversion", () => {
  it("accounts for every active rule with immutable provenance and typed preconditions", () => {
    const value = converted();
    expect(parseTenantPolicyManifest(value.current, value.rules)).toMatchObject({ status: "VALID" });
    expect(ruleExecutionCoverage(value.rules, value.manifest)).toMatchObject({ activeRules: 2, accountedRules: 2, complete: true });
    expect(tenantRulebookConversionSummary(value.manifest)).toMatchObject({ activeRuleCount: 2, accountedRuleCount: 2, typedPreconditionCount: 1 });
  });

  it("rejects lost rule accounting, provenance drift, and hard rules without typed meaning", () => {
    const value = converted();
    const missingRecord = structuredClone(value.manifest);
    missingRecord.records = missingRecord.records.slice(0, 1);
    expect(parseTenantPolicyManifest({ ...value.current, sourceMetadata: { tenantPolicyManifest: missingRecord } }, value.rules)).toMatchObject({ status: "INVALID", code: "TENANT_POLICY_RECORD_ACCOUNTING_INCOMPLETE" });

    const drifted = structuredClone(value.manifest);
    drifted.records[0].provenance.sourceRulebookVersion = 7;
    expect(parseTenantPolicyManifest({ ...value.current, sourceMetadata: { tenantPolicyManifest: drifted } }, value.rules)).toMatchObject({ status: "INVALID", code: "TENANT_POLICY_RECORD_INVALID" });

    const unowned = structuredClone(value.manifest);
    unowned.records[0].constraintIds = [];
    expect(parseTenantPolicyManifest({ ...value.current, sourceMetadata: { tenantPolicyManifest: unowned } }, value.rules)).toMatchObject({ status: "INVALID", code: "TENANT_POLICY_HARD_RULE_UNACCOUNTED" });

    const downgraded = structuredClone(value.manifest);
    downgraded.records[0].disposition = "SOFT_OBJECTIVE";
    downgraded.records[0].runtimeLayer = "OBJECTIVE_IR";
    expect(parseTenantPolicyManifest({ ...value.current, sourceMetadata: { tenantPolicyManifest: downgraded } }, value.rules)).toMatchObject({ status: "INVALID", code: "TENANT_POLICY_HARD_RULE_UNACCOUNTED" });

    const nameBound = structuredClone(value.manifest);
    nameBound.constraints[0].selector = { teacherNames: ["Teacher One"] };
    expect(parseTenantPolicyManifest({ ...value.current, sourceMetadata: { tenantPolicyManifest: nameBound } }, value.rules)).toMatchObject({ status: "INVALID", code: "TENANT_POLICY_CONSTRAINT_IDENTITY_UNRESOLVED" });

    const wrongCount = structuredClone(value.manifest);
    wrongCount.conversion.sourceRuleCount = 99;
    expect(parseTenantPolicyManifest({ ...value.current, sourceMetadata: { tenantPolicyManifest: wrongCount } }, value.rules)).toMatchObject({ status: "INVALID", code: "TENANT_POLICY_ACTIVE_RULE_SET_MISMATCH" });

    const malformedPrecondition = structuredClone(value.manifest);
    malformedPrecondition.preconditions[0].expectedDurations = [];
    expect(parseTenantPolicyManifest({ ...value.current, sourceMetadata: { tenantPolicyManifest: malformedPrecondition } }, value.rules)).toMatchObject({ status: "INVALID", code: "TENANT_POLICY_PRECONDITION_INVALID" });

    const extraPreconditionField = structuredClone(value.manifest);
    (extraPreconditionField.preconditions[0] as unknown as Record<string, unknown>).entityType = "CLASS";
    expect(parseTenantPolicyManifest({ ...value.current, sourceMetadata: { tenantPolicyManifest: extraPreconditionField } }, value.rules)).toMatchObject({ status: "INVALID", code: "TENANT_POLICY_PRECONDITION_INVALID" });

    const softOwner = structuredClone(value.manifest);
    softOwner.records[0].disposition = "SOFT_OBJECTIVE";
    softOwner.records[0].runtimeLayer = "OBJECTIVE_IR";
    const softRule = { ...value.rules[0], strength: "LIGHT" as const, classificationRaw: "PREFER" };
    expect(parseTenantPolicyManifest({ ...value.current, sourceMetadata: { tenantPolicyManifest: softOwner } }, [softRule, value.rules[1]])).toMatchObject({ status: "INVALID", code: "TENANT_POLICY_CONSTRAINT_DISPOSITION_MISMATCH" });
  });

  it("stores the canonical typed-policy projection when source JSON array order differs", () => {
    const sourceRule = rule("TENANT-003", {
      policy: {
        schemaVersion: "1.0",
        kind: "TEACHER_DAY_WINDOW",
        teacherId: "teacher-1",
        allowedDays: ["Thursday", "Monday", "Wednesday", "Tuesday"],
        unavailableDays: [],
      },
    });
    const sourceConstraint = { ...constraint, id: "tenant-teacher-window", ruleIds: [sourceRule.id] };
    const manifest = buildTenantPolicyManifest({
      rulebook,
      rules: [sourceRule],
      entries: [{ ruleId: sourceRule.id, disposition: "HARD_CONSTRAINT", family: "TEACHER_POLICY", runtimeLayer: "CONSTRAINT_IR", rationale: "Tenant teacher legality" }],
      constraints: [sourceConstraint],
    });

    expect(manifest.records[0].typedPolicy).toMatchObject({
      kind: "TEACHER_DAY_WINDOW",
      allowedDays: ["Monday", "Tuesday", "Wednesday", "Thursday"],
    });
    expect(parseTenantPolicyManifest({ ...rulebook, sourceMetadata: { tenantPolicyManifest: manifest } }, [sourceRule])).toMatchObject({ status: "VALID" });
  });

  it("does not use the legacy fixed registry for a converted tenant rule set", () => {
    const value = converted();
    expect(ruleExecutionCoverage(value.rules, value.manifest).unknownRuleIds).toEqual([]);
    expect(ruleExecutionCoverage(value.rules).complete).toBe(false);
  });

  it("compiles the converted manifest without named or fixed-DWDE dispatch", () => {
    const value = converted();
    const state = {
      studioId: "tenant", studioName: "Tenant", teachers: [], rooms: [], students: [], cohorts: [], classes: [], sessions: [],
      rules: value.rules, rulebookVersions: [value.current], enforcementVersions: [], enforcementProposals: [], ruleHistory: [],
      scheduleVersions: [], scenarios: [], auditEvents: [], planningDatasetVersions: [],
    } satisfies StudioState;
    const model = compileConstraintModel(state);
    expect(model.compilerVersion).toBe("dwde-ir-0.9");
    expect(model.activeRuleCount).toBe(2);
    expect(model.hardConstraints).toContainEqual(constraint);
    expect(model.completeHardConstraintCompilation).toBe(true);
  });

  it("uses arbitrary tenant IDs for readiness and does not run named DWDE checks", () => {
    const { state } = genericReadinessState();
    state.classes[0].name = "Tap 1";
    state.classes[0].companyOnly = true;
    state.planningDatasetVersions = [{
      id: "planning-1", version: 1, createdAt: "2026-09-11", actor: "test", reason: "test",
      snapshot: {
        schemaVersion: "1.3", studioId: state.studioId, teacherIds: ["teacher-1"],
        teachers: [{ id: "teacher-1", name: "Teacher One" }],
        rooms: [{ id: "room-1", name: "Room One", capacity: 12, features: [] }],
        students: [{ id: "student-1", name: "Karly's daughter", level: "Level 9", cohortIds: [] }],
        cohorts: [],
        classes: [{ id: "class-1", name: "Science Lab", subject: "Science", level: "Level 9", durationMinutes: 60, weeklyFrequency: 1, rosterStudentIds: ["student-1"], companyOnly: false }],
        sessions: [{ id: "session-1", classId: "class-1", ordinal: 1, durationMinutes: 60, locked: false }],
      },
      snapshotHash: "0".repeat(64), status: "CURRENT", confirmedForSchedulingAt: "2026-09-11T00:00:00Z",
    }];
    state.planningDatasetVersions[0].snapshot.sourceManifest = {
      version: 1,
      snapshotHash: "1".repeat(64),
      complete: true,
      snapshot: {
        schemaVersion: "1.0",
        sources: [],
        classes: [{ id: "class-1", name: "Tap 1", weeklyFrequency: 2, sessionDurations: [45, 45], rosterStudentIds: [] }],
      },
    };

    const report = evaluateScheduleReadiness(state);
    expect(report.ruleCoverage).toMatchObject({ activeRules: 2, accountedRules: 2, complete: true });
    expect(report.blockers.some((issue) => issue.code.startsWith("KARLY_") || issue.code.startsWith("ADVANCED_BALLET_"))).toBe(false);
    expect(report.blockers.some((issue) => issue.code === "MISSING_REQUIRED_CLASS")).toBe(false);
    expect(report.blockers.some((issue) => issue.code === "CLASS_DURATION_MISMATCH")).toBe(false);
    expect(report.blockers.some((issue) => issue.code === "TAP_1_COMPANY_ONLY_ERROR")).toBe(false);
    expect(report.warnings.filter((issue) => issue.code.startsWith("SOURCE_MANIFEST_")).every((issue) => issue.ruleIds.length === 0)).toBe(true);
  });

  it("blocks a converted tenant policy when a typed precondition entity disappears", () => {
    const { state } = genericReadinessState();
    state.classes = [];
    state.planningDatasetVersions = [{
      id: "planning-1", version: 1, createdAt: "2026-09-11", actor: "test", reason: "test",
      snapshot: {
        schemaVersion: "1.3", studioId: state.studioId, teacherIds: ["teacher-1"],
        teachers: [{ id: "teacher-1", name: "Teacher One" }], rooms: [{ id: "room-1", name: "Room One", capacity: 12, features: [] }],
        students: [], cohorts: [],
        classes: [{ id: "class-1", name: "Science Lab", subject: "Science", level: "Level 9", durationMinutes: 60, weeklyFrequency: 1, rosterStudentIds: ["student-1"], companyOnly: false }],
        sessions: [{ id: "session-1", classId: "class-1", ordinal: 1, durationMinutes: 60, locked: false }],
      },
      snapshotHash: "0".repeat(64), status: "CURRENT", confirmedForSchedulingAt: "2026-09-11T00:00:00Z",
    }];

    const report = evaluateScheduleReadiness(state);
    expect(report.blockers).toContainEqual(expect.objectContaining({ code: "MISSING_REQUIRED_CLASS", ruleIds: ["TENANT-002"] }));
  });

  it("blocks ambiguous stable IDs in converted tenant preconditions", () => {
    const { state } = genericReadinessState();
    state.classes.push({ ...state.classes[0], name: "Science Lab duplicate" });
    state.planningDatasetVersions = [{
      id: "planning-1", version: 1, createdAt: "2026-09-11", actor: "test", reason: "test",
      snapshot: {
        schemaVersion: "1.3", studioId: state.studioId, teacherIds: ["teacher-1"],
        teachers: [{ id: "teacher-1", name: "Teacher One" }], rooms: [{ id: "room-1", name: "Room One", capacity: 12, features: [] }],
        students: [{ id: "student-1", name: "Karly's daughter", level: "Level 9", cohortIds: [] }], cohorts: [],
        classes: [{ id: "class-1", name: "Science Lab", subject: "Science", level: "Level 9", durationMinutes: 60, weeklyFrequency: 1, rosterStudentIds: ["student-1"], companyOnly: false }],
        sessions: [{ id: "session-1", classId: "class-1", ordinal: 1, durationMinutes: 60, locked: false }],
      },
      snapshotHash: "0".repeat(64), status: "CURRENT", confirmedForSchedulingAt: "2026-09-11T00:00:00Z",
    }];

    const report = evaluateScheduleReadiness(state);
    expect(report.blockers).toContainEqual(expect.objectContaining({ code: "TENANT_POLICY_ENTITY_AMBIGUOUS", ruleIds: ["TENANT-002"] }));
  });

  it("fails closed for an invalid manifest instead of falling back to static semantics", () => {
    const { state, value } = genericReadinessState();
    const invalid = structuredClone(value.manifest);
    invalid.records[0].provenance.sourceRulebookVersion = 7;
    state.rulebookVersions = [{ ...value.current, sourceMetadata: { tenantPolicyManifest: invalid } }];
    const report = evaluateScheduleReadiness(state);
    expect(report.blockers).toContainEqual(expect.objectContaining({ code: "TENANT_POLICY_MANIFEST_INVALID" }));
    expect(report.ruleCoverage.complete).toBe(false);
    expect(report.blockers.some((issue) => issue.code === "MISSING_REQUIRED_CLASS")).toBe(false);
  });
});
