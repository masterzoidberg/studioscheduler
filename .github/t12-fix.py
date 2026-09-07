from pathlib import Path

# Give the tiny T12 unit fixture an explicit teacher qualification domain so it
# exercises the production default-deny rule instead of bypassing it.
path = Path("tests/schedule-recovery.test.ts")
text = path.read_text(encoding="utf-8")
old = '''function model(extra: ConstraintIRNode[] = []): ConstraintModelSnapshotV1 {
  return {
    schemaVersion: "1.0", compilerVersion: "t12-test", rulebookVersion: 1, planningDatasetVersion: 2, activeRuleCount: extra.length,
    hardConstraints: extra, objectivePrioritySpine: [], readinessRuleIds: [], governanceAssertions: [], uncompiledConstraintRuleIds: [], completeHardConstraintCompilation: true,
  };
}
'''
new = '''function model(extra: ConstraintIRNode[] = []): ConstraintModelSnapshotV1 {
  const qualification = node({
    id: "teacher-domain",
    kind: "TEACHER_SUBJECT_DOMAIN",
    selector: { teacherNames: ["Teacher"] },
    parameters: { allowedSubjects: ["Ballet"] },
  });
  const hardConstraints = [qualification, ...extra];
  return {
    schemaVersion: "1.0", compilerVersion: "t12-test", rulebookVersion: 1, planningDatasetVersion: 2, activeRuleCount: hardConstraints.length,
    hardConstraints, objectivePrioritySpine: [], readinessRuleIds: [], governanceAssertions: [], uncompiledConstraintRuleIds: [], completeHardConstraintCompilation: true,
  };
}
'''
if text.count(old) != 1:
    raise SystemExit(f"expected one T12 model fixture marker, found {text.count(old)}")
path.write_text(text.replace(old, new, 1), encoding="utf-8", newline="\n")

# Recovery may need to create an incomplete repair draft after inventory changes.
# A current IR node finding with zero offending assignments represents an
# unresolved prerequisite / missing required counterpart in current planning,
# not a newly illegal placement. Keep it as a visible completeness obligation so
# the draft cannot be published, while assignment-backed HARD findings still block.
path = Path("lib/schedule-recovery.ts")
text = path.read_text(encoding="utf-8")
old = '''function isIrCompletenessObligation(violation: ConstraintEngineViolation, model: ConstraintModelSnapshotV1) {
  const node = model.hardConstraints.find((candidate) => candidate.id === violation.constraintId);
  return violation.assignmentIds.length === 0
    && Boolean(node && ["FIXED_ASSIGNMENT", "DIRECTLY_AFTER"].includes(node.kind));
}
'''
new = '''function isIrCompletenessObligation(violation: ConstraintEngineViolation, model: ConstraintModelSnapshotV1) {
  const node = model.hardConstraints.find((candidate) => candidate.id === violation.constraintId);
  return violation.assignmentIds.length === 0 && Boolean(node);
}
'''
if text.count(old) != 1:
    raise SystemExit(f"expected one T12 recovery completeness marker, found {text.count(old)}")
path.write_text(text.replace(old, new, 1), encoding="utf-8", newline="\n")
