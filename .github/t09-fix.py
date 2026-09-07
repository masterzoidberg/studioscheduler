from pathlib import Path

path = Path("tests/session-specific-locks.test.ts")
text = path.read_text(encoding="utf-8")

old = '  class: Omit<ClassDefinition, "eligibleTeacherIds">;\n'
new = '  class: Omit<ClassDefinition, "eligibleTeacherIds" | "companyOnly"> & { companyOnly: boolean };\n'
if text.count(old) != 1:
    raise SystemExit(f"expected one fixture class type match, found {text.count(old)}")
text = text.replace(old, new, 1)

old_model = '    hardConstraints: [],\n'
new_model = '''    hardConstraints: [{
      id: "fixture-teacher-domain",
      kind: "TEACHER_SUBJECT_DOMAIN",
      ruleIds: ["CUR-007"],
      selector: { teacherNames: ["Teacher A"] },
      parameters: { allowedSubjects: ["Ballet"] },
      explanation: "Fixture qualification domain.",
    }],
'''
if text.count(old_model) != 1:
    raise SystemExit(f"expected one empty fixture hardConstraints match, found {text.count(old_model)}")
text = text.replace(old_model, new_model, 1)

path.write_text(text, encoding="utf-8", newline="\n")
