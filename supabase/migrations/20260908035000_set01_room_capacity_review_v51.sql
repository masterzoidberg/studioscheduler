-- SET-01 / V5.1 targeted setup review foundation.
--
-- Review attestations are append-only supplemental evidence. They never duplicate
-- or replace canonical planning facts. Room capacity is the first supported slice.

create table if not exists public.setup_review_attestations (
  id uuid primary key default extensions.gen_random_uuid(),
  studio_id uuid not null references public.studios(id) on delete cascade,
  scope_kind text not null check (scope_kind in ('STUDIO','ROOM','TEACHER','CLASS','STUDENT','RULE')),
  entity_id text,
  aspect text not null,
  review_schema_version integer not null check (review_schema_version > 0),
  dependency_fingerprint text not null check (dependency_fingerprint ~ '^[0-9a-f]{64}$'),
  outcome text not null check (outcome in ('REVIEWED_VALUE','REVIEWED_NO_ADDITIONAL_RESTRICTION','NEEDS_REVIEW')),
  reviewer_user_id uuid not null references auth.users(id),
  reviewer_label text not null,
  source_planning_dataset_version integer,
  note text,
  created_at timestamptz not null default now(),
  check (
    (scope_kind='STUDIO' and entity_id is null)
    or (scope_kind<>'STUDIO' and coalesce(btrim(entity_id),'')<>'')
  ),
  check (note is null or char_length(note) <= 500)
);

create index if not exists idx_setup_review_attestations_slice_v51
  on public.setup_review_attestations(studio_id,scope_kind,entity_id,aspect,created_at desc);
create index if not exists idx_setup_review_attestations_reviewer_v51
  on public.setup_review_attestations(reviewer_user_id,created_at desc);

alter table public.setup_review_attestations enable row level security;
drop policy if exists setup_review_attestations_member_select_v51 on public.setup_review_attestations;
create policy setup_review_attestations_member_select_v51
on public.setup_review_attestations
for select
to authenticated
using (private.is_studio_member(studio_id));

revoke all on table public.setup_review_attestations from public,anon,authenticated;
grant select on table public.setup_review_attestations to authenticated,service_role;

