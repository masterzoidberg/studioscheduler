from __future__ import annotations

import json
import sys
from pathlib import Path

from dwde_solver.feasibility import solve_feasibility


def main() -> int:
    if len(sys.argv) != 2:
        raise SystemExit("usage: runtime_parity_runner.py <fixture.json>")

    fixture_path = Path(sys.argv[1]).resolve()
    payload = json.loads(fixture_path.read_text(encoding="utf-8"))
    cases = payload.get("cases")
    if payload.get("schemaVersion") != "1.0" or not isinstance(cases, list):
        raise ValueError("runtime parity fixture must use schemaVersion 1.0 with a cases array")

    results = []
    for case in cases:
        case_id = str(case.get("id", ""))
        problem = case.get("problem")
        if not case_id or not isinstance(problem, dict):
            raise ValueError("each runtime parity case requires id and problem")
        result = solve_feasibility(problem, max_seconds=2.0)
        results.append(
            {
                "id": case_id,
                "status": result.get("status"),
                "assignments": result.get("assignments") or [],
                "unsupportedConstraintIds": result.get("unsupportedConstraintIds") or [],
                "missingPreconditionConstraintIds": result.get("missingPreconditionConstraintIds") or [],
            }
        )

    sys.stdout.write(json.dumps({"schemaVersion": "1.0", "results": results}, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
