-- CAND-01: durable, tenant-scoped solver candidate review envelopes.
--
-- Candidate rows are review evidence only. ScheduleVersion remains the sole
-- canonical placement authority; creation/listing/deletion below never writes
-- schedule, assignment, version, or audit rows.

create table public.solver_candidate_reviews(
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios(id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 160),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_by_label text not null check (length(btrim(created_by_label)) between 1 and 240),
  candidate_context jsonb not null,
  assignments jsonb not null,
  quality jsonb not null,
  optimization_status text not null check (optimization_status in ('FEASIBILITY_ONLY','OPTIMAL','FEASIBLE_INCUMBENT','NO_FEASIBLE_SOLUTION','INFEASIBLE')),
  proven_optimal boolean not null default false,
  service_version text,
  created_at timestamptz not null default now()
);

create index solver_candidate_reviews_studio_created_idx
  on public.solver_candidate_reviews(studio_id, created_at desc);

alter table public.solver_candidate_reviews enable row level security;
revoke all on table public.solver_candidate_reviews from public, anon;
grant select on table public.solver_candidate_reviews to authenticated;
grant all on table public.solver_candidate_reviews to service_role;

create policy solver_candidate_reviews_member_read
  on public.solver_candidate_reviews
  for select to authenticated
  using (
    exists (
      select 1
      from public.studio_members m
      where m.studio_id=solver_candidate_reviews.studio_id
        and m.user_id=auth.uid()
    )
  );

