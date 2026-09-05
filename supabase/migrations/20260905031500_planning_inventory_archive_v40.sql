-- V4.0 planning inventory lifecycle.
--
-- Studio master data is a living planning inventory. Editors may archive records
-- that no longer participate in current planning without deleting the historical
-- identities referenced by prior ScheduleVersions and audit history. Archived
-- entities are excluded from the canonical Planning Dataset snapshot and solver
-- state, and may later be restored.

alter table public.teachers add column if not exists archived_at timestamptz;
alter table public.students add column if not exists archived_at timestamptz;
alter table public.rooms add column if not exists archived_at timestamptz;
alter table public.class_definitions add column if not exists archived_at timestamptz;
alter table public.class_sessions add column if not exists archived_at timestamptz;

create index if not exists idx_teachers_active_v40 on public.teachers(studio_id,id) where archived_at is null;
create index if not exists idx_students_active_v40 on public.students(studio_id,id) where archived_at is null;
create index if not exists idx_rooms_active_v40 on public.rooms(studio_id,id) where archived_at is null;
create index if not exists idx_classes_active_v40 on public.class_definitions(studio_id,id) where archived_at is null;
create index if not exists idx_sessions_active_v40 on public.class_sessions(studio_id,class_id,id) where archived_at is null;

-- Keep the existing schema 1.3 JSON shape. Selection semantics now mean ACTIVE
-- planning entities only. Because all existing rows begin active, installing this
-- migration does not by itself change the current snapshot hash.
create or replace function private.build_planning_dataset_snapshot_v25(p_studio uuid)
returns jsonb
language sql
stable
set search_path=''
as $function$
  select jsonb_build_object(
    'schemaVersion','1.3',
    'studioId',p_studio::text,
    'sourceManifest',(select jsonb_build_object('version',m.version,'snapshotHash',m.snapshot_hash,'complete',m.complete,'snapshot',m.snapshot) from public.planning_source_manifest_versions m where m.studio_id=p_studio and m.status='CURRENT' limit 1),
    'teacherIds',coalesce((select jsonb_agg(t.id order by t.id collate "C") from public.teachers t where t.studio_id=p_studio and t.archived_at is null),'[]'::jsonb),
    'teachers',coalesce((select jsonb_agg(jsonb_build_object('id',t.id,'name',t.name) order by t.id collate "C") from public.teachers t where t.studio_id=p_studio and t.archived_at is null),'[]'::jsonb),
    'rooms',coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'name',r.name,'capacity',r.capacity,'features',private.sorted_text_array_jsonb_v25(r.features)) order by r.id collate "C") from public.rooms r where r.studio_id=p_studio and r.archived_at is null),'[]'::jsonb),
    'students',coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'name',s.name,'level',s.level,'cohortIds',private.sorted_text_array_jsonb_v25(s.cohort_ids)) order by s.id collate "C") from public.students s where s.studio_id=p_studio and s.archived_at is null),'[]'::jsonb),
    'cohorts',coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'name',c.name,'studentIds',private.sorted_text_array_jsonb_v25(c.student_ids)) order by c.id collate "C") from public.cohorts c where c.studio_id=p_studio),'[]'::jsonb),
    'classes',coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'name',c.name,'subject',c.subject,'level',c.level,'durationMinutes',c.duration_minutes,'weeklyFrequency',c.weekly_frequency,'rosterStudentIds',private.sorted_text_array_jsonb_v25(c.roster_student_ids),'companyOnly',c.company_only) order by c.id collate "C") from public.class_definitions c where c.studio_id=p_studio and c.archived_at is null),'[]'::jsonb),
    'sessions',coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'classId',s.class_id,'ordinal',s.ordinal,'durationMinutes',s.duration_minutes,'locked',s.locked) order by s.id collate "C") from public.class_sessions s join public.class_definitions c on c.studio_id=s.studio_id and c.id=s.class_id where s.studio_id=p_studio and s.archived_at is null and c.archived_at is null),'[]'::jsonb)
  )
$function$;
revoke all on function private.build_planning_dataset_snapshot_v25(uuid) from public,anon,authenticated;

-- Active class rosters cannot retain archived students. This also protects custom
-- clients that bypass the normal editor UI.
create or replace function private.reject_archived_student_roster_v40()
returns trigger
language plpgsql
security definer
set search_path=''
as $function$
declare
  v_archived text[];
begin
  if new.archived_at is not null then return new; end if;
  select array_agg(s.id order by s.id) into v_archived
  from public.students s
  where s.studio_id=new.studio_id
    and s.archived_at is not null
    and s.id=any(coalesce(new.roster_student_ids,'{}'::text[]));
  if coalesce(array_length(v_archived,1),0)>0 then
    raise exception 'CLASS_ROSTER_ARCHIVED_STUDENT: active classes cannot include archived students: %',array_to_string(v_archived,', ');
  end if;
  return new;
