from pathlib import Path

path = Path("tests/schedule-recovery.test.ts")
text = path.read_text(encoding="utf-8")
old = '''        function model(extra: ConstraintIRNode[] = []): ConstraintModelSnapshotV1 {\n          return {\n            schemaVersion: "1.0", compilerVersion: "t12-test", rulebookVersion: 1, planningDatasetVersion: 2, activeRuleCount: extra.length,\n            hardConstraints: extra, objectivePrioritySpine: [], readinessRuleIds: [], governanceAssertions: [], uncompiledConstraintRuleIds: [], completeHardConstraintCompilation: true,\n          };\n        }\n'''
new = '''        function model(extra: ConstraintIRNode[] = []): ConstraintModelSnapshotV1 {\n          const qualification = node({\n            id: "teacher-domain",\n            kind: "TEACHER_SUBJECT_DOMAIN",\n            selector: { teacherNames: ["Teacher"] },\n            parameters: { allowedSubjects: ["Ballet"] },\n          });\n          const hardConstraints = [qualification, ...extra];\n          return {\n            schemaVersion: "1.0", compilerVersion: "t12-test", rulebookVersion: 1, planningDatasetVersion: 2, activeRuleCount: hardConstraints.length,\n            hardConstraints, objectivePrioritySpine: [], readinessRuleIds: [], governanceAssertions: [], uncompiledConstraintRuleIds: [], completeHardConstraintCompilation: true,\n          };\n        }\n'''
if text.count(old) != 1:
    raise SystemExit(f"expected one T12 model fixture marker, found {text.count(old)}")
path.write_text(text.replace(old, new, 1), encoding="utf-8", newline="\n")
