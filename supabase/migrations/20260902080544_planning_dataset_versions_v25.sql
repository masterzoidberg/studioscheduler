-- Milestone 2 / V2.5 planning-data versioning.
--
-- Goal: every new ScheduleVersion and Scenario is pinned to a content-addressed
-- snapshot of the mutable, solver-significant studio facts that existed when it
-- was created. Presentation-only fields are deliberately excluded.
--
-- Supabase recorded this migration as 20260902080544_planning_dataset_versions_v25.

create table if not exists public.planning_dataset_versions (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios(id) on delete cascade,
  version integer not null check (version > 0),
  created_at timestamptz not null default now(),
  actor_user_id uuid null references auth.users(id) on delete set null,
  actor_label text not null,
  reason text not null,
  snapshot jsonb not null,
  snapshot_hash text not null check (snapshot_hash ~ '^[0-9a-f]{64}$'),
  status text not null default 'HISTORICAL' check (status in ('CURRENT','HISTORICAL')),
  unique (studio_id, version)
);

create unique index if not exists idx_planning_dataset_versions_one_current
  on public.planning_dataset_versions(studio_id)
  where status='CURRENT';

create index if not exists idx_planning_dataset_versions_studio_created
  on public.planning_dataset_versions(studio_id, created_at desc);

alter table public.planning_dataset_versions enable row level security;

drop policy if exists member_select_planning_dataset_versions on public.planning_dataset_versions;
create policy member_select_planning_dataset_versions
  on public.planning_dataset_versions
  for select
  to authenticated
  using (private.is_studio_member(studio_id));

revoke all on table public.planning_dataset_versions from public, anon, authenticated;
grant select on table public.planning_dataset_versions to authenticated;
grant all on table public.planning_dataset_versions to service_role;

create or replace function private.sorted_text_array_jsonb_v25(p_values text[])
returns jsonb
language sql
immutable
set search_path=''
as $function$
  select coalesce(jsonb_agg(value order by value), '[]'::jsonb)
  from unnest(coalesce(p_values, '{}'::text[])) as value
$function$;

create or replace function private.build_planning_dataset_snapshot_v25(p_studio uuid)
returns jsonb
language sql
stable
set search_path=''
as $function$
  select jsonb_build_object(
    'schemaVersion', '1.0',
    'studioId', p_studio::text,
    'teacherIds', coalesce((
      select jsonb_agg(t.id order by t.id)
      from public.teachers t
      where t.studio_id=p_studio
    ), '[]'::jsonb),
    'rooms', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', r.id,
          'capacity', r.capacity,
          'features', private.sorted_text_array_jsonb_v25(r.features)
        ) order by r.id
      )
      from public.rooms r
      where r.studio_id=p_studio
    ), '[]'::jsonb),
    'students', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', s.id,
          'level', s.level,
          'cohortIds', private.sorted_text_array_jsonb_v25(s.cohort_ids)
        ) order by s.id
      )
      from public.students s
      where s.studio_id=p_studio
    ), '[]'::jsonb),
    'cohorts', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', c.id,
          'studentIds', private.sorted_text_array_jsonb_v25(c.student_ids)
        ) order by c.id
      )
      from public.cohorts c
      where c.studio_id=p_studio
    ), '[]'::jsonb),
    'classes', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', c.id,
          'subject', c.subject,
          'level', c.level,
          'durationMinutes', c.duration_minutes,
          'weeklyFrequency', c.weekly_frequency,
          'rosterStudentIds', private.sorted_text_array_jsonb_v25(c.roster_student_ids),
          'companyOnly', c.company_only
        ) order by c.id
      )
      from public.class_definitions c
      where c.studio_id=p_studio
    ), '[]'::jsonb),
    'sessions', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', s.id,
          'classId', s.class_id,
          'ordinal', s.ordinal,
          'locked', s.locked
        ) order by s.id
      )
      from public.class_sessions s
      where s.studio_id=p_studio
    ), '[]'::jsonb)
  )
$function$;

create or replace function private.planning_dataset_hash_v25(p_snapshot jsonb)
returns text
language sql
immutable
set search_path=''
as $function$
  select encode(extensions.digest(pg_catalog.convert_to(p_snapshot::text, 'UTF8'), 'sha256'), 'hex')
$function$;

create or replace function private.ensure_planning_dataset_version_v25(
  p_studio uuid,
  p_actor_user_id uuid,
  p_actor_label text,
  p_reason text
)
returns integer
language plpgsql
security definer
set search_path=''
as $function$
declare
  v_snapshot jsonb;
  v_hash text;
  v_current public.planning_dataset_versions%rowtype;
  v_version integer;
