-- T08 / V4.4 reviewed candidate binding.
--
-- A manager reviews a candidate generated from one T07 coherent context. Adoption
-- must use that submitted reviewed context transactionally rather than replacing
-- it with whichever ScheduleVersion/locks happen to be current when POST arrives.

create or replace function private.build_solver_candidate_context_v44(p_studio_id uuid)
returns jsonb
language sql
stable
security definer
set search_path=''
as $function$
  select jsonb_build_object(
    'schemaVersion','1.0',
    'compilerVersion',(
      select cm.compiler_version
      from public.constraint_model_versions cm
      where cm.studio_id=p_studio_id and cm.status='CURRENT'
      order by cm.version desc limit 1
    ),
    'solverContextToken',private.build_solver_context_token_v43(p_studio_id)
  )
$function$;

revoke all on function private.build_solver_candidate_context_v44(uuid) from public,anon,authenticated;
grant execute on function private.build_solver_candidate_context_v44(uuid) to service_role;

create or replace function public.adopt_solver_candidate_v44(
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
  v_current_context jsonb;
  v_token jsonb;
begin
  if p_studio_id is null then raise exception 'Studio is required'; end if;
  if p_expected_context is null or jsonb_typeof(p_expected_context)<>'object' then
    raise exception 'SOLVER_CANDIDATE_CONTEXT_INVALID: reviewed candidate context is required';
  end if;
  if not (p_expected_context ?& array['schemaVersion','compilerVersion','solverContextToken'])
     or (p_expected_context - array['schemaVersion','compilerVersion','solverContextToken']) <> '{}'::jsonb
     or p_expected_context->>'schemaVersion'<>'1.0'
     or coalesce(btrim(p_expected_context->>'compilerVersion'),'')='' then
    raise exception 'SOLVER_CANDIDATE_CONTEXT_INVALID: unsupported or non-canonical review context';
  end if;
  v_token:=p_expected_context->'solverContextToken';
  if jsonb_typeof(v_token)<>'object'
     or not (v_token ?& array[
       'schemaVersion','studioId','rulebookVersion','planningDatasetVersion','enforcementVersion',
       'constraintModelVersion','scheduleVersion','scheduleId','scheduleAssignmentsHash'
     ])
     or v_token->>'schemaVersion'<>'1.0'
     or v_token->>'studioId' is distinct from p_studio_id::text
     or coalesce(v_token->>'scheduleId','')=''
     or coalesce(v_token->>'scheduleAssignmentsHash','')='' then
    raise exception 'SOLVER_CANDIDATE_CONTEXT_INVALID: base ScheduleVersion/lock identity is incomplete';
  end if;

  -- Serialize against the same mutation families as the existing adoption RPC.
  -- Two editors holding the same reviewed candidate therefore cannot both commit.
  perform pg_advisory_xact_lock(hashtextextended(p_studio_id::text,0));
  perform pg_advisory_xact_lock(hashtextextended('planning-dataset:'||p_studio_id::text,0));
  perform pg_advisory_xact_lock(hashtextextended('constraint-model:'||p_studio_id::text,0));

  v_current_context:=private.build_solver_candidate_context_v44(p_studio_id);
  if v_current_context is distinct from p_expected_context then
    raise exception 'STALE_SOLVER_CANDIDATE_CONTEXT: reviewed ScheduleVersion/lock/policy/planning/model context is no longer current';
  end if;

  -- Use versions from the submitted reviewed context. Do not substitute freshly
  -- read values. V3.3 remains the canonical candidate/legacy-validation writer.
  return public.adopt_solver_candidate_v33(
    p_studio_id,
    p_actor_user_id,
    p_actor_label,
    p_reason,
    (v_token->>'scheduleVersion')::integer,
    (v_token->>'rulebookVersion')::integer,
    (v_token->>'enforcementVersion')::integer,
    (v_token->>'planningDatasetVersion')::integer,
    (v_token->>'constraintModelVersion')::integer,
    p_candidate,
    p_application_validation
  );
end
$function$;

revoke all on function public.adopt_solver_candidate_v44(uuid,uuid,text,text,jsonb,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.adopt_solver_candidate_v44(uuid,uuid,text,text,jsonb,jsonb,jsonb) to service_role;