create or replace function public.create_solver_candidate_review_v68(
  p_studio_id uuid,
  p_actor_user_id uuid,
  p_actor_label text,
  p_name text,
  p_candidate_context jsonb,
  p_assignments jsonb,
  p_quality jsonb,
  p_optimization_status text,
  p_proven_optimal boolean,
  p_service_version text default null
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $function$
declare
  v_current_context jsonb;
  v_id uuid;
  v_row public.solver_candidate_reviews%rowtype;
  v_candidate_count integer;
  v_distinct_candidate_count integer;
  v_expected_count integer;
  v_invalid_count integer;
begin
  perform private.require_actor_studio_context_v63(p_studio_id,p_actor_user_id,'EDITOR');

  if coalesce(btrim(p_actor_label),'')='' then raise exception 'CANDIDATE_REVIEW_ACTOR_LABEL_REQUIRED'; end if;
  if coalesce(btrim(p_name),'')='' then raise exception 'CANDIDATE_REVIEW_NAME_REQUIRED'; end if;
  if p_candidate_context is null or jsonb_typeof(p_candidate_context)<>'object' then
    raise exception 'CANDIDATE_REVIEW_CONTEXT_INVALID';
  end if;
  if p_assignments is null or jsonb_typeof(p_assignments)<>'array' then
    raise exception 'CANDIDATE_REVIEW_ASSIGNMENTS_INVALID';
  end if;
  if p_quality is null or jsonb_typeof(p_quality)<>'object' then
    raise exception 'CANDIDATE_REVIEW_QUALITY_INVALID';
  end if;
  if p_optimization_status not in ('FEASIBILITY_ONLY','OPTIMAL','FEASIBLE_INCUMBENT','NO_FEASIBLE_SOLUTION','INFEASIBLE') then
    raise exception 'CANDIDATE_REVIEW_OPTIMIZATION_STATUS_INVALID';
  end if;

  -- Creation is itself a context boundary. A result that became stale between
  -- the solver response and persistence is rejected rather than saved with a
  -- silently substituted token.
  perform pg_advisory_xact_lock(hashtextextended(p_studio_id::text,0));
  perform pg_advisory_xact_lock(hashtextextended('planning-dataset:'||p_studio_id::text,0));
  perform pg_advisory_xact_lock(hashtextextended('constraint-model:'||p_studio_id::text,0));
  v_current_context:=private.build_solver_candidate_context_v44(p_studio_id);
  if v_current_context is distinct from p_candidate_context then
    raise exception 'STALE_SOLVER_CANDIDATE_CONTEXT: the coherent solver context changed before candidate review was saved';
  end if;

  select count(*)::integer, count(distinct elem->>'sessionId')::integer
    into v_candidate_count, v_distinct_candidate_count
  from jsonb_array_elements(p_assignments) elem;
  select count(*)::integer into v_expected_count
  from public.class_sessions
  where studio_id=p_studio_id and archived_at is null;
  if v_candidate_count<>v_expected_count or v_distinct_candidate_count<>v_expected_count then
    raise exception 'CANDIDATE_REVIEW_SESSION_SET_MISMATCH: expected %, received % rows / % distinct sessions',
      v_expected_count,v_candidate_count,v_distinct_candidate_count;
  end if;

  select count(*)::integer into v_invalid_count
  from jsonb_array_elements(p_assignments) elem
  left join public.class_sessions s
    on s.studio_id=p_studio_id and s.id=elem->>'sessionId' and s.archived_at is null
  left join public.teachers t
    on t.studio_id=p_studio_id and t.id=elem->>'teacherId' and t.archived_at is null
  left join public.rooms r
    on r.studio_id=p_studio_id and r.id=elem->>'roomId' and r.archived_at is null
  where jsonb_typeof(elem)<>'object'
     or not (elem ?& array['id','sessionId','day','startTime','endTime','teacherId','roomId','locked','status'])
     or (elem - array['id','sessionId','day','startTime','endTime','teacherId','roomId','locked','status'])<>'{}'::jsonb
     or jsonb_typeof(elem->'id')<>'string'
     or jsonb_typeof(elem->'sessionId')<>'string'
     or jsonb_typeof(elem->'day')<>'string'
     or jsonb_typeof(elem->'startTime')<>'string'
     or jsonb_typeof(elem->'endTime')<>'string'
     or jsonb_typeof(elem->'teacherId')<>'string'
     or jsonb_typeof(elem->'roomId')<>'string'
     or jsonb_typeof(elem->'locked')<>'boolean'
     or jsonb_typeof(elem->'status')<>'string'
     or btrim(elem->>'id')=''
     or btrim(elem->>'sessionId')=''
     or btrim(elem->>'teacherId')=''
     or btrim(elem->>'roomId')=''
     or s.id is null
     or t.id is null
     or r.id is null
     or elem->>'day' not in ('Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday')
     or elem->>'startTime' !~ '^(?:[01][0-9]|2[0-3]):[0-5][0-9]$'
     or elem->>'endTime' !~ '^(?:[01][0-9]|2[0-3]):[0-5][0-9]$'
     or elem->>'status' not in ('NORMAL','WARNING','AI_PROPOSED')
     or case when elem->>'startTime' ~ '^(?:[01][0-9]|2[0-3]):[0-5][0-9]$'
             then mod(extract(minute from (elem->>'startTime')::time)::integer,15)<>0
             else true end
     or case when elem->>'endTime' ~ '^(?:[01][0-9]|2[0-3]):[0-5][0-9]$'
             then mod(extract(minute from (elem->>'endTime')::time)::integer,15)<>0
             else true end
     or case when elem->>'startTime' ~ '^(?:[01][0-9]|2[0-3]):[0-5][0-9]$'
                  and elem->>'endTime' ~ '^(?:[01][0-9]|2[0-3]):[0-5][0-9]$'
             then (elem->>'endTime')::time <= (elem->>'startTime')::time
             else true end;
  if v_invalid_count>0 then raise exception 'CANDIDATE_REVIEW_ASSIGNMENTS_INVALID: % row(s) failed tenant/entity/interval validation',v_invalid_count; end if;

  insert into public.solver_candidate_reviews(
    studio_id,name,created_by,created_by_label,candidate_context,assignments,quality,
    optimization_status,proven_optimal,service_version
  ) values (
    p_studio_id,btrim(p_name),p_actor_user_id,btrim(p_actor_label),p_candidate_context,p_assignments,p_quality,
    p_optimization_status,coalesce(p_proven_optimal,false),nullif(btrim(coalesce(p_service_version,'')),'')
  ) returning * into v_row;

  return jsonb_build_object(
    'id',v_row.id,
    'studioId',v_row.studio_id,
    'name',v_row.name,
    'createdAt',v_row.created_at,
    'createdByLabel',v_row.created_by_label,
    'candidateContext',v_row.candidate_context,
    'assignments',v_row.assignments,
    'quality',v_row.quality,
    'optimizationStatus',v_row.optimization_status,
    'provenOptimal',v_row.proven_optimal,
    'serviceVersion',v_row.service_version
  );
end
$function$;

create or replace function public.list_solver_candidate_reviews_v68(p_studio_id uuid)
returns setof jsonb
language plpgsql
volatile
security definer
set search_path=''
as $function$
begin
  perform private.require_studio_context_v63(p_studio_id,'MEMBER');
  return query
  select jsonb_build_object(
    'id',r.id,
    'studioId',r.studio_id,
    'name',r.name,
    'createdAt',r.created_at,
    'createdByLabel',r.created_by_label,
    'candidateContext',r.candidate_context,
    'assignments',r.assignments,
    'quality',r.quality,
    'optimizationStatus',r.optimization_status,
    'provenOptimal',r.proven_optimal,
    'serviceVersion',r.service_version
  )
  from public.solver_candidate_reviews r
  where r.studio_id=p_studio_id
  order by r.created_at desc, r.id desc;
end
$function$;

create or replace function public.delete_solver_candidate_review_v68(
  p_studio_id uuid,
  p_actor_user_id uuid,
  p_candidate_id uuid
)
returns boolean
language plpgsql
security definer
set search_path=''
as $function$
declare
  v_deleted integer;
begin
  perform private.require_actor_studio_context_v63(p_studio_id,p_actor_user_id,'EDITOR');
  delete from public.solver_candidate_reviews
  where id=p_candidate_id and studio_id=p_studio_id;
  get diagnostics v_deleted = row_count;
  if v_deleted=0 then raise exception 'SOLVER_CANDIDATE_NOT_FOUND'; end if;
  return true;
end
$function$;

revoke all on function public.create_solver_candidate_review_v68(uuid,uuid,text,text,jsonb,jsonb,jsonb,text,boolean,text) from public,anon,authenticated;
revoke all on function public.list_solver_candidate_reviews_v68(uuid) from public,anon;
revoke all on function public.delete_solver_candidate_review_v68(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.create_solver_candidate_review_v68(uuid,uuid,text,text,jsonb,jsonb,jsonb,text,boolean,text) to service_role;
grant execute on function public.list_solver_candidate_reviews_v68(uuid) to authenticated,service_role;
grant execute on function public.delete_solver_candidate_review_v68(uuid,uuid,uuid) to service_role;
