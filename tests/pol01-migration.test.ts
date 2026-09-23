import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const v52 = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20260908050000_pol01_typed_policy_v52.sql"),
  "utf8",
);
const v53 = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20260908051500_pol01_server_publication_closure_v53.sql"),
  "utf8",
);

const V3_HASH = "7d03e131bd0b6a1eddafff70fd3024628215236d3d846cb156d1514329120c5b";

describe("POL-01 bounded typed-policy database migration", () => {
  it("scopes the data cutover to the exact reviewed DWDE V3 artifact", () => {
    expect(v52).toContain(`version=3 and source_hash='${V3_HASH}'`);
    expect(v52).toContain("if v_studio is null then\n    return;");
    expect(v52).toContain("v_current.version<>3");
    expect(v52).toContain("POL01_BASELINE_MISMATCH");
    expect(v52).toContain("v_current.rule_count<>178");
  });

  it("resolves the legacy Aimee name once and persists stable-ID AIM-003 authority", () => {
    expect(v52).toContain("regexp_replace(lower(btrim(t.name)),'[^a-z0-9]+','','g')='aimee'");
    expect(v52).toContain("POL01_AIMEE_MISSING");
    expect(v52).toContain("POL01_AIMEE_AMBIGUOUS");
    expect(v52).toContain("'schemaVersion','1.0'");
    expect(v52).toContain("'kind','TEACHER_DAY_WINDOW'");
    expect(v52).toContain("'teacherId',v_teacher_id");
    expect(v52).toContain("'allowedDays',jsonb_build_array('Monday','Tuesday','Wednesday','Thursday')");
    expect(v52).toContain("affected_entity_ids=array[v_teacher_id]::text[]");
  });

  it("proves dependency closure and exactly-one semantic ownership", () => {
    expect(v52).toContain("private.rulebook_snapshot_without_v52(v_snapshot,'AIM-003')");
    expect(v52).toContain("POL01_RESIDUAL_POLICY_CHANGED");
    expect(v52).toContain("POL01_DUAL_AUTHORITY");
    expect(v52).toContain("where elem->>'ruleId'='AIM-003'");
    expect(v52).toContain("POL01_CONSTRAINT_SOURCE_COUNT");
    expect(v52).toContain("POL01_CONSTRAINT_BINDING_MISMATCH");
    expect(v52).toContain("jsonb_build_object('teacherIds',jsonb_build_array(v_teacher_id))");
  });

  it("invalidates the prior model and requires compiler 0.4 for V4 publication", () => {
    expect(v52).toContain("update public.constraint_model_versions\n  set status='HISTORICAL'");
    expect(v52).toContain("CONSTRAINT_MODEL_INVALIDATED");
    expect(v52).toContain("typed Rulebook V4 requires dwde-ir-0.4");
    expect(v52).toContain("v_compiler<>'dwde-ir-0.4'");
  });

  it("keeps the retired primitive closed throughout migration and behind the server-authority wrapper", () => {
    expect(v52).toContain("revoke all on function public.publish_constraint_model_v30(jsonb,text,integer)\n  from public,anon,authenticated,service_role;");
    expect(v52).not.toContain("grant execute on function public.publish_constraint_model_v30");
    expect(v53).toContain("revoke all on function public.publish_constraint_model_v30(jsonb,text,integer)");
    expect(v53).toContain("from public,anon,authenticated,service_role");
    expect(v53).toContain("for update;");
    expect(v53).toContain("if not found or v_selected_role not in ('OWNER','EDITOR')");
    expect(v53).toContain("grant execute on function public.publish_server_constraint_model_v49");
    expect(v53).toContain("to service_role;");
  });
});
