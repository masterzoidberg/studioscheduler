from pathlib import Path
import sys
import textwrap

ROOT = Path(__file__).resolve().parents[1]


def write(path: str, content: str):
    target = ROOT / path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(textwrap.dedent(content).lstrip(), encoding="utf-8", newline="\n")


def replace_once(path: str, old: str, new: str):
    target = ROOT / path
    text = target.read_text(encoding="utf-8")
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{path}: expected one marker, found {count}: {old[:120]!r}")
    target.write_text(text.replace(old, new, 1), encoding="utf-8", newline="\n")


def apply_impl():
    write("supabase/migrations/20260907190000_close_legacy_write_bypasses_v49.sql", r'''
        -- T13 / V4.9 closes superseded canonical write RPC surfaces.
        --
        -- Historical functions remain in place for migration reproducibility and
        -- narrow SECURITY DEFINER delegation from current server-authority wrappers,
        -- but application roles may no longer execute them directly.

        -- Retire all browser/service-role callable schedule mutation generations.
        revoke all on function public.apply_schedule_patch_v21(text,jsonb,text,integer,integer,boolean)
          from public,anon,authenticated,service_role;
        revoke all on function public.rebase_current_schedule_v21(integer,integer,text)
          from public,anon,authenticated,service_role;
        revoke all on function public.apply_schedule_patch_v22(text,jsonb,text,integer,integer,integer,boolean)
          from public,anon,authenticated,service_role;
        revoke all on function public.rebase_current_schedule_v22(integer,integer,integer,text)
          from public,anon,authenticated,service_role;
        revoke all on function public.apply_schedule_builder_patch_v23(text,text,text,jsonb,text,integer,integer,integer,boolean)
          from public,anon,authenticated,service_role;
        revoke all on function public.undo_last_schedule_change_v23(integer,integer,integer,text)
          from public,anon,authenticated,service_role;
        revoke all on function public.apply_schedule_command_v25(text,text,text,jsonb,text,integer,integer,integer,integer,boolean)
          from public,anon,authenticated,service_role;
        revoke all on function public.undo_last_schedule_change_v25(integer,integer,integer,integer,text)
          from public,anon,authenticated,service_role;
        revoke all on function public.rebase_current_schedule_v25(integer,integer,integer,integer,text)
          from public,anon,authenticated,service_role;

        -- V3.0 accepts a caller-supplied Constraint IR artifact. Keep it available
        -- only as an implementation primitive behind the deterministic server wrapper.
        revoke all on function public.publish_constraint_model_v30(jsonb,text,integer)
          from public,anon,authenticated,service_role;

        -- V3.3 and V4.4 remain implementation primitives behind V4.9 adoption.
        revoke all on function public.adopt_solver_candidate_v33(
          uuid,uuid,text,text,integer,integer,integer,integer,integer,jsonb,jsonb
        ) from public,anon,authenticated,service_role;
        revoke all on function public.adopt_solver_candidate_v44(uuid,uuid,text,text,jsonb,jsonb,jsonb)
          from public,anon,authenticated,service_role;

        create or replace function public.publish_server_constraint_model_v49(
          p_studio_id uuid,
          p_actor_user_id uuid,
          p_snapshot jsonb,
          p_reason text,
          p_expected_rulebook_version integer
        )
        returns jsonb
        language plpgsql
        security definer
        set search_path=''
        as $function$
        declare
          v_selected_role text;
          v_actor_context jsonb;
          v_result jsonb;
        begin
          if p_studio_id is null then raise exception 'Studio is required'; end if;
          if p_actor_user_id is null then raise exception 'Actor is required'; end if;
          if coalesce(btrim(p_reason),'')='' then raise exception 'Reason is required'; end if;

          select m.role into v_selected_role
          from public.studio_members m
          where m.studio_id=p_studio_id and m.user_id=p_actor_user_id;
          if v_selected_role not in ('OWNER','EDITOR') then
            raise exception 'Editor membership required for selected workspace';
          end if;

          -- V3.0 still derives its studio/actor from auth.uid(). Until T22/T23
          -- remove that compatibility assumption, make the selected studio explicit
          -- and reject any mismatch instead of silently publishing for another tenant.
          perform pg_catalog.set_config('request.jwt.claim.sub',p_actor_user_id::text,true);
          v_actor_context:=private.assert_editor_context();
          if (v_actor_context->>'studio_id')::uuid is distinct from p_studio_id then
            raise exception 'WORKSPACE_SELECTION_MISMATCH: selected %, legacy active %',
              p_studio_id,v_actor_context->>'studio_id';
          end if;

          v_result:=public.publish_constraint_model_v30(
            p_snapshot,p_reason,p_expected_rulebook_version
          );

          update public.audit_events
          set payload=coalesce(payload,'{}'::jsonb) || jsonb_build_object(
            'authority','SERVER_CONSTRAINT_COMPILER_V49',
            'serverDerivedConstraintModel',true,
            'actorRoleRechecked',v_selected_role
          )
          where studio_id=p_studio_id
            and action='CONSTRAINT_MODEL_PUBLISHED'
            and (payload->>'constraintModelVersion')::integer=(v_result->>'constraintModelVersion')::integer;

          return v_result || jsonb_build_object(
            'authority','SERVER_CONSTRAINT_COMPILER_V49',
            'serverDerivedConstraintModel',true
          );
        end
        $function$;

        revoke all on function public.publish_server_constraint_model_v49(uuid,uuid,jsonb,text,integer)
          from public,anon,authenticated;
        grant execute on function public.publish_server_constraint_model_v49(uuid,uuid,jsonb,text,integer)
          to service_role;

        create or replace function public.adopt_solver_candidate_v49(
          p_studio_id uuid,
          p_actor_user_id uuid,
          p_actor_label text,
          p_reason text,
          p_expected_context jsonb,
          p_candidate jsonb,
          p_application_validation jsonb
        )
        returns jsonb
        language plpgsql
        security definer
        set search_path=''
        as $function$
        declare
          v_selected_role text;
          v_result jsonb;
        begin
          if p_studio_id is null then raise exception 'Studio is required'; end if;
          if p_actor_user_id is null then raise exception 'Actor is required'; end if;

          -- The service key is transport authority, not human authorization.
          -- Recheck the submitted actor at commit time so revoked/downgraded users
          -- cannot adopt with a request authorized earlier in the route lifecycle.
          select m.role into v_selected_role
          from public.studio_members m
          where m.studio_id=p_studio_id and m.user_id=p_actor_user_id;
          if v_selected_role not in ('OWNER','EDITOR') then
            raise exception 'Editor membership required for selected workspace';
          end if;

          v_result:=public.adopt_solver_candidate_v44(
            p_studio_id,p_actor_user_id,p_actor_label,p_reason,
            p_expected_context,p_candidate,p_application_validation
          );
          return v_result || jsonb_build_object(
            'authority','SERVER_CONSTRAINT_IR_V49',
            'actorRoleRechecked',true
          );
        end
        $function$;

        revoke all on function public.adopt_solver_candidate_v49(uuid,uuid,text,text,jsonb,jsonb,jsonb)
          from public,anon,authenticated;
        grant execute on function public.adopt_solver_candidate_v49(uuid,uuid,text,text,jsonb,jsonb,jsonb)
          to service_role;
    ''')

    replace_once(
        "app/api/solver/feasibility/route.ts",
        'import { getServerSupabase } from "@/lib/supabase";',
        'import { getServerAdminSupabase, getServerSupabase } from "@/lib/supabase";',
    )
    replace_once(
        "app/api/solver/feasibility/route.ts",
        '''async function publishConstraintModelForSolve(\n  supabase: SupabaseClient,\n  problem: FeasibilitySolverProblem,\n  published: PublishedConstraintModelRecord | null,\n) {\n  const decision = constraintModelSyncDecision(problem, published);\n  if (decision.action !== "PUBLISH") return false;\n\n  const definition = constraintModelDefinition(problem.constraintModel);\n  const result = await supabase.rpc("publish_constraint_model_v30", {\n    p_snapshot: definition,\n    p_reason: `Solver preflight sync of ${definition.compilerVersion} for Rulebook v${definition.rulebookVersion}: ${decision.reason}`,\n    p_expected_rulebook_version: problem.context.rulebookVersion,\n  });\n  if (result.error) throw result.error;\n  return true;\n}\n''',
        '''async function publishConstraintModelForSolve(\n  actorUserId: string,\n  problem: FeasibilitySolverProblem,\n  published: PublishedConstraintModelRecord | null,\n) {\n  const decision = constraintModelSyncDecision(problem, published);\n  if (decision.action !== "PUBLISH") return false;\n\n  // T13: only the deterministic server compiler may cross the publication\n  // boundary. Browser-authenticated clients no longer execute V3.0 directly.\n  const definition = constraintModelDefinition(problem.constraintModel);\n  const admin = getServerAdminSupabase();\n  const result = await admin.rpc("publish_server_constraint_model_v49", {\n    p_studio_id: STUDIO_ID,\n    p_actor_user_id: actorUserId,\n    p_snapshot: definition,\n    p_reason: `Solver preflight sync of ${definition.compilerVersion} for Rulebook v${definition.rulebookVersion}: ${decision.reason}`,\n    p_expected_rulebook_version: problem.context.rulebookVersion,\n  });\n  if (result.error) throw result.error;\n  return true;\n}\n''',
    )
    replace_once(
        "app/api/solver/feasibility/route.ts",
        '''  options: { syncPublishedModel?: boolean } = {},\n) {''',
        '''  options: { syncPublishedModel?: boolean; actorUserId?: string } = {},\n) {''',
    )
    replace_once(
        "app/api/solver/feasibility/route.ts",
        '''  if (options.syncPublishedModel && await publishConstraintModelForSolve(supabase, preparation.problem, published)) {''',
        '''  if (options.syncPublishedModel) {\n    if (!options.actorUserId) throw new Error("Constraint Model publication requires an authenticated actor.");\n  }\n  if (options.syncPublishedModel && await publishConstraintModelForSolve(options.actorUserId!, preparation.problem, published)) {''',
    )
    replace_once(
        "app/api/solver/feasibility/route.ts",
        '''    const gateway = await buildGatewayPreflight(authorized.supabase, { syncPublishedModel: true });''',
        '''    const gateway = await buildGatewayPreflight(authorized.supabase, {\n      syncPublishedModel: true,\n      actorUserId: authorized.userId,\n    });''',
    )

    replace_once(
        "app/api/solver/adopt/route.ts",
        'admin.rpc("adopt_solver_candidate_v44", {',
        'admin.rpc("adopt_solver_candidate_v49", {',
    )

    write("tests/legacy-write-bypass-closure.test.ts", r'''
        import { readFileSync } from "node:fs";
        import { describe, expect, it } from "vitest";

        const migration = readFileSync(
          "supabase/migrations/20260907190000_close_legacy_write_bypasses_v49.sql",
          "utf8",
        );
        const feasibility = readFileSync("app/api/solver/feasibility/route.ts", "utf8");
        const adoption = readFileSync("app/api/solver/adopt/route.ts", "utf8");
        const dbHarness = readFileSync("scripts/test-db.mjs", "utf8");

        describe("T13 legacy write bypass closure", () => {
          it("retires every superseded schedule writer from browser and direct service execution", () => {
            for (const name of [
              "apply_schedule_patch_v21",
              "rebase_current_schedule_v21",
              "apply_schedule_patch_v22",
              "rebase_current_schedule_v22",
              "apply_schedule_builder_patch_v23",
              "undo_last_schedule_change_v23",
              "apply_schedule_command_v25",
              "undo_last_schedule_change_v25",
              "rebase_current_schedule_v25",
            ]) {
              expect(migration).toContain(name);
            }
            expect(migration).toContain("from public,anon,authenticated,service_role");
          });

          it("makes Constraint Model publication a server-derived service-role boundary", () => {
            expect(migration).toContain("publish_server_constraint_model_v49");
            expect(migration).toContain("Editor membership required for selected workspace");
            expect(migration).toContain("SERVER_CONSTRAINT_COMPILER_V49");
            expect(feasibility).toContain("getServerAdminSupabase");
            expect(feasibility).toContain('admin.rpc("publish_server_constraint_model_v49"');
            expect(feasibility).not.toContain('supabase.rpc("publish_constraint_model_v30"');
          });

          it("rechecks the human actor inside the privileged adoption transaction", () => {
            expect(migration).toContain("adopt_solver_candidate_v49");
            expect(migration).toContain("where m.studio_id=p_studio_id and m.user_id=p_actor_user_id");
            expect(migration).toContain("v_selected_role not in ('OWNER','EDITOR')");
            expect(adoption).toContain('admin.rpc("adopt_solver_candidate_v49"');
          });

          it("removes direct service execution of the old publication and adoption primitives", () => {
            expect(migration).toContain("publish_constraint_model_v30(jsonb,text,integer)");
            expect(migration).toContain("adopt_solver_candidate_v33");
            expect(migration).toContain("adopt_solver_candidate_v44");
          });

          it("executes privilege enumeration and denied direct-RPC regressions in PostgreSQL", () => {
            expect(dbHarness).toContain("T13 legacy function remains executable");
            expect(dbHarness).toContain("T13 authenticated legacy schedule RPC unexpectedly executed");
            expect(dbHarness).toContain("T13 direct V3.0 model publication unexpectedly executed");
            expect(dbHarness).toContain("T13 actor role recheck did not reject downgraded editor");
            expect(dbHarness).toContain("T13 PASS:");
          });
        });
    ''')

    # T03's round-trip test remains a semantic model test, but after T13 the
    # publication primitive is intentionally inaccessible. Exercise it through
    # the new server boundary as service_role with an explicit actor/studio.
    replace_once(
        "scripts/test-db.mjs",
        "v_first:=public.publish_constraint_model_v30(v_submitted,'T03 JSONB publication',v_rulebook);",
        "v_first:=public.publish_server_constraint_model_v49('11111111-1111-4111-8111-111111111111','10000000-0000-4000-8000-000000000001',v_submitted,'T03 JSONB publication',v_rulebook);",
    )
    replace_once(
        "scripts/test-db.mjs",
        "v_republished:=public.publish_constraint_model_v30(v_reordered,'T03 JSONB reordered read-back',v_rulebook);",
        "v_republished:=public.publish_server_constraint_model_v49('11111111-1111-4111-8111-111111111111','10000000-0000-4000-8000-000000000001',v_reordered,'T03 JSONB reordered read-back',v_rulebook);",
    )
    replace_once(
        "scripts/test-db.mjs",
        "const constraintModelOutput = psql(container, 'authenticated', constraintModelRoundTripSql, 'Constraint Model JSONB round-trip integration tests');",
        "const constraintModelOutput = psql(container, 'service_role', constraintModelRoundTripSql, 'Constraint Model JSONB round-trip integration tests');",
    )

    replace_once(
        "scripts/test-db.mjs",
        '''    const recoveryOutput = psql(container, 'postgres', authoritativeRecoverySql, 'T12 authoritative rebase/undo recovery integration tests');\n    process.stdout.write(recoveryOutput);''',
        '''    const recoveryOutput = psql(container, 'postgres', authoritativeRecoverySql, 'T12 authoritative rebase/undo recovery integration tests');\n    process.stdout.write(recoveryOutput);\n    const bypassClosureOutput = psql(container, 'postgres', legacyWriteBypassClosureSql, 'T13 legacy write bypass closure integration tests');\n    process.stdout.write(bypassClosureOutput);''',
    )

    replace_once(
        "scripts/test-db.mjs",
        '''select 'T12 PASS: archive-aware REBASE preserves history; current-policy UNDO normalizes duration; stale replay and effective-lock rollback reject atomically' as result;\n`;\n\nexport async function main''',
        r'''select 'T12 PASS: archive-aware REBASE preserves history; current-policy UNDO normalizes duration; stale replay and effective-lock rollback reject atomically' as result;
`;

const legacyWriteBypassClosureSql = String.raw`
set search_path=public,extensions;

-- Enumerate every known superseded writer after all migrations. Historical
-- functions may remain for owner-level internal delegation, but neither an
-- authenticated browser nor a service-role application caller may invoke them.
do $block$
declare
  v_sig text;
  v_legacy text[]:=array[
    'public.apply_schedule_patch_v21(text,jsonb,text,integer,integer,boolean)',
    'public.rebase_current_schedule_v21(integer,integer,text)',
    'public.apply_schedule_patch_v22(text,jsonb,text,integer,integer,integer,boolean)',
    'public.rebase_current_schedule_v22(integer,integer,integer,text)',
    'public.apply_schedule_builder_patch_v23(text,text,text,jsonb,text,integer,integer,integer,boolean)',
    'public.undo_last_schedule_change_v23(integer,integer,integer,text)',
    'public.apply_schedule_command_v25(text,text,text,jsonb,text,integer,integer,integer,integer,boolean)',
    'public.undo_last_schedule_change_v25(integer,integer,integer,integer,text)',
    'public.rebase_current_schedule_v25(integer,integer,integer,integer,text)',
    'public.publish_constraint_model_v30(jsonb,text,integer)',
    'public.adopt_solver_candidate_v33(uuid,uuid,text,text,integer,integer,integer,integer,integer,jsonb,jsonb)',
    'public.adopt_solver_candidate_v44(uuid,uuid,text,text,jsonb,jsonb,jsonb)'
  ];
begin
  foreach v_sig in array v_legacy loop
    if to_regprocedure(v_sig) is null then raise exception 'T13 expected historical function is missing: %',v_sig; end if;
    if has_function_privilege('authenticated',v_sig,'execute')
       or has_function_privilege('service_role',v_sig,'execute') then
      raise exception 'T13 legacy function remains executable: %',v_sig;
    end if;
  end loop;

  foreach v_sig in array array[
    'public.apply_authoritative_move_v46(uuid,uuid,text,jsonb,text,jsonb,jsonb,boolean)',
    'public.apply_authoritative_incremental_command_v47(text,uuid,uuid,text,text,jsonb,text,jsonb,jsonb,jsonb,boolean)',
    'public.apply_authoritative_schedule_recovery_v48(text,uuid,uuid,uuid,text,jsonb,jsonb,jsonb,jsonb)',
    'public.publish_server_constraint_model_v49(uuid,uuid,jsonb,text,integer)',
    'public.adopt_solver_candidate_v49(uuid,uuid,text,text,jsonb,jsonb,jsonb)'
  ] loop
    if not has_function_privilege('service_role',v_sig,'execute') then
      raise exception 'T13 canonical service boundary is not executable: %',v_sig;
    end if;
    if has_function_privilege('authenticated',v_sig,'execute') then
      raise exception 'T13 canonical service boundary leaked to authenticated: %',v_sig;
    end if;
  end loop;
end
$block$;

-- A browser-authenticated caller cannot execute the legacy schedule or model
-- publication surfaces even with a valid owner JWT claim.
set role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',false);
do $block$
declare
  v_rejected boolean:=false;
  v_before integer;
begin
  select count(*) into v_before from public.schedule_versions where studio_id='11111111-1111-4111-8111-111111111111';
  begin
    perform public.apply_schedule_command_v25(
      'MOVE','t11-assignment',null,'{"day":"Tuesday"}'::jsonb,'T13 must deny direct V2.5',
      0,0,0,0,false
    );
  exception when insufficient_privilege then
    v_rejected:=true;
  end;
  if not v_rejected then raise exception 'T13 authenticated legacy schedule RPC unexpectedly executed'; end if;
  if (select count(*) from public.schedule_versions where studio_id='11111111-1111-4111-8111-111111111111')<>v_before then
    raise exception 'T13 denied legacy schedule RPC changed history';
  end if;

  v_rejected:=false;
  begin
    perform public.publish_constraint_model_v30('{}'::jsonb,'T13 must deny direct V3.0',0);
  exception when insufficient_privilege then
    v_rejected:=true;
  end;
  if not v_rejected then raise exception 'T13 direct V3.0 model publication unexpectedly executed'; end if;
end
$block$;
reset role;

-- The privileged publication and adoption boundaries recheck the human actor's
-- current membership inside the transaction. A user authorized earlier in the
-- request cannot commit after being downgraded to VIEWER.
update public.studio_members
set role='VIEWER'
where studio_id='11111111-1111-4111-8111-111111111111'
  and user_id='10000000-0000-4000-8000-000000000002';
set role service_role;
do $block$
declare
  v_rejected boolean:=false;
begin
  begin
    perform public.publish_server_constraint_model_v49(
      '11111111-1111-4111-8111-111111111111',
      '10000000-0000-4000-8000-000000000002',
      '{}'::jsonb,'T13 downgraded model publisher',0
    );
  exception when others then
    if position('Editor membership required for selected workspace' in sqlerrm)=0 then raise; end if;
    v_rejected:=true;
  end;
  if not v_rejected then raise exception 'T13 actor role recheck did not reject downgraded editor'; end if;

  v_rejected:=false;
  begin
    perform public.adopt_solver_candidate_v49(
      '11111111-1111-4111-8111-111111111111',
      '10000000-0000-4000-8000-000000000002',
      'T13 downgraded editor','T13 must reject downgraded adoption',
      '{}'::jsonb,'[]'::jsonb,'{}'::jsonb
    );
  exception when others then
    if position('Editor membership required for selected workspace' in sqlerrm)=0 then raise; end if;
    v_rejected:=true;
  end;
  if not v_rejected then raise exception 'T13 adoption actor role recheck did not reject downgraded editor'; end if;
end
$block$;
reset role;
update public.studio_members
set role='EDITOR'
where studio_id='11111111-1111-4111-8111-111111111111'
  and user_id='10000000-0000-4000-8000-000000000002';

-- Retained readers are intentional: coherent snapshot/context and historical
-- version rows remain readable under membership/RLS. T13 only closes mutation
-- surfaces and does not erase audit/history inspection.
do $block$
begin
  if not has_function_privilege('authenticated','public.get_solver_context_token_v43(uuid)','execute')
     or not has_function_privilege('authenticated','public.get_solver_snapshot_v43(uuid)','execute') then
    raise exception 'T13 accidentally revoked governed coherent readers';
  end if;
end
$block$;

select 'T13 PASS: privilege enumeration leaves only current service authority; authenticated legacy schedule/model RPCs deny; downgraded actors fail publication/adoption; governed readers remain' as result;
`;

export async function main''',
    )


