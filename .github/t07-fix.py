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
