"""Read-only checks for the current milestone plan. Run: python plans/check_integrity.py."""
from pathlib import Path
import re

root = Path(__file__).resolve().parent
plan = root / "new-rework-09-22-2026"
required = ["README.md", "CURRENT_STATE.md", "ROADMAP.md", "NEXT.md", "RISKS.md", "DECISIONS.md"]
milestones = sorted((plan / "MILESTONES").glob("M[0-9][0-9]-*.md"))
errors = []

for name in required:
    if not (plan / name).is_file():
        errors.append(f"Missing {name}")
if not milestones:
    errors.append("No milestone files")

for path in [root / "README.md", root / "NEXT.md", *plan.rglob("*.md")]:
    content = path.read_text(encoding="utf-8-sig")
    for target in re.findall(r"\[[^\]]*\]\(([^)]+)\)", content):
        target = target.split("#", 1)[0]
        if target and not re.match(r"^[a-z]+:", target) and not (path.parent / target).exists():
            errors.append(f"Broken link: {path.relative_to(root)} -> {target}")

roadmap = (plan / "ROADMAP.md").read_text(encoding="utf-8-sig")
next_task = (plan / "NEXT.md").read_text(encoding="utf-8-sig")
current = re.findall(r"\[M\d\d\]\([^)]*\) — \*\*CURRENT, [^*]+\*\*", roadmap)
selected = re.search(r"\*\*One primary task:\*\* `(M\d\d-T\d\d)`", next_task)
if len(current) != 1 or selected is None:
    errors.append("Expected one current milestone and one selected task")
elif not any(selected.group(1) in path.read_text(encoding="utf-8-sig") for path in milestones):
    errors.append(f"Selected task missing from milestone files: {selected.group(1)}")
for path in milestones:
    content = path.read_text(encoding="utf-8-sig")
    if "## Completion gate" not in content or "## Work required" not in content:
        errors.append(f"Missing task/gate sections: {path.name}")

if errors:
    raise SystemExit("\n".join(errors))
print(f"PASS: current plan, {len(milestones)} milestones, one {selected.group(1)} next task, active links resolved")
