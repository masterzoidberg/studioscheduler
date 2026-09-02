-- Milestone 2 / V2.6 immutable source-manifest foundation.
-- A Planning Dataset can only prove class inventory and roster completeness when
-- it is pinned to an immutable manifest of the authoritative source material.

create table if not exists public.planning_source_manifest_versions (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios(id) on delete cascade,
  version integer not null check (version > 0),
  created_at timestamptz not null default now(),
  actor_user_id uuid null references auth.users(id) on delete set null,
  actor_label text not null,
  reason text not null,
  snapshot jsonb not null,
  snapshot_hash text not null check (snapshot_hash ~ '^[0-9a-f]{64}$'),
  complete boolean not null default false,
  status text not null default 'HISTORICAL' check (status in ('CURRENT','HISTORICAL')),
  unique (studio_id,version)
);

create unique index if not exists idx_planning_source_manifest_one_current on public.planning_source_manifest_versions(studio_id) where status='CURRENT';
create index if not exists idx_planning_source_manifest_studio_created on public.planning_source_manifest_versions(studio_id,created_at desc);

alter table public.planning_source_manifest_versions enable row level security;
drop policy if exists member_select_planning_source_manifest_versions on public.planning_source_manifest_versions;
create policy member_select_planning_source_manifest_versions on public.planning_source_manifest_versions for select to authenticated using (private.is_studio_member(studio_id));
revoke all on table public.planning_source_manifest_versions from public,anon,authenticated;
grant select on table public.planning_source_manifest_versions to authenticated;
grant all on table public.planning_source_manifest_versions to service_role;

create or replace function private.planning_source_manifest_hash_v26(p_snapshot jsonb)
returns text language sql immutable set search_path=''
as $function$
  select encode(extensions.digest(pg_catalog.convert_to(p_snapshot::text,'UTF8'),'sha256'),'hex')
$function$;
revoke all on function private.planning_source_manifest_hash_v26(jsonb) from public,anon,authenticated;

