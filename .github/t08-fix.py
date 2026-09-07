from pathlib import Path


def patch(path: str, old: str, new: str, count: int = 1) -> None:
    p = Path(path)
    text = p.read_text(encoding="utf-8")
    if text.count(old) < count:
        raise SystemExit(f"T08 fix anchor missing in {path}: {old[:100]!r}")
    p.write_text(text.replace(old, new, count), encoding="utf-8", newline="\n")


# The service-role-only public adoption RPC needs owner privileges internally to
# cross the deliberately non-USAGE private schema boundary. EXECUTE remains
# revoked from public/anon/authenticated and granted only to service_role.
patch(
    "supabase/migrations/20260907070000_candidate_stale_schedule_binding_v44.sql",
    "language plpgsql\nsecurity invoker\nset search_path=''\nas $function$\ndeclare\n  v_current_context jsonb;",
    "language plpgsql\nsecurity definer\nset search_path=''\nas $function$\ndeclare\n  v_current_context jsonb;",
)

# Capture the test's reviewed context while still running as the disposable DB
# owner, then drop into service_role for every actual V4.4 adoption call. This
# tests the real RPC privilege boundary without granting service_role broad USAGE
# on the private schema.
patch(
    "scripts/test-db.mjs",
    "const candidateStaleBindingSql = String.raw`\nset search_path=public,extensions;\nset role service_role;\nselect set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',false);\ndo $block$",
    "const candidateStaleBindingSql = String.raw`\nset search_path=public,extensions;\nselect set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',false);\nselect set_config(\n  't08.reviewed_context',\n  private.build_solver_candidate_context_v44('11111111-1111-4111-8111-111111111111')::text,\n  false\n);\nset role service_role;\ndo $block$",
)
patch(
    "scripts/test-db.mjs",
    "  v_reviewed:=private.build_solver_candidate_context_v44(v_studio);",
    "  v_reviewed:=current_setting('t08.reviewed_context')::jsonb;",
)
patch(
    "scripts/test-db.mjs",
    "  v_current:=private.build_solver_candidate_context_v44(v_studio);",
    "  v_current:=jsonb_build_object(\n    'schemaVersion','1.0',\n    'compilerVersion',v_reviewed->>'compilerVersion',\n    'solverContextToken',public.get_solver_context_token_v43(v_studio)\n  );",
    2,
)
