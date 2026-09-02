-- Milestone 2 / V3.0 tested ConstraintModelVersion publication boundary.
--
-- The TypeScript compiler produces the model. PostgreSQL validates, versions,
-- fingerprints, audits, and stores that compiled artifact. This does not create
-- another handwritten interpretation of Rulebook semantics.

create or replace function public.publish_constraint_model_v30(
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
  ctx jsonb:=private.assert_editor_context();
  v_uid uuid:=(ctx->>'user_id')::uuid;
  v_studio uuid:=(ctx->>'studio_id')::uuid;
  v_actor text:=ctx->>'actor';
  v_current_rulebook integer;
  v_current public.constraint_model_versions%rowtype;
  v_hash text;
  v_version integer;
  v_compiler text:=coalesce(p_snapshot->>'compilerVersion','');
  v_complete boolean:=coalesce((p_snapshot->>'completeHardConstraintCompilation')::boolean,false);
begin
  if coalesce(btrim(p_reason),'')='' then raise exception 'Reason is required'; end if;

  select version into v_current_rulebook
  from public.rulebook_versions
  where studio_id=v_studio and status='CURRENT'
  limit 1;

  if v_current_rulebook is null then raise exception 'No current RulebookVersion exists'; end if;
  if v_current_rulebook<>p_expected_rulebook_version then
    raise exception 'STALE_RULEBOOK: expected %, current %',p_expected_rulebook_version,v_current_rulebook;
  end if;

  perform private.validate_constraint_model_snapshot_v27(p_snapshot,v_current_rulebook,v_compiler);
  if v_complete is not true then raise exception 'Only complete HARD Constraint IR models may be published'; end if;

  perform pg_advisory_xact_lock(hashtextextended('constraint-model:'||v_studio::text,0));
  v_hash:=private.constraint_model_hash_v27(p_snapshot);

  select * into v_current
  from public.constraint_model_versions
  where studio_id=v_studio and status='CURRENT'
  limit 1;

  if v_current.id is not null
     and v_current.snapshot_hash=v_hash
     and v_current.rulebook_version=v_current_rulebook
     and v_current.compiler_version=v_compiler then
    return jsonb_build_object(
      'constraintModelVersion',v_current.version,
      'snapshotHash',v_hash,
      'rulebookVersion',v_current_rulebook,
      'compilerVersion',v_compiler,
      'alreadyCurrent',true
    );
  end if;

  select coalesce(max(version),0)+1 into v_version
  from public.constraint_model_versions
  where studio_id=v_studio;

  update public.constraint_model_versions
  set status='HISTORICAL'
  where studio_id=v_studio and status='CURRENT';

  insert into public.constraint_model_versions(
    studio_id,version,rulebook_version,compiler_version,actor_user_id,actor_label,reason,
    snapshot,snapshot_hash,complete_hard_constraint_compilation,status
  ) values(
    v_studio,v_version,v_current_rulebook,v_compiler,v_uid,v_actor,p_reason,
    p_snapshot,v_hash,true,'CURRENT'
  );

  insert into public.audit_events(
    studio_id,actor_user_id,actor_label,action,entity_type,entity_id,detail,payload
  ) values(
    v_studio,v_uid,v_actor,'CONSTRAINT_MODEL_PUBLISHED','CONSTRAINT_MODEL',v_version::text,p_reason,
    jsonb_build_object(
      'constraintModelVersion',v_version,
      'snapshotHash',v_hash,
      'rulebookVersion',v_current_rulebook,
      'compilerVersion',v_compiler,
      'previousConstraintModelVersion',case when v_current.id is null then null else v_current.version end
    )
  );

  return jsonb_build_object(
    'constraintModelVersion',v_version,
    'snapshotHash',v_hash,
    'rulebookVersion',v_current_rulebook,
    'compilerVersion',v_compiler,
    'alreadyCurrent',false
  );
end
$function$;

revoke all on function public.publish_constraint_model_v30(jsonb,text,integer) from public,anon;
grant execute on function public.publish_constraint_model_v30(jsonb,text,integer) to authenticated,service_role;
