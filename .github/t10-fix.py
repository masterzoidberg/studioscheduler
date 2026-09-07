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

# The disposable bootstrap requires a non-null studio slug. Keep the T10 second-
# workspace witness fully valid so failures reach the tenant-selection guard.
db_path = Path("scripts/test-db.mjs")
db = db_path.read_text(encoding="utf-8")
old = "insert into public.studios(id,name)\nvalues ('22222222-2222-4222-8222-222222222222','T10 Other Studio')"
new = "insert into public.studios(id,slug,name)\nvalues ('22222222-2222-4222-8222-222222222222','t10-other-studio','T10 Other Studio')"
if db.count(old) != 1:
    raise SystemExit(f"expected one T10 second-studio fixture match, found {db.count(old)}")
db_path.write_text(db.replace(old, new, 1), encoding="utf-8", newline="\n")
