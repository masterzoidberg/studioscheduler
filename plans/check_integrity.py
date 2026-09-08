"""Read-only planning checks. Run: python plans/check_integrity.py"""
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parent.parent
PLANS = ROOT / "plans"
errors = []
documents = [ROOT / "README.md", ROOT / "AGENTS.md", *PLANS.rglob("*.md")]
for path in documents:
    text = path.read_text(encoding="utf-8-sig")
    for target in re.findall(r"\[[^\]]*\]\(([^)]+)\)", text):
        target = target.split("#")[0]
        if target and not re.match(r"^[a-z]+:", target) and not (path.parent / target).exists():
            errors.append(f"Broken link: {path.relative_to(ROOT)} -> {target}")
    if "_OLD" in path.stem or "archive" in path.parts:
        if "HISTORICAL" not in text and "Historical" not in text:
            errors.append(f"Unmarked history: {path.relative_to(ROOT)}")

ledger = (PLANS / "TASKS.md").read_text(encoding="utf-8-sig")
tasks = {}
for line in ledger.splitlines():
    if not re.match(r"\| \[[A-Z]+[0-9]*-\d+\]", line):
        continue
    cells = [cell.strip() for cell in line.strip("|").split("|")]
    task = re.search(r"\[([^]]+)\]", cells[0]).group(1)
    if task in tasks:
        errors.append(f"Duplicate task {task}")
    tasks[task] = (cells[2], cells[4], cells[5])
    prompt = (PLANS / "prompts" / f"{task}.md").read_text(encoding="utf-8-sig")
    if f"Dependencies: **{cells[4]}**" not in prompt or f"**{cells[5]}**" not in prompt:
        errors.append(f"Prompt/ledger mismatch: {task}")
    for section in ("Outcome", "Scope", "inspection points", "failure behavior", "UX behavior", "Non-goals", "Tests", "Verification commands", "Completion evidence", "Escalation conditions"):
        if section not in prompt:
            errors.append(f"Missing prompt section {section}: {task}")

visiting, visited = set(), set()
def visit(task):
    if task in visiting:
        errors.append(f"Dependency cycle at {task}")
        return
    if task in visited:
        return
    visiting.add(task)
    for dependency in tasks[task][1].split(", "):
        if dependency == "None":
            continue
        if dependency not in tasks:
            errors.append(f"Unknown dependency {dependency}: {task}")
        else:
            visit(dependency)
    visiting.remove(task)
    visited.add(task)
for task in tasks:
    visit(task)

active_prompts = {p.stem for p in (PLANS / "prompts").glob("*.md") if p.stem != "README" and "_OLD" not in p.stem}
if active_prompts != set(tasks):
    errors.append("Active prompt/task set mismatch")
ready = [task for task, row in tasks.items() if row[0] == "READY"]
if ready != ["SAFE-01"]:
    errors.append(f"Audit baseline must select only SAFE-01; got {ready}")
for name in ("README.md", "NEXT.md"):
    if "SAFE-01" not in (PLANS / name).read_text(encoding="utf-8-sig"):
        errors.append(f"Missing selected next in {name}")
completed = list((PLANS / "prompts/archive").glob("T*.md"))
superseded = list((PLANS / "prompts").glob("T*_OLD.md"))
if len(completed) != 13 or len(superseded) != 16:
    errors.append("Historical prompt count mismatch")
if errors:
    raise SystemExit("\n".join(errors))
print(f"PASS: {len(documents)} documents, resolved file links, {len(tasks)} prompts/tasks, acyclic dependencies, one SAFE-01 next task; 13 completed and 16 superseded prompts.")