begin
  perform pg_advisory_xact_lock(hashtextextended('planning-dataset:' || p_studio::text, 0));

  v_snapshot := private.build_planning_dataset_snapshot_v25(p_studio);
  v_hash := private.planning_dataset_hash_v25(v_snapshot);

  select * into v_current
  from public.planning_dataset_versions
  where studio_id=p_studio and status='CURRENT'
  limit 1;

  if v_current.id is not null and v_current.snapshot_hash=v_hash then
    return v_current.version;
  end if;

  select coalesce(max(version),0)+1 into v_version
  from public.planning_dataset_versions
  where studio_id=p_studio;

  update public.planning_dataset_versions
  set status='HISTORICAL'
  where studio_id=p_studio and status='CURRENT';

  insert into public.planning_dataset_versions(
    studio_id, version, actor_user_id, actor_label, reason, snapshot, snapshot_hash, status
  ) values(
    p_studio,
    v_version,
    p_actor_user_id,
    coalesce(nullif(btrim(p_actor_label),''),'System'),
    coalesce(nullif(btrim(p_reason),''),'Scheduling-significant planning data changed'),
    v_snapshot,
    v_hash,
    'CURRENT'
  );

  if to_regclass('public.audit_events') is not null then
    insert into public.audit_events(
      studio_id, actor_user_id, actor_label, action, entity_type, entity_id, detail, payload
    ) values(
      p_studio,
      p_actor_user_id,
      coalesce(nullif(btrim(p_actor_label),''),'System'),
      'PLANNING_DATASET_VERSION',
      'PLANNING_DATASET',
      v_version::text,
      coalesce(nullif(btrim(p_reason),''),'Scheduling-significant planning data changed'),
      jsonb_build_object(
        'planningDatasetVersion', v_version,
        'snapshotHash', v_hash,
        'previousPlanningDatasetVersion', case when v_current.id is null then null else v_current.version end,
        'previousSnapshotHash', case when v_current.id is null then null else v_current.snapshot_hash end
      )
    );
  end if;

  return v_version;
end
$function$;

revoke all on function private.sorted_text_array_jsonb_v25(text[]) from public, anon, authenticated;
revoke all on function private.build_planning_dataset_snapshot_v25(uuid) from public, anon, authenticated;
revoke all on function private.planning_dataset_hash_v25(jsonb) from public, anon, authenticated;
revoke all on function private.ensure_planning_dataset_version_v25(uuid,uuid,text,text) from public, anon, authenticated;

do $block$
declare
  v_studio uuid;
begin
  for v_studio in select id from public.studios loop
    perform private.ensure_planning_dataset_version_v25(v_studio,null,'V2.5 migration','Initial PlanningDatasetVersion snapshot');
  end loop;
end
$block$;

alter table public.schedule_versions add column if not exists planning_dataset_version integer;
alter table public.scenarios add column if not exists base_planning_dataset_version integer;

update public.schedule_versions sv
set planning_dataset_version=pdv.version
from public.planning_dataset_versions pdv
where sv.studio_id=pdv.studio_id
  and sv.is_current
  and pdv.status='CURRENT'
  and sv.planning_dataset_version is null;

update public.scenarios s
set base_planning_dataset_version=pdv.version
from public.planning_dataset_versions pdv
where s.studio_id=pdv.studio_id
  and pdv.status='CURRENT'
  and s.base_planning_dataset_version is null;

alter table public.schedule_versions drop constraint if exists schedule_versions_planning_dataset_version_fkey;
alter table public.schedule_versions add constraint schedule_versions_planning_dataset_version_fkey
  foreign key (studio_id,planning_dataset_version)
  references public.planning_dataset_versions(studio_id,version);
alter table public.scenarios drop constraint if exists scenarios_base_planning_dataset_version_fkey;
alter table public.scenarios add constraint scenarios_base_planning_dataset_version_fkey
  foreign key (studio_id,base_planning_dataset_version)
  references public.planning_dataset_versions(studio_id,version);
create index if not exists idx_schedule_versions_planning_dataset_fk on public.schedule_versions(studio_id,planning_dataset_version);
create index if not exists idx_scenarios_planning_dataset_fk on public.scenarios(studio_id,base_planning_dataset_version);

create or replace function private.pin_schedule_planning_dataset_v25()
returns trigger
language plpgsql
security definer
set search_path=''
as $function$
declare
  v_version integer;
begin
  if new.planning_dataset_version is null then
    v_version := private.ensure_planning_dataset_version_v25(
      new.studio_id,
      new.actor_user_id,
      coalesce(new.actor_label,'Schedule writer'),
      'Planning dataset snapshot pinned to ScheduleVersion'
    );
    new.planning_dataset_version := v_version;
  end if;
  return new;