def finalize(implementation_sha: str, run_id: str):
    tasks = ROOT / "plans/TASKS.md"
    text = tasks.read_text(encoding="utf-8")
    text = text.replace("| [T13](#t13) | Close legacy write bypasses | READY |", "| [T13](#t13) | Close legacy write bypasses | DONE |", 1)
    text = text.replace("| [T14](#t14) | Representative full DWDE acceptance fixture/solve | NOT_STARTED |", "| [T14](#t14) | Representative full DWDE acceptance fixture/solve | BLOCKED |", 1)
    marker = "## T13 — Close legacy write bypasses"
    section_start = text.index(marker)
    section_end = text.index("<a id=\"t14\"></a>", section_start)
    section = text[section_start:section_end]
    section = section.replace("| Status | READY |", "| Status | DONE |", 1)
    for criterion in [
        "All superseded canonical scheduling write entry points are revoked or delegate safely; authenticated callers cannot bypass IR.",
        "Privileged transactions recheck the actor's current role for the explicit studio and version context.",
        "Constraint publication is server-derived or equivalently protected against arbitrary client artifacts.",
        "Executed privilege enumeration and direct-RPC tests demonstrate no legacy bypass; retained historical readers are documented.",
    ]:
        section = section.replace(f"- [ ] {criterion}", f"- [x] {criterion}")
    old_evidence = "Not yet verified. Record commit SHA, exact commands/exit codes, environment, regression cases, artifact links, manager acceptance where required, and remaining limitations. No implementation task was marked DONE during plan creation."
    evidence = f'''Task/child: T13\n\nStarting HEAD: `c7e072fa135f4dde8bed71af3ea391c41f547717`.\n\nImplementation commit: `{implementation_sha}`. GitHub Actions verification run: `{run_id}`.\n\nImplemented forward migration `supabase/migrations/20260907190000_close_legacy_write_bypasses_v49.sql`, server publication/adoption route changes, `tests/legacy-write-bypass-closure.test.ts`, and executed disposable PostgreSQL regressions in `scripts/test-db.mjs`. Historical migrations and production-ledger bytes remain unchanged.\n\nAuthority closure: V2.1/V2.2/V2.3/V2.5 schedule mutation/rebase/undo functions, V3.0 arbitrary-artifact Constraint Model publication, direct V3.3 adoption, and V4.4 adoption primitive are no longer executable by `authenticated` or direct `service_role` application callers. V4.6 MOVE, V4.7 ASSIGN/UNASSIGN, V4.8 recovery, V4.9 deterministic model publication, and V4.9 reviewed candidate adoption are the retained service-role scheduling mutation surfaces. Historical functions remain owner-callable only where a current SECURITY DEFINER wrapper delegates structurally.\n\nActor authorization: V4.9 Constraint Model publication and solver adoption recheck `studio_members` for the explicit studio/actor and require OWNER/EDITOR inside the privileged transaction. The publication compatibility bridge also rejects selected-workspace mismatch. Existing V4.6/V4.7/V4.8 already perform the same commit-time role check.\n\nConstraint publication: feasibility preflight now builds the Constraint IR with the deterministic server compiler and publishes only through service-role `publish_server_constraint_model_v49`; browser-authenticated callers cannot submit artifacts directly to V3.0.\n\nExecuted DB evidence: post-migration privilege enumeration verifies all retired signatures are denied to authenticated/service roles and all current service boundaries are authenticated-denied/service-role-allowed. Direct authenticated V2.5 schedule and V3.0 model-publication calls raise privilege errors without creating versions. Downgrading an EDITOR to VIEWER immediately blocks V4.9 publication and adoption despite service-role transport. Governed coherent snapshot/context readers remain executable so history and diagnostics stay inspectable.\n\nVerification: run `{run_id}` passed `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`, and Ubuntu `npm run test:db`; Windows passed lint/typecheck/test/build with Docker DB integration intentionally Linux-only. Lint retained only the pre-existing warnings.\n\nNo production or staging database was read or mutated, and V4.9 is only a forward migration pending separately authorized deployment.\n\nResulting task status: DONE. T14 dependency chain is satisfied but T14 is BLOCKED on the manager-reviewed complete DWDE planning snapshot required by its own acceptance criteria; synthetic data cannot satisfy that gate.'''
    section = section.replace(old_evidence, evidence, 1)
    section = section.replace(
        "Dependencies T10, T11, and T12 are verified DONE. T13 is READY and is the first executable unfinished task.",
        "Dependencies T10, T11, and T12 are verified DONE. T13 is DONE. T14 is dependency-ready but BLOCKED pending the manager-reviewed complete DWDE planning snapshot; see BLK-014.",
        1,
    )
    text = text[:section_start] + section + text[section_end:]

    t14_start = text.index("## T14 — Representative full DWDE acceptance fixture/solve")
    t14_end = text.index("<a id=\"t15\"></a>", t14_start)
    t14 = text[t14_start:t14_end]
    t14 = t14.replace("| Status | NOT_STARTED |", "| Status | BLOCKED |", 1)
    t14 = t14.replace(
        "Waiting for dependency acceptance: T05, T06, T07, T08, T09, T10, T11, T12, T13. This is normal sequencing, not a BLOCKED status.",
        "BLK-014 — 2026-09-07: T13 is verified DONE, so code dependencies are satisfied. Full T14 acceptance requires a manager-reviewed complete DWDE snapshot covering people/classes/sessions/rosters/qualifications/availability and explicit omissions. The current planning inventory is not yet manager-confirmed complete. Impact: a synthetic fixture may support development but cannot be called full DWDE acceptance. Owner/action: Cami/manager reviews and confirms the exact PlanningDatasetVersion/hash and missing facts. Unblock condition: manager-confirmed complete DWDE snapshot is available for the private acceptance fixture.",
        1,
    )
    text = text[:t14_start] + t14 + text[t14_end:]
    tasks.write_text(text, encoding="utf-8", newline="\n")

    readme = ROOT / "plans/README.md"
    r = readme.read_text(encoding="utf-8")
    r = r.replace("Current task: **T13 — close legacy write bypasses**.", "Current task: **T14 — blocked pending manager-reviewed complete DWDE planning data**.", 1)
    r = r.replace("Next task: T14 after T13 acceptance.", "Next task after the data gate: T14 acceptance fixture/solve, then T15.", 1)
    old_progress = next(line for line in r.splitlines() if line.startswith("- Implementation progress:"))
    new_progress = f"- Implementation progress: T01 through T13 have verified DONE evidence. T13 closes authenticated/direct-service legacy scheduling and model-publication RPC bypasses, moves deterministic Constraint Model publication behind service-role V4.9, and adds commit-time actor-role checking to V4.9 solver adoption. T14 is BLOCKED only on the required manager-reviewed complete DWDE Planning Dataset snapshot."
    r = r.replace(old_progress, new_progress, 1)
    r = r.replace("- T13: revoke/delegate superseded canonical write entry points and prove direct legacy-call denial.\n", "- T13: verified DONE; superseded canonical write entry points are retired from application roles and direct legacy-call denial is executed in the DB harness.\n", 1)
    readme.write_text(r, encoding="utf-8", newline="\n")

    next_path = ROOT / "plans/NEXT.md"
    n = next_path.read_text(encoding="utf-8")
    n = n.replace("T13", "T13", 1)  # preserve file even if its prose format differs
    n += f"\n\n## T13 handoff ({implementation_sha[:10]})\n\nT13 is DONE via verification run `{run_id}`. The next milestone task is T14, currently BLOCKED by BLK-014 until the manager reviews/confirms a complete DWDE PlanningDatasetVersion. Do not substitute synthetic facts for that acceptance evidence.\n"
    next_path.write_text(n, encoding="utf-8", newline="\n")

    release = ROOT / "plans/DWDE_RELEASE_PLAN.md"
    d = release.read_text(encoding="utf-8")
    d = d.replace(
        "T10 MOVE, T11 ASSIGN/UNASSIGN, and T12 rebase/undo server-authority matrices are verified; gate remains open only for T13 direct legacy-call denial.",
        "Verified: T10 MOVE, T11 ASSIGN/UNASSIGN, T12 rebase/undo, and T13 executed privilege/direct-call closure leave current service Constraint-IR authority as the application write surface.",
        1,
    )
    release.write_text(d, encoding="utf-8", newline="\n")


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "finalize":
        if len(sys.argv) != 4:
            raise SystemExit("usage: t13-apply.py finalize <implementation-sha> <run-id>")
        finalize(sys.argv[2], sys.argv[3])
    else:
        apply_impl()