end
$function$;
revoke all on function private.reject_archived_student_roster_v40() from public,anon,authenticated;
drop trigger if exists trg_classes_reject_archived_roster_v40 on public.class_definitions;
create trigger trg_classes_reject_archived_roster_v40
before insert or update of roster_student_ids,archived_at on public.class_definitions
for each row execute function private.reject_archived_student_roster_v40();

create or replace function public.set_planning_entity_archive_v40(
  p_entity_type text,
  p_entity_id text,
  p_archive boolean,
  p_reason text,
  p_expected_planning_dataset_version integer
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
  v_current_planning integer;
  v_before jsonb;
  v_after jsonb;
  v_entity_version integer;
  v_planning_version integer;
  v_now timestamptz:=now();
  v_target_archived_at timestamptz;
  v_in_rosters text[];
  v_locked_sessions text[];
begin
  if p_entity_type not in ('TEACHER','STUDENT','ROOM','CLASS') then raise exception 'Unsupported planning entity type'; end if;
  if coalesce(btrim(p_entity_id),'')='' then raise exception 'Entity ID is required'; end if;
  if coalesce(btrim(p_reason),'')='' then raise exception 'Reason is required'; end if;

  perform pg_advisory_xact_lock(hashtextextended('planning-entity:'||v_studio::text,0));
  select version into v_current_planning from public.planning_dataset_versions where studio_id=v_studio and status='CURRENT' limit 1;
  if v_current_planning is null then raise exception 'No current PlanningDatasetVersion exists'; end if;
  if v_current_planning<>p_expected_planning_dataset_version then raise exception 'STALE_PLANNING_DATASET: expected %, current %',p_expected_planning_dataset_version,v_current_planning; end if;

  if p_entity_type='TEACHER' then
    select to_jsonb(t),t.archived_at into v_before,v_target_archived_at from public.teachers t where t.studio_id=v_studio and t.id=p_entity_id for update;
  elsif p_entity_type='STUDENT' then
    select to_jsonb(s),s.archived_at into v_before,v_target_archived_at from public.students s where s.studio_id=v_studio and s.id=p_entity_id for update;
  elsif p_entity_type='ROOM' then
    select to_jsonb(r),r.archived_at into v_before,v_target_archived_at from public.rooms r where r.studio_id=v_studio and r.id=p_entity_id for update;
  else
    select to_jsonb(c),c.archived_at into v_before,v_target_archived_at from public.class_definitions c where c.studio_id=v_studio and c.id=p_entity_id for update;
  end if;
  if v_before is null then raise exception '% not found',initcap(lower(p_entity_type)); end if;

  if p_archive and v_target_archived_at is not null then
    return jsonb_build_object('entityType',p_entity_type,'entityId',p_entity_id,'archived',true,'planningDatasetVersion',v_current_planning,'changed',false);
  end if;
  if not p_archive and v_target_archived_at is null then
    return jsonb_build_object('entityType',p_entity_type,'entityId',p_entity_id,'archived',false,'planningDatasetVersion',v_current_planning,'changed',false);
  end if;

  if p_archive and p_entity_type='STUDENT' then
    select array_agg(c.id order by c.id) into v_in_rosters
    from public.class_definitions c
    where c.studio_id=v_studio and c.archived_at is null and p_entity_id=any(coalesce(c.roster_student_ids,'{}'::text[]));
    if coalesce(array_length(v_in_rosters,1),0)>0 then
      raise exception 'STUDENT_ARCHIVE_BLOCKED_ACTIVE_ROSTER: remove the student from active class rosters first: %',array_to_string(v_in_rosters,', ');
    end if;
  end if;

  if p_archive and p_entity_type in ('TEACHER','ROOM') then
    select array_agg(distinct cs.id order by cs.id) into v_locked_sessions
    from public.schedule_versions sv
    join public.assignments a on a.schedule_version_id=sv.id
    join public.class_sessions cs on cs.id=a.session_id and cs.studio_id=v_studio and cs.archived_at is null
    join public.class_definitions c on c.id=cs.class_id and c.studio_id=v_studio and c.archived_at is null
    where sv.studio_id=v_studio and sv.is_current and a.locked
      and ((p_entity_type='TEACHER' and a.teacher_id=p_entity_id) or (p_entity_type='ROOM' and a.room_id=p_entity_id));
    if coalesce(array_length(v_locked_sessions,1),0)>0 then
      raise exception '%_ARCHIVE_BLOCKED_LOCKED_SESSION: resolve locked sessions first: %',p_entity_type,array_to_string(v_locked_sessions,', ');
    end if;
  end if;

  if p_entity_type='TEACHER' then
    update public.teachers set archived_at=case when p_archive then v_now else null end,updated_at=now() where studio_id=v_studio and id=p_entity_id;
    select to_jsonb(t) into v_after from public.teachers t where t.studio_id=v_studio and t.id=p_entity_id;
  elsif p_entity_type='STUDENT' then
    update public.students set archived_at=case when p_archive then v_now else null end,updated_at=now() where studio_id=v_studio and id=p_entity_id;
    select to_jsonb(s) into v_after from public.students s where s.studio_id=v_studio and s.id=p_entity_id;
  elsif p_entity_type='ROOM' then
    update public.rooms set archived_at=case when p_archive then v_now else null end,updated_at=now() where studio_id=v_studio and id=p_entity_id;
    select to_jsonb(r) into v_after from public.rooms r where r.studio_id=v_studio and r.id=p_entity_id;
  else
    update public.class_definitions set archived_at=case when p_archive then v_now else null end,updated_at=now() where studio_id=v_studio and id=p_entity_id;
    update public.class_sessions set archived_at=case when p_archive then v_now else null end,updated_at=now() where studio_id=v_studio and class_id=p_entity_id;
    select to_jsonb(c) into v_after from public.class_definitions c where c.studio_id=v_studio and c.id=p_entity_id;
  end if;

  select coalesce(max(version),0)+1 into v_entity_version from public.entity_versions where studio_id=v_studio and entity_type=p_entity_type and entity_id=p_entity_id;
  insert into public.entity_versions(studio_id,entity_type,entity_id,version,actor_user_id,actor_label,reason,before_entity,after_entity)
  values(v_studio,p_entity_type,p_entity_id,v_entity_version,v_uid,v_actor,p_reason,v_before,v_after);

  v_planning_version:=private.ensure_planning_dataset_version_v25(v_studio,v_uid,v_actor,p_reason);

  insert into public.audit_events(studio_id,actor_user_id,actor_label,action,entity_type,entity_id,detail,payload)
  values(v_studio,v_uid,v_actor,case when p_archive then 'PLANNING_ENTITY_ARCHIVED' else 'PLANNING_ENTITY_RESTORED' end,p_entity_type,p_entity_id,p_reason,
    jsonb_build_object('entityType',p_entity_type,'entityId',p_entity_id,'archived',p_archive,'entityVersion',v_entity_version,'planningDatasetVersion',v_planning_version));

  return jsonb_build_object('entityType',p_entity_type,'entityId',p_entity_id,'archived',p_archive,'planningDatasetVersion',v_planning_version,'scheduleRequiresRevalidation',v_planning_version<>v_current_planning,'changed',true);
end
$function$;

revoke all on function public.set_planning_entity_archive_v40(text,text,boolean,text,integer) from public,anon;
grant execute on function public.set_planning_entity_archive_v40(text,text,boolean,text,integer) to authenticated,service_role;

-- The shared Rulebook roster compiler must only resolve ACTIVE students.
create or replace function private.rulebook_required_roster_student_ids_v38(
  p_studio uuid,
  p_class_name text
)
returns text[]
language plpgsql
security definer
set search_path=''
as $function$
declare
  v_name text:=lower(regexp_replace(btrim(coalesce(p_class_name,'')),'[^a-zA-Z0-9]+','','g'));
  v_ids text[]:='{}'::text[];
  v_matches text[];
  v_karly text[];
begin
  if v_name in ('ballet4a','ballet4a4b') then
    select coalesce(array_agg(id order by id),'{}'::text[]) into v_matches from public.students where studio_id=p_studio and archived_at is null and lower(regexp_replace(level,'[^a-zA-Z0-9]+','','g'))='level4a';
    v_ids:=v_ids||v_matches;
  end if;
  if v_name in ('ballet4a4b','ballet4b5') then
    select coalesce(array_agg(id order by id),'{}'::text[]) into v_matches from public.students where studio_id=p_studio and archived_at is null and lower(regexp_replace(level,'[^a-zA-Z0-9]+','','g'))='level4b';
    v_ids:=v_ids||v_matches;
  end if;
  if v_name in ('ballet4b5','ballet5') then
    select coalesce(array_agg(id order by id),'{}'::text[]) into v_matches from public.students where studio_id=p_studio and archived_at is null and lower(regexp_replace(level,'[^a-zA-Z0-9]+','','g'))='level5';
    v_ids:=v_ids||v_matches;
  end if;
  if v_name in ('ballet2','jazz2','lyrical2','tap2','hiphop2','precompanytechnique1') then
    select coalesce(array_agg(id order by id),'{}'::text[]) into v_karly
    from public.students
    where studio_id=p_studio and archived_at is null and lower(regexp_replace(name,'[^a-zA-Z0-9]+','','g')) in ('karlysdaughter','karlydaughter');
    if coalesce(array_length(v_karly,1),0)=1 then v_ids:=v_ids||v_karly; end if;
  end if;
  return coalesce((select array_agg(distinct x order by x) from unnest(v_ids) x),'{}'::text[]);
end
$function$;
revoke all on function private.rulebook_required_roster_student_ids_v38(uuid,text) from public,anon,authenticated;
grant execute on function private.rulebook_required_roster_student_ids_v38(uuid,text) to postgres;
