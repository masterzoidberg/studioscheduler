-- Milestone 2 / V2.5 canonical planning snapshot ordering.
-- Pin every text sort used in the content-addressed PlanningDataset snapshot to
-- PostgreSQL's locale-independent C collation so database fingerprints remain
-- reproducible across locale/ICU changes.

create or replace function private.sorted_text_array_jsonb_v25(p_values text[])
returns jsonb
language sql
immutable
set search_path=''
as $function$
  select coalesce(jsonb_agg(value order by value collate "C"), '[]'::jsonb)
  from unnest(coalesce(p_values, '{}'::text[])) as value
$function$;

create or replace function private.build_planning_dataset_snapshot_v25(p_studio uuid)
returns jsonb
language sql
stable
set search_path=''
as $function$
  select jsonb_build_object(
    'schemaVersion', '1.1',
    'studioId', p_studio::text,
    'teacherIds', coalesce((select jsonb_agg(t.id order by t.id collate "C") from public.teachers t where t.studio_id=p_studio), '[]'::jsonb),
    'rooms', coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'capacity',r.capacity,'features',private.sorted_text_array_jsonb_v25(r.features)) order by r.id collate "C") from public.rooms r where r.studio_id=p_studio), '[]'::jsonb),
    'students', coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'level',s.level,'cohortIds',private.sorted_text_array_jsonb_v25(s.cohort_ids)) order by s.id collate "C") from public.students s where s.studio_id=p_studio), '[]'::jsonb),
    'cohorts', coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'studentIds',private.sorted_text_array_jsonb_v25(c.student_ids)) order by c.id collate "C") from public.cohorts c where c.studio_id=p_studio), '[]'::jsonb),
    'classes', coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'subject',c.subject,'level',c.level,'durationMinutes',c.duration_minutes,'weeklyFrequency',c.weekly_frequency,'rosterStudentIds',private.sorted_text_array_jsonb_v25(c.roster_student_ids),'companyOnly',c.company_only) order by c.id collate "C") from public.class_definitions c where c.studio_id=p_studio), '[]'::jsonb),
    'sessions', coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'classId',s.class_id,'ordinal',s.ordinal,'durationMinutes',s.duration_minutes,'locked',s.locked) order by s.id collate "C") from public.class_sessions s where s.studio_id=p_studio), '[]'::jsonb)
  )
$function$;

revoke all on function private.sorted_text_array_jsonb_v25(text[]) from public, anon, authenticated;
revoke all on function private.build_planning_dataset_snapshot_v25(uuid) from public, anon, authenticated;

do $block$
declare v_studio uuid;
begin
  for v_studio in select id from public.studios loop
    perform private.ensure_planning_dataset_version_v25(v_studio,null,'V2.5 canonical ordering migration','Planning Dataset canonical text ordering pinned to C collation');
  end loop;
end
$block$;
