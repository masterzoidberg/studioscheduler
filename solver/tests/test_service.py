from __future__ import annotations

from fastapi.testclient import TestClient

from dwde_solver.service import app

client = TestClient(app)


def problem() -> dict:
    return {
        "contractVersion": "1.0",
        "context": {
            "studioId": "studio",
            "rulebookVersion": 3,
            "planningDatasetVersion": 7,
            "compilerVersion": "dwde-ir-test",
        },
        "teachers": [{"id": "teacher", "name": "Teacher"}],
        "rooms": [{"id": "room", "name": "Studio A", "capacity": 20, "features": []}],
        "students": [],
        "classes": [{
            "id": "class",
            "name": "Ballet 1",
            "subject": "Ballet",
            "level": "Level 1",
            "durationMinutes": 60,
            "weeklyFrequency": 1,
            "rosterStudentIds": [],
            "companyOnly": False,
        }],
        "sessions": [{"id": "session", "classId": "class", "ordinal": 1, "durationMinutes": None, "locked": False}],
        "constraintModel": {
            "schemaVersion": "1.0",
            "compilerVersion": "dwde-ir-test",
            "rulebookVersion": 3,
            "planningDatasetVersion": 7,
            "activeRuleCount": 178,
            "hardConstraints": [],
            "objectivePrioritySpine": [],
            "readinessRuleIds": [],
            "governanceAssertions": [],
            "uncompiledConstraintRuleIds": [],
            "completeHardConstraintCompilation": True,
        },
        "preflight": {"validatedDelegatedConstraintIds": []},
    }


def test_health_reports_auth_configuration(monkeypatch):
    monkeypatch.delenv("SOLVER_INTERNAL_TOKEN", raising=False)
    response = client.get("/healthz")
    assert response.status_code == 200
    assert response.json() == {"status": "ok", "serviceVersion": "1.0", "authConfigured": False}


def test_solve_fails_closed_when_service_secret_is_not_configured(monkeypatch):
    monkeypatch.delenv("SOLVER_INTERNAL_TOKEN", raising=False)
    response = client.post("/v1/feasibility", json={"problem": problem()})
    assert response.status_code == 503


def test_solve_requires_valid_internal_bearer_token(monkeypatch):
    monkeypatch.setenv("SOLVER_INTERNAL_TOKEN", "internal-secret")
    missing = client.post("/v1/feasibility", json={"problem": problem()})
    assert missing.status_code == 401

    wrong = client.post(
        "/v1/feasibility",
        headers={"Authorization": "Bearer wrong"},
        json={"problem": problem()},
    )
    assert wrong.status_code == 403


def test_solve_echoes_version_context_and_returns_candidate(monkeypatch):
    monkeypatch.setenv("SOLVER_INTERNAL_TOKEN", "internal-secret")
    response = client.post(
        "/v1/feasibility",
        headers={"Authorization": "Bearer internal-secret"},
        json={"problem": problem(), "maxSeconds": 1.0},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["context"] == problem()["context"]
    assert body["serviceVersion"] == "1.0"
    assert body["result"]["status"] == "FEASIBLE"
    assert body["result"]["assignments"][0]["sessionId"] == "session"


def test_service_rejects_context_model_version_drift(monkeypatch):
    monkeypatch.setenv("SOLVER_INTERNAL_TOKEN", "internal-secret")
    payload = problem()
    payload["constraintModel"]["planningDatasetVersion"] = 6
    response = client.post(
        "/v1/feasibility",
        headers={"Authorization": "Bearer internal-secret"},
        json={"problem": payload},
    )
    assert response.status_code == 422
    assert "Planning Dataset version" in response.json()["detail"]


def test_service_rejects_incomplete_constraint_model(monkeypatch):
    monkeypatch.setenv("SOLVER_INTERNAL_TOKEN", "internal-secret")
    payload = problem()
    payload["constraintModel"]["completeHardConstraintCompilation"] = False
    response = client.post(
        "/v1/feasibility",
        headers={"Authorization": "Bearer internal-secret"},
        json={"problem": payload},
    )
    assert response.status_code == 422