create or replace function private.validate_planning_source_manifest_v26(p_snapshot jsonb,p_complete boolean)
returns void language plpgsql immutable set search_path=''
as $function$
declare v_class jsonb; v_source jsonb; v_duplicate text;
begin
  if jsonb_typeof(p_snapshot) <> 'object' then raise exception 'Source manifest must be a JSON object'; end if;
  if p_snapshot->>'schemaVersion' <> '1.0' then raise exception 'Source manifest schemaVersion must be 1.0'; end if;
  if jsonb_typeof(p_snapshot->'sources') <> 'array' then raise exception 'Source manifest sources must be an array'; end if;
  if jsonb_typeof(p_snapshot->'classes') <> 'array' then raise exception 'Source manifest classes must be an array'; end if;

  for v_source in select value from jsonb_array_elements(p_snapshot->'sources') loop
    if jsonb_typeof(v_source) <> 'object' then raise exception 'Every source manifest source must be an object'; end if;
    if coalesce(btrim(v_source->>'sourceId'),'')='' then raise exception 'Every source manifest source requires sourceId'; end if;
    if coalesce(btrim(v_source->>'kind'),'')='' then raise exception 'Every source manifest source requires kind'; end if;
    if coalesce(btrim(v_source->>'label'),'')='' then raise exception 'Every source manifest source requires label'; end if;
    if v_source ? 'sha256' and v_source->>'sha256' !~ '^[0-9a-f]{64}$' then raise exception 'Source sha256 must be lowercase hex'; end if;
  end loop;

  select source_id into v_duplicate from (
    select value->>'sourceId' source_id,count(*) c from jsonb_array_elements(p_snapshot->'sources') group by value->>'sourceId' having count(*)>1
  ) d limit 1;
  if v_duplicate is not null then raise exception 'Duplicate sourceId in source manifest: %',v_duplicate; end if;

  for v_class in select value from jsonb_array_elements(p_snapshot->'classes') loop
    if jsonb_typeof(v_class) <> 'object' then raise exception 'Every source manifest class must be an object'; end if;
    if coalesce(btrim(v_class->>'id'),'')='' then raise exception 'Every source manifest class requires id'; end if;
    if coalesce(btrim(v_class->>'name'),'')='' then raise exception 'Every source manifest class requires name'; end if;
    if coalesce((v_class->>'weeklyFrequency')::integer,0)<=0 then raise exception 'Every source manifest class requires positive weeklyFrequency'; end if;
    if jsonb_typeof(v_class->'sessionDurations') <> 'array' then raise exception 'Every source manifest class requires sessionDurations array'; end if;
    if jsonb_array_length(v_class->'sessionDurations') <> (v_class->>'weeklyFrequency')::integer then raise exception 'Source manifest class % sessionDurations must match weeklyFrequency',v_class->>'id'; end if;
    if exists(select 1 from jsonb_array_elements(v_class->'sessionDurations') x where jsonb_typeof(x) <> 'number' or (x#>>'{}')::integer<=0) then raise exception 'Source manifest class % has invalid session duration',v_class->>'id'; end if;
    if jsonb_typeof(v_class->'rosterStudentIds') <> 'array' then raise exception 'Every source manifest class requires rosterStudentIds array'; end if;
  end loop;

  select class_id into v_duplicate from (
    select value->>'id' class_id,count(*) c from jsonb_array_elements(p_snapshot->'classes') group by value->>'id' having count(*)>1
  ) d limit 1;
  if v_duplicate is not null then raise exception 'Duplicate class id in source manifest: %',v_duplicate; end if;
  if p_complete and jsonb_array_length(p_snapshot->'sources')=0 then raise exception 'A complete source manifest must contain at least one authoritative source'; end if;
  if p_complete and jsonb_array_length(p_snapshot->'classes')=0 then raise exception 'A complete source manifest must contain at least one class'; end if;
end
$function$;
revoke all on function private.validate_planning_source_manifest_v26(jsonb,boolean) from public,anon,authenticated;

create or replace function private.build_planning_dataset_snapshot_v25(p_studio uuid)
returns jsonb language sql stable set search_path=''
as $function$
  select jsonb_build_object(
    'schemaVersion','1.2',
    'studioId',p_studio::text,
    'sourceManifest',(select jsonb_build_object('version',m.version,'snapshotHash',m.snapshot_hash,'complete',m.complete,'snapshot',m.snapshot) from public.planning_source_manifest_versions m where m.studio_id=p_studio and m.status='CURRENT' limit 1),
    'teacherIds',coalesce((select jsonb_agg(t.id order by t.id collate "C") from public.teachers t where t.studio_id=p_studio),'[]'::jsonb),
    'rooms',coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'capacity',r.capacity,'features',private.sorted_text_array_jsonb_v25(r.features)) order by r.id collate "C") from public.rooms r where r.studio_id=p_studio),'[]'::jsonb),
    'students',coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'level',s.level,'cohortIds',private.sorted_text_array_jsonb_v25(s.cohort_ids)) order by s.id collate "C") from public.students s where s.studio_id=p_studio),'[]'::jsonb),
    'cohorts',coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'studentIds',private.sorted_text_array_jsonb_v25(c.student_ids)) order by c.id collate "C") from public.cohorts c where c.studio_id=p_studio),'[]'::jsonb),
    'classes',coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'subject',c.subject,'level',c.level,'durationMinutes',c.duration_minutes,'weeklyFrequency',c.weekly_frequency,'rosterStudentIds',private.sorted_text_array_jsonb_v25(c.roster_student_ids),'companyOnly',c.company_only) order by c.id collate "C") from public.class_definitions c where c.studio_id=p_studio),'[]'::jsonb),
    'sessions',coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'classId',s.class_id,'ordinal',s.ordinal,'durationMinutes',s.duration_minutes,'locked',s.locked) order by s.id collate "C") from public.class_sessions s where s.studio_id=p_studio),'[]'::jsonb)
  )
$function$;
revoke all on function private.build_planning_dataset_snapshot_v25(uuid) from public,anon,authenticated;

create or replace function public.install_planning_source_manifest_v26(p_snapshot jsonb,p_complete boolean,p_reason text,p_expected_planning_dataset_version integer)
returns jsonb language plpgsql security definer set search_path=''
as $function$
declare
  ctx jsonb:=private.assert_editor_context(); v_uid uuid:=(ctx->>'user_id')::uuid; v_studio uuid:=(ctx->>'studio_id')::uuid; v_actor text:=ctx->>'actor';
  v_current public.planning_source_manifest_versions%rowtype; v_hash text; v_version integer; v_planning integer; v_new_planning integer;
