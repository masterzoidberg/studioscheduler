"""Read-only planning checks. Run: python plans/check_integrity.py"""
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parent.parent
PLANS = ROOT / "plans"
PROMPTS = PLANS / "prompts"
ARCHIVE = PROMPTS / "archive"
errors = []

documents = [ROOT / "README.md", ROOT / "AGENTS.md", *PLANS.rglob("*.md")]
active_documents = [
    path for path in documents
    if "_OLD" not in path.stem and "archive" not in path.parts
]
for path in active_documents:
    text = path.read_text(encoding="utf-8-sig")
    for target in re.findall(r"\[[^\]]*\]\(([^)]+)\)", text):
        target = target.split("#")[0]
        if target and not re.match(r"^[a-z]+:", target) and not (path.parent / target).exists():
            errors.append(f"Broken active link: {path.relative_to(ROOT)} -> {target}")

for path in documents:
    if "_OLD" in path.stem or "archive" in path.parts:
        text = path.read_text(encoding="utf-8-sig")
        if "historical" not in text.lower():
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
    status, dependencies, execution_class = cells[2], cells[4], cells[5]
    tasks[task] = (status, dependencies, execution_class)

    prompt_path = ARCHIVE / f"{task}.md" if status == "DONE" else PROMPTS / f"{task}.md"
    if not prompt_path.exists():
        errors.append(f"Missing {'archived' if status == 'DONE' else 'active'} prompt: {task}")
        continue
    prompt = prompt_path.read_text(encoding="utf-8-sig")
    if f"Dependencies: **{dependencies}**" not in prompt or f"**{execution_class}**" not in prompt:
        errors.append(f"Prompt/ledger mismatch: {task}")
    for section in (
        "Outcome", "Scope", "inspection points", "failure behavior", "UX behavior",
        "Non-goals", "Tests", "Verification commands", "Completion evidence", "Escalation conditions",
    ):
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

unfinished_tasks = {task for task, row in tasks.items() if row[0] != "DONE"}
active_prompts = {
    p.stem for p in PROMPTS.glob("*.md")
    if p.stem != "README" and "_OLD" not in p.stem
}
if active_prompts != unfinished_tasks:
    missing = sorted(unfinished_tasks - active_prompts)
    extra = sorted(active_prompts - unfinished_tasks)
    errors.append(f"Active prompt/task set mismatch; missing={missing}, extra={extra}")

post_rebuild_done = {task for task, row in tasks.items() if row[0] == "DONE"}
archived_post_rebuild = {
    p.stem for p in ARCHIVE.glob("*.md")
    if not p.stem.startswith("T") and p.stem != "README"
}
if archived_post_rebuild != post_rebuild_done:
    missing = sorted(post_rebuild_done - archived_post_rebuild)
    extra = sorted(archived_post_rebuild - post_rebuild_done)
    errors.append(f"DONE/archive set mismatch; missing={missing}, extra={extra}")

ready = [task for task, row in tasks.items() if row[0] == "READY"]
if len(ready) != 1:
    errors.append(f"Exactly one task must be READY; got {ready}")
selected = ready[0] if len(ready) == 1 else None
if selected:
    for name in ("README.md", "NEXT.md"):
        if selected not in (PLANS / name).read_text(encoding="utf-8-sig"):
            errors.append(f"Missing selected next {selected} in {name}")

historical_completed = list(ARCHIVE.glob("T*.md"))
superseded = list(PROMPTS.glob("T*_OLD.md"))
if len(historical_completed) != 13 or len(superseded) != 16:
    errors.append("Historical prompt count mismatch")

if errors:
    raise SystemExit("\n".join(errors))

print(
    f"PASS: {len(documents)} documents, active links resolved, {len(tasks)} tasks, "
    f"{len(active_prompts)} active prompts, {len(post_rebuild_done)} post-rebuild DONE prompts archived, "
    f"acyclic dependencies, one {selected} next task; 13 historical completed and 16 superseded prompts."
)
