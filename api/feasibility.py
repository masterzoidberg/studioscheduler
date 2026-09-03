from __future__ import annotations

import json
import os
import sys
from http.server import BaseHTTPRequestHandler
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import Request, urlopen

sys.path.insert(0, os.path.join(os.getcwd(), "solver"))

from dwde_solver import solve_feasibility  # noqa: E402

STUDIO_ID = "11111111-1111-4111-8111-111111111111"
MAX_BODY_BYTES = 16 * 1024


def _json_response(handler: BaseHTTPRequestHandler, status: int, payload: dict) -> None:
    body = json.dumps(payload, separators=(",", ":")).encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Cache-Control", "no-store")
    handler.send_header("Content-Length", str(len(body)))
    handler.end_headers()
    handler.wfile.write(body)


def _config() -> tuple[str, str]:
    url = os.environ.get("NEXT_PUBLIC_SUPABASE_URL", "").rstrip("/")
    key = os.environ.get("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "")
    if not url or not key:
        raise RuntimeError("Supabase server configuration is unavailable")
    return url, key


def _get_json(path: str, token: str):
    base, key = _config()
    request = Request(
        f"{base}{path}",
        headers={
            "apikey": key,
            "Authorization": f"Bearer {token}",
            "Accept": "application/json",
        },
        method="GET",
    )
    with urlopen(request, timeout=10) as response:
        return json.loads(response.read().decode("utf-8"))


def _single_current(table: str, fields: str, token: str) -> dict:
    path = (
        f"/rest/v1/{table}?select={quote(fields, safe=',_')}"
        f"&studio_id=eq.{STUDIO_ID}&status=eq.CURRENT&limit=1"
    )
    rows = _get_json(path, token)
    if not isinstance(rows, list) or len(rows) != 1:
        raise RuntimeError(f"Expected exactly one current {table} row")
    return rows[0]


def _authenticate_member(token: str) -> dict:
    user = _get_json("/auth/v1/user", token)
    user_id = str(user.get("id", ""))
    if not user_id:
        raise PermissionError("Authentication is required")
    path = (
        "/rest/v1/studio_members?select=role"
        f"&studio_id=eq.{STUDIO_ID}&user_id=eq.{quote(user_id)}&limit=1"
    )
    membership = _get_json(path, token)
    if not isinstance(membership, list) or len(membership) != 1:
        raise PermissionError("DWDE studio membership is required")
    return {"userId": user_id, "role": membership[0].get("role")}


def _require_names(snapshot: dict) -> None:
    if snapshot.get("schemaVersion") != "1.3":
        raise RuntimeError("The current Planning Dataset must use schema 1.3 before solving")
    for key in ("teachers", "rooms", "students", "classes"):
        values = snapshot.get(key)
        if not isinstance(values, list):
            raise RuntimeError(f"Planning Dataset is missing {key}")
        for item in values:
            if not item.get("id") or not item.get("name"):
                raise RuntimeError(f"Planning Dataset {key} contains an unnamed entity")
    sessions = snapshot.get("sessions")
    if not isinstance(sessions, list):
        raise RuntimeError("Planning Dataset is missing sessions")


def _solver_problem(planning: dict, model: dict) -> dict:
    snapshot = planning["snapshot"]
    _require_names(snapshot)
    return {
        "schemaVersion": "1.0",
        "rulebookVersion": int(model["rulebook_version"]),
        "constraintModelVersion": int(model["version"]),
        "constraintModelHash": model["snapshot_hash"],
        "planningDatasetVersion": int(planning["version"]),
        "planningDatasetHash": planning["snapshot_hash"],
        "teachers": snapshot["teachers"],
        "rooms": snapshot["rooms"],
        "students": snapshot["students"],
        "classes": snapshot["classes"],
        "sessions": snapshot["sessions"],
        "constraintModel": model["snapshot"],
        # REQUIRED_LOWER_LEVEL is deliberately not marked proven here. A future
        # explicit progression-fact checkpoint must supply that proof. Until then
        # the solver returns PRECONDITION_REQUIRED instead of silently ignoring it.
        "preflight": {"validatedDelegatedConstraintIds": []},
    }


class handler(BaseHTTPRequestHandler):
    def do_POST(self):
        try:
            authorization = self.headers.get("Authorization", "")
            if not authorization.startswith("Bearer "):
                _json_response(self, 401, {"status": "UNAUTHORIZED", "error": "Bearer authentication is required"})
                return
            token = authorization[7:].strip()
            member = _authenticate_member(token)

            length = int(self.headers.get("Content-Length", "0") or 0)
            if length > MAX_BODY_BYTES:
                _json_response(self, 413, {"status": "INVALID_REQUEST", "error": "Request body is too large"})
                return
            request_body = {}
            if length:
                request_body = json.loads(self.rfile.read(length).decode("utf-8"))
                if not isinstance(request_body, dict):
                    raise ValueError("Request body must be a JSON object")

            planning = _single_current(
                "planning_dataset_versions",
                "version,snapshot,snapshot_hash,confirmed_for_scheduling_at",
                token,
            )
            model = _single_current(
                "constraint_model_versions",
                "version,rulebook_version,compiler_version,snapshot,snapshot_hash,complete_hard_constraint_compilation",
                token,
            )
            rulebook = _single_current("rulebook_versions", "version", token)

            expected_planning = request_body.get("expectedPlanningDatasetVersion")
            expected_model = request_body.get("expectedConstraintModelVersion")
            expected_rulebook = request_body.get("expectedRulebookVersion")
            if expected_planning is not None and int(expected_planning) != int(planning["version"]):
                _json_response(self, 409, {"status": "STALE_CONTEXT", "error": "Planning Dataset changed before solve"})
                return
            if expected_model is not None and int(expected_model) != int(model["version"]):
                _json_response(self, 409, {"status": "STALE_CONTEXT", "error": "Constraint Model changed before solve"})
                return
            if expected_rulebook is not None and int(expected_rulebook) != int(rulebook["version"]):
                _json_response(self, 409, {"status": "STALE_CONTEXT", "error": "Rulebook changed before solve"})
                return

            if not planning.get("confirmed_for_scheduling_at"):
                _json_response(
                    self,
                    409,
                    {
                        "status": "PLANNING_CONFIRMATION_REQUIRED",
                        "error": f"Planning Dataset v{planning['version']} has not been confirmed for automatic scheduling",
                    },
                )
                return
            if not model.get("complete_hard_constraint_compilation"):
                _json_response(self, 409, {"status": "MODEL_INCOMPLETE", "error": "Current Constraint Model is incomplete"})
                return
            if int(model["rulebook_version"]) != int(rulebook["version"]):
                _json_response(self, 409, {"status": "STALE_CONTEXT", "error": "Constraint Model does not match the current Rulebook"})
                return

            max_seconds = float(request_body.get("maxSeconds", 10))
            max_seconds = max(1.0, min(max_seconds, 20.0))
            problem = _solver_problem(planning, model)
            result = solve_feasibility(problem, max_seconds=max_seconds)
            result["context"] = {
                "rulebookVersion": int(rulebook["version"]),
                "constraintModelVersion": int(model["version"]),
                "constraintModelHash": model["snapshot_hash"],
                "planningDatasetVersion": int(planning["version"]),
                "planningDatasetHash": planning["snapshot_hash"],
                "requestedByRole": member.get("role"),
            }
            # Candidate output is read-only. No schedule is adopted by this endpoint.
            _json_response(self, 200, result)
        except PermissionError as error:
            _json_response(self, 403, {"status": "FORBIDDEN", "error": str(error)})
        except (ValueError, KeyError, TypeError) as error:
            _json_response(self, 400, {"status": "INVALID_REQUEST", "error": str(error)})
        except HTTPError as error:
            status = 401 if error.code in (401, 403) else 502
            _json_response(self, status, {"status": "UPSTREAM_ERROR", "error": f"Supabase request failed with HTTP {error.code}"})
        except URLError:
            _json_response(self, 502, {"status": "UPSTREAM_ERROR", "error": "Supabase could not be reached"})
        except Exception as error:  # fail closed at the HTTP boundary
            _json_response(self, 500, {"status": "ERROR", "error": str(error)})

    def do_GET(self):
        _json_response(
            self,
            200,
            {
                "service": "DWDE CP-SAT feasibility",
                "mode": "read-only candidate generation",
                "solver": "OR-Tools CP-SAT 9.15.6755",
            },
        )