begin
  if coalesce(btrim(p_reason),'')='' then raise exception 'Reason is required'; end if;
  perform pg_advisory_xact_lock(hashtextextended('planning-dataset:'||v_studio::text,0));
  select version into v_planning from public.planning_dataset_versions where studio_id=v_studio and status='CURRENT';
  if v_planning<>p_expected_planning_dataset_version then raise exception 'STALE_PLANNING_DATASET: expected %, current %',p_expected_planning_dataset_version,v_planning; end if;
  perform private.validate_planning_source_manifest_v26(p_snapshot,p_complete);
  v_hash:=private.planning_source_manifest_hash_v26(p_snapshot);
  select * into v_current from public.planning_source_manifest_versions where studio_id=v_studio and status='CURRENT' limit 1;
  if v_current.id is not null and v_current.snapshot_hash=v_hash and v_current.complete=p_complete then
    return jsonb_build_object('manifestVersion',v_current.version,'snapshotHash',v_hash,'complete',v_current.complete,'planningDatasetVersion',v_planning,'alreadyCurrent',true);
  end if;
  select coalesce(max(version),0)+1 into v_version from public.planning_source_manifest_versions where studio_id=v_studio;
  update public.planning_source_manifest_versions set status='HISTORICAL' where studio_id=v_studio and status='CURRENT';
  insert into public.planning_source_manifest_versions(studio_id,version,actor_user_id,actor_label,reason,snapshot,snapshot_hash,complete,status)
  values(v_studio,v_version,v_uid,v_actor,p_reason,p_snapshot,v_hash,p_complete,'CURRENT');
  v_new_planning:=private.ensure_planning_dataset_version_v25(v_studio,v_uid,v_actor,'Planning source manifest changed: '||p_reason);
  insert into public.audit_events(studio_id,actor_user_id,actor_label,action,entity_type,entity_id,detail,payload)
  values(v_studio,v_uid,v_actor,'PLANNING_SOURCE_MANIFEST','PLANNING_SOURCE_MANIFEST',v_version::text,p_reason,jsonb_build_object('manifestVersion',v_version,'snapshotHash',v_hash,'complete',p_complete,'planningDatasetVersion',v_new_planning));
  return jsonb_build_object('manifestVersion',v_version,'snapshotHash',v_hash,'complete',p_complete,'planningDatasetVersion',v_new_planning,'alreadyCurrent',false);
end
$function$;
revoke all on function public.install_planning_source_manifest_v26(jsonb,boolean,text,integer) from public,anon;
grant execute on function public.install_planning_source_manifest_v26(jsonb,boolean,text,integer) to authenticated,service_role;

create or replace function public.get_current_planning_source_manifest_v26()
returns jsonb language plpgsql stable security definer set search_path=''
as $function$
declare ctx jsonb:=private.dwde_actor_context(); v_studio uuid:=(ctx->>'studio_id')::uuid; v_row public.planning_source_manifest_versions%rowtype;
begin
  select * into v_row from public.planning_source_manifest_versions where studio_id=v_studio and status='CURRENT' limit 1;
  if v_row.id is null then return null; end if;
  return jsonb_build_object('id',v_row.id,'version',v_row.version,'createdAt',v_row.created_at,'actor',v_row.actor_label,'reason',v_row.reason,'snapshot',v_row.snapshot,'snapshotHash',v_row.snapshot_hash,'complete',v_row.complete,'status',v_row.status);
end
$function$;
revoke all on function public.get_current_planning_source_manifest_v26() from public,anon;
grant execute on function public.get_current_planning_source_manifest_v26() to authenticated,service_role;

do $block$
declare v_studio uuid;
begin
  for v_studio in select id from public.studios loop
    perform private.ensure_planning_dataset_version_v25(v_studio,null,'V2.6 source manifest migration','Planning Dataset schema 1.2 adds immutable source-manifest identity');
  end loop;
end
$block$;
