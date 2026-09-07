-- T10 / V4.6 authoritative manual MOVE boundary.
--
-- Browser clients no longer commit MOVE directly through the legacy authenticated
-- RPC. The application server validates one coherent pinned snapshot against the
-- complete Constraint IR, then this service-role-only wrapper atomically proves
-- that exact context is still current before delegating the structural/versioned
-- write to V2.5. ASSIGN/UNASSIGN and legacy grant retirement remain T11/T13.

create or replace function public.apply_authoritative_move_v46(
  p_studio_id uuid,
  p_actor_user_id uuid,
  p_assignment_id text,
  p_changes jsonb,
  p_reason text,
  p_expected_context jsonb,
  p_application_validation jsonb,
  p_ai_proposed boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $function$
declare
  v_selected_role text;
  v_actor_context jsonb;
  v_current_context jsonb;
  v_result jsonb;
  v_schedule_id uuid;
  v_constraint_model_version integer;
begin
  if p_studio_id is null then raise exception 'Studio is required'; end if;
  if p_actor_user_id is null then raise exception 'Actor is required'; end if;
  if coalesce(btrim(p_assignment_id),'')='' then raise exception 'Assignment is required'; end if;
  if coalesce(btrim(p_reason),'')='' then raise exception 'Reason is required'; end if;
  if p_changes is null or jsonb_typeof(p_changes)<>'object' then raise exception 'Canonical MOVE changes are required'; end if;
  if p_application_validation is null or jsonb_typeof(p_application_validation)<>'object' then
    raise exception 'Authoritative application Constraint IR validation is required';
  end if;
  select m.role into v_selected_role
  from public.studio_members m
  where m.studio_id=p_studio_id and m.user_id=p_actor_user_id;
  if v_selected_role not in ('OWNER','EDITOR') then
    raise exception 'Editor membership required for selected workspace';
  end if;

  -- V2.5 still derives its studio from the user's highest-priority legacy
  -- membership. T10 therefore rejects a different selected workspace instead of
  -- silently writing to the wrong tenant. T22/T23 replace this compatibility
  -- bridge with tenant-explicit commands.
  perform pg_catalog.set_config('request.jwt.claim.sub',p_actor_user_id::text,true);
  v_actor_context:=private.assert_editor_context();
  if (v_actor_context->>'studio_id')::uuid is distinct from p_studio_id then
    raise exception 'WORKSPACE_SELECTION_MISMATCH: selected %, legacy active %',p_studio_id,v_actor_context->>'studio_id';
  end if;

  if p_expected_context is null or jsonb_typeof(p_expected_context)<>'object'
     or p_expected_context->>'schemaVersion'<>'1.0'
     or p_expected_context->>'studioId' is distinct from p_studio_id::text
     or coalesce(p_expected_context->>'scheduleId','')=''
     or coalesce(p_expected_context->>'scheduleAssignmentsHash','')=''
     or coalesce(p_expected_context->>'constraintModelVersion','')='' then
    raise exception 'MANUAL_MOVE_CONTEXT_INVALID: exact pinned scheduling context is required';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_studio_id::text,0));
  perform pg_advisory_xact_lock(hashtextextended('planning-dataset:'||p_studio_id::text,0));
  perform pg_advisory_xact_lock(hashtextextended('constraint-model:'||p_studio_id::text,0));

  v_current_context:=private.build_solver_context_token_v43(p_studio_id);
  if v_current_context is distinct from p_expected_context then
    raise exception 'STALE_MANUAL_MOVE_CONTEXT: ScheduleVersion/locks/policy/planning/model context changed after server validation';
  end if;
  v_constraint_model_version:=(p_expected_context->>'constraintModelVersion')::integer;

  -- End time is intentionally absent from p_changes. V2.5 derives it from the
  -- effective session override/class duration inside the same transaction.
  v_result:=public.apply_schedule_command_v25(
    'MOVE',
    p_assignment_id,
    null,
    p_changes,
    p_reason,
    (p_expected_context->>'scheduleVersion')::integer,
    (p_expected_context->>'rulebookVersion')::integer,
    (p_expected_context->>'enforcementVersion')::integer,
    (p_expected_context->>'planningDatasetVersion')::integer,
    p_ai_proposed
  );

  select sv.id into v_schedule_id
  from public.schedule_versions sv
  where sv.studio_id=p_studio_id
    and sv.is_current
    and sv.version=(v_result->>'scheduleVersion')::integer;
  if v_schedule_id is null then raise exception 'MANUAL_MOVE_PERSISTENCE_FAILED: new current ScheduleVersion is missing'; end if;

  -- V2.5 predates ConstraintModelVersion linkage. Preserve the exact pinned model
  -- on the new version so subsequent coherent reads do not become stale solely
  -- because a legal manual move occurred.
  update public.schedule_versions
  set constraint_model_version=v_constraint_model_version
  where id=v_schedule_id;

  update public.audit_events
  set payload=coalesce(payload,'{}'::jsonb) || jsonb_build_object(
    'authority','SERVER_CONSTRAINT_IR_V46',
    'authoritativeConstraintIr',true,
    'constraintModelVersion',v_constraint_model_version,
    'expectedSolverContext',p_expected_context,
    'applicationConstraintIrValidation',p_application_validation,
    'legacyWriteBypassRetirementTask','T13'
  )
  where studio_id=p_studio_id
    and action='SCHEDULE_COMMAND'
    and entity_id=p_assignment_id
    and (payload->>'scheduleVersion')::integer=(v_result->>'scheduleVersion')::integer;

  return v_result || jsonb_build_object(
    'scheduleId',v_schedule_id,
    'constraintModelVersion',v_constraint_model_version,
    'authority','SERVER_CONSTRAINT_IR_V46',
    'authoritativeConstraintIr',true
  );
end
$function$;

revoke all on function public.apply_authoritative_move_v46(uuid,uuid,text,jsonb,text,jsonb,jsonb,boolean)
  from public,anon,authenticated;
grant execute on function public.apply_authoritative_move_v46(uuid,uuid,text,jsonb,text,jsonb,jsonb,boolean)
  to service_role;