end
$function$;
revoke all on function private.pin_schedule_planning_dataset_v25() from public, anon, authenticated;
drop trigger if exists trg_schedule_versions_pin_planning_dataset_v25 on public.schedule_versions;
create trigger trg_schedule_versions_pin_planning_dataset_v25
before insert on public.schedule_versions
for each row execute function private.pin_schedule_planning_dataset_v25();

create or replace function private.pin_scenario_planning_dataset_v25()
returns trigger
language plpgsql
security definer
set search_path=''
as $function$
declare
  v_version integer;
begin
  if new.base_planning_dataset_version is null then
    v_version := private.ensure_planning_dataset_version_v25(
      new.studio_id,
      new.created_by,
      'Scenario writer',
      'Planning dataset snapshot pinned to Scenario'
    );
    new.base_planning_dataset_version := v_version;
  end if;
  return new;
end
$function$;
revoke all on function private.pin_scenario_planning_dataset_v25() from public, anon, authenticated;
drop trigger if exists trg_scenarios_pin_planning_dataset_v25 on public.scenarios;
create trigger trg_scenarios_pin_planning_dataset_v25
before insert on public.scenarios
for each row execute function private.pin_scenario_planning_dataset_v25();

create or replace function private.refresh_planning_dataset_after_change_v25()
returns trigger
language plpgsql
security definer
set search_path=''
as $function$
declare
  v_studio uuid;
  v_uid uuid:=auth.uid();
begin
  if tg_op='DELETE' then v_studio:=old.studio_id; else v_studio:=new.studio_id; end if;
  perform private.ensure_planning_dataset_version_v25(
    v_studio,
    v_uid,
    'Planning data change',
    format('%s scheduling-significant snapshot changed',tg_table_name)
  );
  if tg_op='DELETE' then return old; end if;
  return new;
end
$function$;
revoke all on function private.refresh_planning_dataset_after_change_v25() from public, anon, authenticated;

drop trigger if exists trg_teachers_planning_dataset_v25 on public.teachers;
create constraint trigger trg_teachers_planning_dataset_v25 after insert or update or delete on public.teachers deferrable initially deferred for each row execute function private.refresh_planning_dataset_after_change_v25();
drop trigger if exists trg_rooms_planning_dataset_v25 on public.rooms;
create constraint trigger trg_rooms_planning_dataset_v25 after insert or update or delete on public.rooms deferrable initially deferred for each row execute function private.refresh_planning_dataset_after_change_v25();
drop trigger if exists trg_students_planning_dataset_v25 on public.students;
create constraint trigger trg_students_planning_dataset_v25 after insert or update or delete on public.students deferrable initially deferred for each row execute function private.refresh_planning_dataset_after_change_v25();
drop trigger if exists trg_cohorts_planning_dataset_v25 on public.cohorts;
create constraint trigger trg_cohorts_planning_dataset_v25 after insert or update or delete on public.cohorts deferrable initially deferred for each row execute function private.refresh_planning_dataset_after_change_v25();
drop trigger if exists trg_classes_planning_dataset_v25 on public.class_definitions;
create constraint trigger trg_classes_planning_dataset_v25 after insert or update or delete on public.class_definitions deferrable initially deferred for each row execute function private.refresh_planning_dataset_after_change_v25();
drop trigger if exists trg_sessions_planning_dataset_v25 on public.class_sessions;
create constraint trigger trg_sessions_planning_dataset_v25 after insert or update or delete on public.class_sessions deferrable initially deferred for each row execute function private.refresh_planning_dataset_after_change_v25();

create or replace function public.get_current_planning_dataset_v25()
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $function$
declare
  ctx jsonb:=private.dwde_actor_context();
  v_studio uuid:=(ctx->>'studio_id')::uuid;
  v_row public.planning_dataset_versions%rowtype;
begin
  select * into v_row from public.planning_dataset_versions where studio_id=v_studio and status='CURRENT' limit 1;
  if v_row.id is null then return null; end if;
  return jsonb_build_object(
    'id',v_row.id,
    'version',v_row.version,
    'createdAt',v_row.created_at,
    'actor',v_row.actor_label,
    'reason',v_row.reason,
    'snapshot',v_row.snapshot,
    'snapshotHash',v_row.snapshot_hash,
    'status',v_row.status
  );
end
$function$;
revoke all on function public.get_current_planning_dataset_v25() from public, anon;
grant execute on function public.get_current_planning_dataset_v25() to authenticated, service_role;
