from pathlib import Path

path = Path("supabase/migrations/20260907110000_authoritative_manual_move_v46.sql")
text = path.read_text(encoding="utf-8")

context_block = '''  if p_expected_context is null or jsonb_typeof(p_expected_context)<>'object'\n     or p_expected_context->>'schemaVersion'<>'1.0'\n     or p_expected_context->>'studioId' is distinct from p_studio_id::text\n     or coalesce(p_expected_context->>'scheduleId','')=''\n     or coalesce(p_expected_context->>'scheduleAssignmentsHash','')=''\n     or coalesce(p_expected_context->>'constraintModelVersion','')='' then\n    raise exception 'MANUAL_MOVE_CONTEXT_INVALID: exact pinned scheduling context is required';\n  end if;\n\n'''

workspace_block = '''  select m.role into v_selected_role\n  from public.studio_members m\n  where m.studio_id=p_studio_id and m.user_id=p_actor_user_id;\n  if v_selected_role not in ('OWNER','EDITOR') then\n    raise exception 'Editor membership required for selected workspace';\n  end if;\n\n  -- V2.5 still derives its studio from the user's highest-priority legacy\n  -- membership. T10 therefore rejects a different selected workspace instead of\n  -- silently writing to the wrong tenant. T22/T23 replace this compatibility\n  -- bridge with tenant-explicit commands.\n  perform pg_catalog.set_config('request.jwt.claim.sub',p_actor_user_id::text,true);\n  v_actor_context:=private.assert_editor_context();\n  if (v_actor_context->>'studio_id')::uuid is distinct from p_studio_id then\n    raise exception 'WORKSPACE_SELECTION_MISMATCH: selected %, legacy active %',p_studio_id,v_actor_context->>'studio_id';\n  end if;\n\n'''

combined = context_block + workspace_block
if text.count(combined) != 1:
    raise SystemExit(f"expected one T10 context/workspace block, found {text.count(combined)}")
text = text.replace(combined, workspace_block + context_block, 1)
path.write_text(text, encoding="utf-8", newline="\n")

# Disposable-database fixture corrections. These alter only the generated test
# script, never application migrations or production permissions.
db_path = Path("scripts/test-db.mjs")
db = db_path.read_text(encoding="utf-8")

old = "insert into public.studios(id,name)\nvalues ('22222222-2222-4222-8222-222222222222','T10 Other Studio')"
new = "insert into public.studios(id,slug,name)\nvalues ('22222222-2222-4222-8222-222222222222','t10-other-studio','T10 Other Studio')"
if db.count(old) != 1:
    raise SystemExit(f"expected one T10 second-studio fixture match, found {db.count(old)}")
db = db.replace(old, new, 1)

# service_role intentionally has no USAGE on private. A disposable test-only
# SECURITY DEFINER witness captures the same context through the database owner,
# while the actual transaction is still invoked as service_role. It is dropped
# before the harness completes.
role_marker = "set role service_role;\ndo $block$"
context_helper = """create or replace function public.t10_test_solver_context(p_studio_id uuid)\nreturns jsonb\nlanguage sql\nsecurity definer\nset search_path=''\nas $$ select private.build_solver_context_token_v43(p_studio_id) $$;\nrevoke all on function public.t10_test_solver_context(uuid) from public,anon,authenticated;\ngrant execute on function public.t10_test_solver_context(uuid) to service_role;\n\nset role service_role;\ndo $block$"""
if db.count(role_marker) != 1:
    raise SystemExit(f"expected one T10 service-role marker, found {db.count(role_marker)}")
db = db.replace(role_marker, context_helper, 1)

private_call = "v_context:=private.build_solver_context_token_v43(v_studio);"
if db.count(private_call) != 2:
    raise SystemExit(f"expected two T10 private context calls, found {db.count(private_call)}")
db = db.replace(private_call, "v_context:=public.t10_test_solver_context(v_studio);", 2)

pass_marker = "reset role;\n\nselect 'T10 PASS: explicit tenant/context guard, duration-derived MOVE, pinned model linkage, audit evidence, and atomic stale/lock rejection' as result;"
pass_replacement = "reset role;\ndrop function public.t10_test_solver_context(uuid);\n\nselect 'T10 PASS: explicit tenant/context guard, duration-derived MOVE, pinned model linkage, audit evidence, and atomic stale/lock rejection' as result;"
if db.count(pass_marker) != 1:
    raise SystemExit(f"expected one T10 PASS cleanup marker, found {db.count(pass_marker)}")
db = db.replace(pass_marker, pass_replacement, 1)

db_path.write_text(db, encoding="utf-8", newline="\n")
