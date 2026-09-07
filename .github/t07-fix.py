from pathlib import Path

p = Path("tests/coherent-solver-snapshot.test.ts")
text = p.read_text(encoding="utf-8")
text = text.replace(
    'import { describe, expect, it } from "vitest";\n',
    'import { describe, expect, it } from "vitest";\nimport type { PlanningDatasetSnapshotV1 } from "@/lib/domain";\n',
    1,
)
text = text.replace(
    '      },\n    },\n    constraintModelVersion: null,\n    currentSchedule: null,\n    currentAssignments: [],',
    '      } as PlanningDatasetSnapshotV1,\n    },\n    constraintModelVersion: null,\n    currentSchedule: null as Record<string, unknown> | null,\n    currentAssignments: [] as Array<Record<string, unknown>>,',
    1,
)
text = text.replace(
    '    } as typeof raw.planningDatasetVersion.snapshot;',
    '    } as PlanningDatasetSnapshotV1;',
    1,
)
text = text.replace(
    '    } as unknown as null;',
    '    } as Record<string, unknown>;',
    1,
)
p.write_text(text, encoding="utf-8", newline="\n")

p = Path("scripts/test-db.mjs")
text = p.read_text(encoding="utf-8")
needle = "const coherentSolverSnapshotSql = String.raw`\nset search_path=public,extensions;\nset role authenticated;\nselect set_config"
replacement = "const coherentSolverSnapshotSql = String.raw`\nset search_path=public,extensions;\n-- Run synthetic concurrent mutations as the disposable database owner.\n-- auth.uid() still resolves the deidentified owner claim below, so the\n-- member-authorized snapshot RPC exercises its real identity check.\nselect set_config"
if needle not in text:
    raise SystemExit("T07 DB role fixture: expected coherent snapshot header not found")
text = text.replace(needle, replacement, 1)
p.write_text(text, encoding="utf-8", newline="\n")
