import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(join(process.cwd(), "supabase", "migrations", "20260907090000_session_specific_solver_locks_v45.sql"), "utf8");

describe("T09 solver-adoption lock precedence migration", () => {
  it("wraps the canonical v33 writer without rewriting historical migrations", () => {
    expect(sql).toContain("rename to adopt_solver_candidate_v33_pre_v45");
    expect(sql).toContain("create or replace function public.adopt_solver_candidate_v33(");
    expect(sql).toContain("public.adopt_solver_candidate_v33_pre_v45(");
  });

  it("treats either session or assignment lock as protective and carries assignment locks forward", () => {
    expect(sql).toMatch(/s\.locked\s*=\s*true\s+or\s+old_a\.locked\s*=\s*true/i);
    expect(sql).toMatch(/set\s+locked\s*=\s*true/i);
    expect(sql).toContain("SESSION_OR_ASSIGNMENT");
  });

  it("keeps the renamed pre-v45 writer off the service-role surface", () => {
    expect(sql).toMatch(/revoke all on function public\.adopt_solver_candidate_v33_pre_v45[\s\S]*service_role/i);
    expect(sql).toMatch(/grant execute on function public\.adopt_solver_candidate_v33\([\s\S]*service_role/i);
  });
});