-- Fingerprint only the semantic dependency for this slice: room identity,
-- capacity, aspect and review-schema interpretation. Planning version numbers,
-- timestamps, room name/features and unrelated inventory are intentionally absent.
create or replace function private.room_capacity_review_fingerprint_v51(
  p_snapshot jsonb,
  p_room_id text,
  p_review_schema_version integer default 1
)
returns text
language sql
immutable
security definer
set search_path=''
as $function$
  select encode(
    extensions.digest(
      pg_catalog.convert_to(
        jsonb_build_object(
          'scopeKind','ROOM',
          'entityId',p_room_id,
          'aspect','capacity',
          'reviewSchemaVersion',p_review_schema_version,
          'capacity',room_item->'capacity'
        )::text,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  )
  from jsonb_array_elements(coalesce(p_snapshot->'rooms','[]'::jsonb)) as room_item
  where room_item->>'id'=p_room_id
  limit 1
$function$;
revoke all on function private.room_capacity_review_fingerprint_v51(jsonb,text,integer) from public,anon,authenticated;

-- Member-readable current status. MISSING / CHANGED_SINCE_REVIEW are derived,
-- never persisted. Historical PlanningDatasetVersions prevent an old attestation
-- from silently reviving when a room later returns to a previously reviewed value.
create or replace function public.list_room_capacity_review_status_v51(p_studio_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $function$
declare
  v_uid uuid:=auth.uid();
  v_current_version integer;
  v_current_snapshot jsonb;
  v_room jsonb;
  v_room_id text;
  v_capacity integer;
  v_current_fingerprint text;
  v_latest public.setup_review_attestations%rowtype;
  v_has_latest boolean;
  v_changed_since boolean;
  v_state text;
  v_history jsonb;
  v_items jsonb:='[]'::jsonb;
begin
  if v_uid is null then raise exception 'Authentication required'; end if;
  if not private.is_studio_member(p_studio_id) then raise exception 'Studio membership required'; end if;

  select pd.version,pd.snapshot into v_current_version,v_current_snapshot
  from public.planning_dataset_versions pd
  where pd.studio_id=p_studio_id and pd.status='CURRENT'
  order by pd.version desc limit 1;
  if v_current_version is null then raise exception 'No current PlanningDatasetVersion exists'; end if;

  for v_room in
    select value
    from jsonb_array_elements(coalesce(v_current_snapshot->'rooms','[]'::jsonb))
    order by value->>'name',value->>'id'
  loop
    v_room_id:=v_room->>'id';
    v_capacity:=nullif(v_room->>'capacity','')::integer;
    v_current_fingerprint:=private.room_capacity_review_fingerprint_v51(v_current_snapshot,v_room_id,1);

    v_has_latest:=false;
    select a.* into v_latest
    from public.setup_review_attestations a
    where a.studio_id=p_studio_id
      and a.scope_kind='ROOM'
      and a.entity_id=v_room_id
      and a.aspect='capacity'
      and a.review_schema_version=1
    order by a.created_at desc,a.id desc
    limit 1;
    v_has_latest:=found;

    v_changed_since:=false;
    if v_has_latest then
      select exists(
        select 1
        from public.planning_dataset_versions pd
        where pd.studio_id=p_studio_id
          and pd.version>coalesce(v_latest.source_planning_dataset_version,0)
          and pd.version<=v_current_version
          and private.room_capacity_review_fingerprint_v51(pd.snapshot,v_room_id,1)
              is distinct from v_latest.dependency_fingerprint
      ) into v_changed_since;
    end if;

    if v_capacity is null or v_capacity<=0 then
      v_state:='MISSING';
    elsif not v_has_latest then
      v_state:='NEEDS_REVIEW';
    elsif v_latest.outcome='NEEDS_REVIEW' then
      v_state:='NEEDS_REVIEW';
    elsif v_latest.outcome<>'REVIEWED_VALUE' then
      v_state:='BLOCKED';
    elsif v_latest.dependency_fingerprint is distinct from v_current_fingerprint or v_changed_since then
      v_state:='CHANGED_SINCE_REVIEW';
    else
      v_state:='REVIEWED';
    end if;

    select coalesce(jsonb_agg(jsonb_build_object(
      'id',a.id,
      'outcome',a.outcome,
      'reviewerUserId',a.reviewer_user_id,
      'reviewerLabel',a.reviewer_label,
      'sourcePlanningDatasetVersion',a.source_planning_dataset_version,
      'note',a.note,
      'createdAt',a.created_at
    ) order by a.created_at desc,a.id desc),'[]'::jsonb)
    into v_history
    from public.setup_review_attestations a
    where a.studio_id=p_studio_id
      and a.scope_kind='ROOM'
      and a.entity_id=v_room_id
      and a.aspect='capacity'
      and a.review_schema_version=1;

    v_items:=v_items || jsonb_build_array(jsonb_build_object(
      'roomId',v_room_id,
      'roomName',coalesce(v_room->>'name',v_room_id),
      'capacity',v_capacity,
      'state',v_state,
      'reviewSchemaVersion',1,
      'currentFingerprint',v_current_fingerprint,
      'planningDatasetVersion',v_current_version,
      'history',v_history
    ));
  end loop;

  return v_items;
end
$function$;

revoke all on function public.list_room_capacity_review_status_v51(uuid) from public,anon;
grant execute on function public.list_room_capacity_review_status_v51(uuid) to authenticated,service_role;

-- Historical evidence remains readable even when the entity is archived and no
-- longer appears in the current-review obligation list.
create or replace function public.list_setup_review_history_v51(
  p_studio_id uuid,
  p_scope_kind text,
  p_entity_id text,
  p_aspect text
)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $function$
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not private.is_studio_member(p_studio_id) then raise exception 'Studio membership required'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id',a.id,
      'scopeKind',a.scope_kind,
      'entityId',a.entity_id,
      'aspect',a.aspect,
      'reviewSchemaVersion',a.review_schema_version,
      'outcome',a.outcome,
      'reviewerUserId',a.reviewer_user_id,
      'reviewerLabel',a.reviewer_label,
      'sourcePlanningDatasetVersion',a.source_planning_dataset_version,
      'note',a.note,
      'createdAt',a.created_at
    ) order by a.created_at desc,a.id desc)
    from public.setup_review_attestations a
    where a.studio_id=p_studio_id
      and a.scope_kind=p_scope_kind
      and a.entity_id is not distinct from p_entity_id
      and a.aspect=p_aspect
  ),'[]'::jsonb);
end
$function$;

revoke all on function public.list_setup_review_history_v51(uuid,text,text,text) from public,anon;
grant execute on function public.list_setup_review_history_v51(uuid,text,text,text) to authenticated,service_role;

