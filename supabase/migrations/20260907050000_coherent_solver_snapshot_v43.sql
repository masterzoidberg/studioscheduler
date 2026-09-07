-- T07 / V4.3 coherent solver snapshot boundary.
--
-- Solver preparation must never combine mutable rows read at different moments.
-- The public RPCs below expose one member-authorized, statement-stable snapshot
-- containing immutable PlanningDatasetVersion facts, current policy/model pointers,
-- and only the current ScheduleVersion assignments. Historical rows remain stored
-- and queryable through their normal version/history surfaces, but are not sent to
-- a new feasibility solve.

create or replace function private.build_solver_context_token_v43(p_studio_id uuid)
returns jsonb
language sql
stable
security definer
set search_path=''
as $function$
  with current_rulebook as (
    select rb.* from public.rulebook_versions rb
    where rb.studio_id=p_studio_id and rb.status='CURRENT'
    order by rb.version desc limit 1
  ),
  current_planning as (
    select pd.* from public.planning_dataset_versions pd
    where pd.studio_id=p_studio_id and pd.status='CURRENT'
    order by pd.version desc limit 1
  ),
  current_enforcement as (
    select ev.* from public.rule_enforcement_versions ev
    where ev.studio_id=p_studio_id and ev.status='CURRENT'
    order by ev.version desc limit 1
  ),
  current_model as (
    select cm.* from public.constraint_model_versions cm
    where cm.studio_id=p_studio_id and cm.status='CURRENT'
    order by cm.version desc limit 1
  ),
  current_schedule as (
    select sv.* from public.schedule_versions sv
    where sv.studio_id=p_studio_id and sv.is_current
    order by sv.version desc limit 1
  ),
  rules_state as (
    select coalesce(jsonb_agg(to_jsonb(r) order by r.id), '[]'::jsonb) as snapshot
    from public.rules r where r.studio_id=p_studio_id
  ),
  assignment_state as (
    select coalesce(jsonb_agg(
      jsonb_build_object(
        'id',a.id,'sessionId',a.session_id,'day',a.day,
        'startTime',a.start_time,'endTime',a.end_time,
        'teacherId',a.teacher_id,'roomId',a.room_id,
        'locked',a.locked,'status',a.status
      ) order by a.id
    ), '[]'::jsonb) as snapshot
    from public.assignments a
    where a.studio_id=p_studio_id
      and a.schedule_version_id=(select id from current_schedule)
  )
  select jsonb_build_object(
    'schemaVersion','1.0',
    'studioId',p_studio_id::text,
    'rulebookVersion',(select version from current_rulebook),
    'rulebookId',(select id::text from current_rulebook),
    'rulebookSourceHash',(select source_hash from current_rulebook),
    'rulebookSnapshotHash',(select private.planning_dataset_hash_v25(snapshot) from current_rulebook),
    'rulesHash',private.planning_dataset_hash_v25((select snapshot from rules_state)),
    'planningDatasetVersion',(select version from current_planning),
    'planningDatasetId',(select id::text from current_planning),
    'planningSnapshotHash',(select snapshot_hash from current_planning),
    'planningConfirmedForSchedulingAt',(select confirmed_for_scheduling_at from current_planning),
    'enforcementVersion',(select version from current_enforcement),
    'enforcementId',(select id::text from current_enforcement),
    'constraintModelVersion',(select version from current_model),
    'constraintModelId',(select id::text from current_model),
    'constraintModelSnapshotHash',(select snapshot_hash from current_model),
    'scheduleVersion',(select version from current_schedule),
    'scheduleId',(select id::text from current_schedule),
    'scheduleRulebookVersion',(select rulebook_version from current_schedule),
    'scheduleEnforcementVersion',(select enforcement_version from current_schedule),
    'schedulePlanningDatasetVersion',(select planning_dataset_version from current_schedule),
    'scheduleConstraintModelVersion',(select constraint_model_version from current_schedule),
    'scheduleAssignmentsHash',private.planning_dataset_hash_v25((select snapshot from assignment_state))
  )
$function$;

revoke all on function private.build_solver_context_token_v43(uuid) from public,anon,authenticated;

create or replace function public.get_solver_context_token_v43(p_studio_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $function$
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not private.is_studio_member(p_studio_id) then raise exception 'Studio membership required'; end if;
  return private.build_solver_context_token_v43(p_studio_id);
end
$function$;

create or replace function public.get_solver_snapshot_v43(p_studio_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $function$
declare
  v_result jsonb;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not private.is_studio_member(p_studio_id) then raise exception 'Studio membership required'; end if;

  select jsonb_build_object(
    'contextToken',private.build_solver_context_token_v43(p_studio_id),
    'integrity',jsonb_build_object(
      'planningSnapshotHashValid',coalesce((
        select private.planning_dataset_hash_v25(pd.snapshot)=pd.snapshot_hash
        from public.planning_dataset_versions pd
        where pd.studio_id=p_studio_id and pd.status='CURRENT'
        order by pd.version desc limit 1
      ),false),
      'constraintModelSnapshotHashValid',coalesce((
        select private.constraint_model_hash_v27(cm.snapshot)=cm.snapshot_hash
        from public.constraint_model_versions cm
        where cm.studio_id=p_studio_id and cm.status='CURRENT'
        order by cm.version desc limit 1
      ),true)
    ),
    'studio',(select jsonb_build_object('id',s.id,'name',s.name) from public.studios s where s.id=p_studio_id),
    'rules',coalesce((select jsonb_agg(to_jsonb(r) order by r.id) from public.rules r where r.studio_id=p_studio_id),'[]'::jsonb),
    'rulebookVersion',(select to_jsonb(rb) from public.rulebook_versions rb where rb.studio_id=p_studio_id and rb.status='CURRENT' order by rb.version desc limit 1),
    'enforcementVersion',(select to_jsonb(ev) from public.rule_enforcement_versions ev where ev.studio_id=p_studio_id and ev.status='CURRENT' order by ev.version desc limit 1),
    'planningDatasetVersion',(select to_jsonb(pd) from public.planning_dataset_versions pd where pd.studio_id=p_studio_id and pd.status='CURRENT' order by pd.version desc limit 1),
    'constraintModelVersion',(select to_jsonb(cm) from public.constraint_model_versions cm where cm.studio_id=p_studio_id and cm.status='CURRENT' order by cm.version desc limit 1),
    'currentSchedule',(select to_jsonb(sv) from public.schedule_versions sv where sv.studio_id=p_studio_id and sv.is_current order by sv.version desc limit 1),
    'currentAssignments',coalesce((
      select jsonb_agg(to_jsonb(a) order by a.id)
      from public.assignments a
      where a.studio_id=p_studio_id
        and a.schedule_version_id=(select sv.id from public.schedule_versions sv where sv.studio_id=p_studio_id and sv.is_current order by sv.version desc limit 1)
    ),'[]'::jsonb)
  ) into v_result;

  return v_result;
end
$function$;

revoke all on function public.get_solver_context_token_v43(uuid) from public,anon;
revoke all on function public.get_solver_snapshot_v43(uuid) from public,anon;
grant execute on function public.get_solver_context_token_v43(uuid) to authenticated,service_role;
grant execute on function public.get_solver_snapshot_v43(uuid) to authenticated,service_role;
