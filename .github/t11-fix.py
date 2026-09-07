from pathlib import Path
import re

panel_path = Path("components/schedule/schedule-builder-panel.tsx")
text = panel_path.read_text(encoding="utf-8")

# T11 removes browser-side aggregate validation as an authority. Remove helpers
# and context fields that were used only by the retired direct-RPC preview/write
# path in this panel.
text, count = re.subn(
    r'\nfunction messageOf\(error: unknown\) \{.*?\n\}\n',
    '\n',
    text,
    count=1,
    flags=re.S,
)
if count != 1:
    raise SystemExit(f"expected one messageOf helper, found {count}")

for old in ["    currentPlanningDatasetVersion,\n", "    validation,\n"]:
    if text.count(old) != 1:
        raise SystemExit(f"expected one panel destructure marker {old!r}, found {text.count(old)}")
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

panel_path.write_text(text, encoding="utf-8", newline="\n")

# Keep T10's established static contract literal while adding the T11 sibling
# route. Both operations still share WorkspaceProvider; the request body and auth
# headers are constructed once.
provider_path = Path("components/workspace-provider.tsx")
provider = provider_path.read_text(encoding="utf-8")
old = '''      const endpoint = patch.operation === "MOVE" ? "/api/schedule/move" : "/api/schedule/incremental";
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ studioId: state.studioId, patch }),
      });'''
new = '''      const requestInit: RequestInit = {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ studioId: state.studioId, patch }),
      };
      const response = patch.operation === "MOVE"
        ? await fetch("/api/schedule/move", requestInit)
        : await fetch("/api/schedule/incremental", requestInit);'''
if provider.count(old) != 1:
    raise SystemExit(f"expected one provider endpoint block, found {provider.count(old)}")
provider = provider.replace(old, new, 1)
provider_path.write_text(provider, encoding="utf-8", newline="\n")