create or replace function public.attest_room_capacity_review_v51(
  p_studio_id uuid,
  p_room_id text,
  p_expected_planning_dataset_version integer,
  p_expected_fingerprint text,
  p_outcome text,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $function$
declare
  v_uid uuid:=auth.uid();
  v_role text;
  v_actor text;
  v_current_version integer;
  v_snapshot jsonb;
  v_capacity integer;
  v_fingerprint text;
  v_review_id uuid;
begin
  if v_uid is null then raise exception 'Authentication required'; end if;
  if p_studio_id is null then raise exception 'Studio is required'; end if;
  if coalesce(btrim(p_room_id),'')='' then raise exception 'Room is required'; end if;
  if p_expected_planning_dataset_version is null then raise exception 'Expected PlanningDatasetVersion is required'; end if;
  if coalesce(btrim(p_expected_fingerprint),'')='' then raise exception 'Expected room-capacity fingerprint is required'; end if;
  if p_outcome<>'REVIEWED_VALUE' then
    raise exception 'ROOM_CAPACITY_REVIEW_OUTCOME_INVALID: capacity requires REVIEWED_VALUE and cannot be waived as no restriction';
  end if;
  if p_note is not null and char_length(p_note)>500 then raise exception 'Review note is limited to 500 characters'; end if;

  -- Exact selected-tenant authorization. Locking this row serializes role
  -- downgrade/removal against the append-only review write.
  select m.role into v_role
  from public.studio_members m
  where m.studio_id=p_studio_id and m.user_id=v_uid
  for update;
  if not found or v_role not in ('OWNER','EDITOR') then
    raise exception using errcode='42501',message='Editor membership required for selected workspace';
  end if;

  select coalesce(p.display_name,u.email,'Studio user') into v_actor
  from auth.users u
  left join public.profiles p on p.id=u.id
  where u.id=v_uid;

  -- Use the same planning-entity serialization key as governed inventory edits
  -- and archive/restore. Version + fingerprint are rechecked after the lock.
  perform pg_advisory_xact_lock(hashtextextended('planning-entity:'||p_studio_id::text,0));

  select pd.version,pd.snapshot into v_current_version,v_snapshot
  from public.planning_dataset_versions pd
  where pd.studio_id=p_studio_id and pd.status='CURRENT'
  order by pd.version desc limit 1;
  if v_current_version is null then raise exception 'No current PlanningDatasetVersion exists'; end if;
  if v_current_version<>p_expected_planning_dataset_version then
    raise exception 'STALE_ROOM_CAPACITY_REVIEW_VERSION: expected PlanningDatasetVersion %, current %',p_expected_planning_dataset_version,v_current_version;
  end if;

  select nullif(room_item->>'capacity','')::integer into v_capacity
  from jsonb_array_elements(coalesce(v_snapshot->'rooms','[]'::jsonb)) as room_item
  where room_item->>'id'=p_room_id
  limit 1;
  if not found then raise exception 'ROOM_CAPACITY_REVIEW_ROOM_NOT_ACTIVE: room is missing or archived in the current Planning Dataset'; end if;
  if v_capacity is null or v_capacity<=0 then
    raise exception 'ROOM_CAPACITY_REVIEW_MISSING: enter a positive room capacity before reviewing it';
  end if;

  v_fingerprint:=private.room_capacity_review_fingerprint_v51(v_snapshot,p_room_id,1);
  if lower(p_expected_fingerprint) is distinct from v_fingerprint then
    raise exception 'STALE_ROOM_CAPACITY_REVIEW_FINGERPRINT: room capacity changed before review commit';
  end if;

  insert into public.setup_review_attestations(
    studio_id,scope_kind,entity_id,aspect,review_schema_version,
    dependency_fingerprint,outcome,reviewer_user_id,reviewer_label,
    source_planning_dataset_version,note
  ) values(
    p_studio_id,'ROOM',p_room_id,'capacity',1,
    v_fingerprint,'REVIEWED_VALUE',v_uid,coalesce(v_actor,'Studio user'),
    v_current_version,nullif(btrim(coalesce(p_note,'')),'')
  ) returning id into v_review_id;

  insert into public.audit_events(
    studio_id,actor_user_id,actor_label,action,entity_type,entity_id,detail,payload
  ) values(
    p_studio_id,v_uid,coalesce(v_actor,'Studio user'),'SETUP_REVIEW_ATTESTED','ROOM',p_room_id,
    'Reviewed room capacity for setup',
    jsonb_build_object(
      'reviewId',v_review_id,
      'scopeKind','ROOM',
      'aspect','capacity',
      'reviewSchemaVersion',1,
      'outcome','REVIEWED_VALUE',
      'planningDatasetVersion',v_current_version
    )
  );

  return jsonb_build_object(
    'status','REVIEWED',
    'reviewId',v_review_id,
    'roomId',p_room_id,
    'reviewSchemaVersion',1,
    'currentFingerprint',v_fingerprint,
    'planningDatasetVersion',v_current_version
  );
end
$function$;

revoke all on function public.attest_room_capacity_review_v51(uuid,text,integer,text,text,text) from public,anon;
grant execute on function public.attest_room_capacity_review_v51(uuid,text,integer,text,text,text) to authenticated,service_role;
