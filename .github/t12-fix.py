from pathlib import Path

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
