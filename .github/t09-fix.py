from pathlib import Path

path = Path("tests/session-specific-locks.test.ts")
text = path.read_text(encoding="utf-8")
old = '  class: Omit<ClassDefinition, "eligibleTeacherIds">;\n'
new = '  class: Omit<ClassDefinition, "eligibleTeacherIds" | "companyOnly"> & { companyOnly: boolean };\n'
if text.count(old) != 1:
    raise SystemExit(f"expected one fixture class type match, found {text.count(old)}")
path.write_text(text.replace(old, new, 1), encoding="utf-8", newline="\n")
