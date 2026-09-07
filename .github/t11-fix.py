from pathlib import Path
import re

path = Path("components/schedule/schedule-builder-panel.tsx")
text = path.read_text(encoding="utf-8")

# T11 removes browser-side aggregate validation as an authority. Remove helper and
# version fields that were used only by the retired direct-RPC preview/write path.
text, count = re.subn(
    r'\nfunction messageOf\(error: unknown\) \{.*?\n\}\n',
    '\n',
    text,
    count=1,
    flags=re.S,
)
if count != 1:
    raise SystemExit(f"expected one messageOf helper, found {count}")

old = "    currentPlanningDatasetVersion,\n"
if text.count(old) != 1:
    raise SystemExit(f"expected one currentPlanningDatasetVersion destructure, found {text.count(old)}")
text = text.replace(old, "", 1)

# The old JSX reported aggregate legacy HARD counts before saving. That is the
# exact T11 hole: a new violation could be hidden by another disappearing finding.
# Keep only a structural form hint and make the server authority explicit.
pattern = re.compile(
    r'              <div className=\{`rounded-xl border p-4 \$\{placementAllowed \? .*?</div>\n              <div className="flex gap-2">',
    re.S,
)
replacement = '''              <div className={`rounded-xl border p-4 ${placementAllowed ? "border-blue-200 bg-blue-50" : "border-red-200 bg-red-50"}`}><div className="flex items-center gap-2 text-sm font-semibold">{placementAllowed ? <CheckCircle2 className="size-4 text-blue-700" /> : <AlertTriangle className="size-4 text-red-700" />}Authoritative server validation</div><p className="mt-2 text-sm text-slate-700">{placementAllowed ? "Required placement fields are present. The server will evaluate the exact candidate against the pinned Constraint IR before saving." : "Choose a day, start time, teacher, and room before submitting."}</p><p className="mt-2 text-xs text-slate-500">This form does not decide schedule legality. A rejected server check creates no new ScheduleVersion.</p></div>
              <div className="flex gap-2">'''
text, count = pattern.subn(replacement, text, count=1)
if count != 1:
    raise SystemExit(f"expected one legacy placement preview block, found {count}")

path.write_text(text, encoding="utf-8", newline="\n")
