import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  validateDeploymentEnvironment,
  validateRepositoryContracts,
} from "../scripts/ops01-config.mjs";

const repoRoot = resolve(process.cwd());

function stagingEnvironment() {
  return {
    NEXT_PUBLIC_SUPABASE_URL: "https://staging-db.example.test",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "public-staging-key",
    SUPABASE_SERVICE_ROLE_KEY: "service-staging-key",
    SOLVER_SERVICE_URL: "https://solver-staging.example.test",
    SOLVER_INTERNAL_TOKEN: "solver-staging-token",
    SOLVER_MAX_SECONDS: "10",
    APP_URL: "https://staging.example.test",
  };
}

describe("OPS-01 operational rehearsal contracts", () => {
  it("validates the repository deployment, solver, and version boundaries", () => {
    const report = validateRepositoryContracts(repoRoot);

    expect(report.ok).toBe(true);
    expect(report.versions).toMatchObject({
      app: "0.2.0",
      next: "16.3.3",
      solverService: "1.0",
      solverPython: "3.12",
      ortools: "9.15.6755",
      migrationHead: "20260912100000_cand01_persisted_solver_candidates_v68.sql",
    });
  });

  it("accepts complete staging configuration without exposing credential values", () => {
    const report = validateDeploymentEnvironment(stagingEnvironment());

    expect(report.ok).toBe(true);
    expect(report.present).toEqual([
      "NEXT_PUBLIC_SUPABASE_URL",
      "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
      "SUPABASE_SERVICE_ROLE_KEY",
      "SOLVER_SERVICE_URL",
      "SOLVER_INTERNAL_TOKEN",
      "APP_URL",
      "SOLVER_MAX_SECONDS",
    ]);
    expect(JSON.stringify(report)).not.toContain("solver-staging-token");
  });

  it("rejects missing secrets, loopback deployment URLs, shared credentials, and unsafe timeouts", () => {
    const environment = stagingEnvironment();
    environment.NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:54321";
    environment.SOLVER_SERVICE_URL = "http://localhost:8080";
    environment.SOLVER_INTERNAL_TOKEN = environment.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    environment.SOLVER_MAX_SECONDS = "31";
    delete environment.SUPABASE_SERVICE_ROLE_KEY;

    const report = validateDeploymentEnvironment(environment);
    const codes = report.failures.map((failure) => failure.code);

    expect(report.ok).toBe(false);
    expect(codes).toContain("CONFIG_MISSING");
    expect(codes).toContain("CONFIG_LOOPBACK_URL");
    expect(codes).toContain("CONFIG_INSECURE_URL");
    expect(codes).toContain("CONFIG_SHARED_CREDENTIAL");
    expect(codes).toContain("CONFIG_SOLVER_TIMEOUT");
  });

  it("keeps the rollback procedure explicit about the missing global read-only switch", () => {
    const checklist = readFileSync(resolve(repoRoot, "plans", "OPS-01_RELEASE_CHECKLIST.md"), "utf8");

    expect(checklist).toContain("does not currently have a global application maintenance/read-only switch");
    expect(checklist).toContain("stop and do not call the system read-only");
    expect(checklist).toContain("npm run ops:restore");
  });
});
