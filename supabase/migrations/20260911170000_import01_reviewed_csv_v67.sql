-- IMPORT-01: reviewed CSV intake for the canonical PlanningDataset inventory.
-- The browser owns parsing and preview; this RPC revalidates the reviewed row
-- contract, serializes the expected PlanningDataset version, and applies one
-- atomic batch through the existing governed planning mutation.

create table if not exists public.planning_import_batches (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios(id) on delete cascade,
  batch_id text not null,
  payload_hash text not null check (payload_hash ~ '^[0-9a-f]{64}$'),
  expected_planning_dataset_version integer not null check (expected_planning_dataset_version > 0),
  actor_user_id uuid references auth.users(id) on delete set null,
  actor_label text not null,
  source_metadata jsonb not null default '{}'::jsonb,
  result jsonb not null,
  created_at timestamptz not null default now(),
  unique (studio_id, batch_id)
);

alter table public.planning_import_batches enable row level security;
revoke all on table public.planning_import_batches from public, anon, authenticated;
grant all on table public.planning_import_batches to service_role;

create or replace function private.reviewed_csv_formula_like_v67(p_value text)
returns boolean
language sql
immutable
set search_path=''
as $function$
  select coalesce(p_value,'') ~ '^[[:space:]]*[=+@-]'
$function$;
revoke all on function private.reviewed_csv_formula_like_v67(text) from public, anon, authenticated;

create or replace function public.apply_reviewed_csv_import_v67(
  p_studio_id uuid,
  p_batch_id text,
  p_rows jsonb,
  p_expected_planning_dataset_version integer,
  p_reason text,
  p_reviewed boolean,
  p_source_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $function$
declare
  v_context jsonb;
  v_uid uuid;
  v_actor text;
  v_existing public.planning_import_batches%rowtype;
  v_current integer;
  v_payload_hash text;
  v_seen jsonb := '{}'::jsonb;
  v_all_ids jsonb := '{}'::jsonb;
  v_row jsonb;
  v_changes jsonb;
  v_type text;
  v_operation text;
  v_entity_id text;
  v_key text;
  v_field text;
  v_item text;
  v_result jsonb;
  v_applied integer := 0;
  v_teachers integer := 0;
  v_students integer := 0;
  v_classes integer := 0;
  v_roster_links integer := 0;
  v_has_entity boolean;
  v_has_student boolean;
  v_class_roster jsonb;
  v_duplicate_roster boolean;
  v_import_counts jsonb;
begin
  v_context := private.require_studio_context_v63(p_studio_id,'EDITOR');
  v_uid := (v_context->>'user_id')::uuid;
  v_actor := coalesce(nullif(btrim(v_context->>'actor'),''),'Studio user');

  if coalesce(btrim(p_batch_id),'')='' or p_batch_id !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$' then
    raise exception using errcode='22023', message='IMPORT_BATCH_ID_INVALID';
  end if;
  if p_expected_planning_dataset_version is null or p_expected_planning_dataset_version<=0 then
    raise exception using errcode='22023', message='IMPORT_EXPECTED_VERSION_REQUIRED';
  end if;
  if coalesce(btrim(p_reason),'')='' then raise exception 'IMPORT_REASON_REQUIRED'; end if;
  if coalesce(p_reviewed,false) is not true then raise exception 'IMPORT_REVIEW_REQUIRED: Apply requires an explicit reviewed batch'; end if;
  if p_rows is null or jsonb_typeof(p_rows)<>'array' or jsonb_array_length(p_rows)=0 then
    raise exception 'IMPORT_ROWS_REQUIRED';
  end if;
  if p_source_metadata is null or jsonb_typeof(p_source_metadata)<>'object' then
    raise exception 'IMPORT_SOURCE_METADATA_INVALID';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('planning-import:'||p_studio_id::text||':'||p_batch_id,0));
  v_payload_hash := private.planning_dataset_hash_v25(p_rows);
  select * into v_existing
  from public.planning_import_batches
  where studio_id=p_studio_id and batch_id=p_batch_id
  for update;
  if v_existing.id is not null then
    if v_existing.payload_hash is distinct from v_payload_hash
       or v_existing.expected_planning_dataset_version is distinct from p_expected_planning_dataset_version then
      raise exception 'IMPORT_BATCH_ID_REUSE: batch ID was already used for a different reviewed payload or expected version';
    end if;
    return v_existing.result || jsonb_build_object('replayed',true);
  end if;

  perform pg_advisory_xact_lock(hashtextextended('planning-entity:'||p_studio_id::text,0));
  select version into v_current
  from public.planning_dataset_versions
  where studio_id=p_studio_id and status='CURRENT'
  order by version desc
  limit 1
  for update;
  if v_current is null then raise exception 'IMPORT_PLANNING_DATASET_MISSING'; end if;
  if v_current<>p_expected_planning_dataset_version then
    raise exception 'STALE_PLANNING_DATASET: expected %, current %',p_expected_planning_dataset_version,v_current;
  end if;

  -- First collect the complete stable-ID set. The second pass then sees IDs
  -- introduced anywhere in this batch, even when a direct caller submits a
  -- class row before its new student row.
  for v_row in select value from jsonb_array_elements(p_rows) loop
    if jsonb_typeof(v_row)<>'object'
       or not (v_row ?& array['entityType','operation','entityId','changes'])
       or (v_row - array['entityType','operation','entityId','changes'])<>'{}'::jsonb
       or jsonb_typeof(v_row->'changes')<>'object' then
      raise exception 'IMPORT_ROW_SHAPE_INVALID';
    end if;
    v_type:=upper(btrim(v_row->>'entityType'));
    v_operation:=upper(btrim(v_row->>'operation'));
    v_entity_id:=btrim(v_row->>'entityId');
    if v_type not in ('TEACHER','STUDENT','CLASS') then raise exception 'IMPORT_ENTITY_TYPE_UNSUPPORTED'; end if;
    if v_operation not in ('CREATE','UPDATE') then raise exception 'IMPORT_OPERATION_UNSUPPORTED'; end if;
    if v_entity_id='' or v_entity_id !~ '^[a-z0-9][a-z0-9-]{0,119}$' then raise exception 'IMPORT_STABLE_ID_INVALID: %',v_entity_id; end if;
    v_key:=v_type||':'||v_entity_id;
    if v_all_ids ? v_key then raise exception 'DUPLICATE_IMPORT_ENTITY: %',v_key; end if;
    v_all_ids:=jsonb_set(v_all_ids,array[v_key],'true'::jsonb,true);
  end loop;

  -- Validate the complete batch before calling any canonical mutation. The
  -- validation sees both current IDs and IDs introduced by this batch, so a
  -- later class may safely reference a student created in the same review.
  for v_row in select value from jsonb_array_elements(p_rows) loop
    if jsonb_typeof(v_row)<>'object'
       or not (v_row ?& array['entityType','operation','entityId','changes'])
       or (v_row - array['entityType','operation','entityId','changes'])<>'{}'::jsonb
       or jsonb_typeof(v_row->'changes')<>'object' then
      raise exception 'IMPORT_ROW_SHAPE_INVALID';
    end if;
    v_type:=upper(btrim(v_row->>'entityType'));
    v_operation:=upper(btrim(v_row->>'operation'));
    v_entity_id:=btrim(v_row->>'entityId');
    v_changes:=v_row->'changes';
    if v_type not in ('TEACHER','STUDENT','CLASS') then raise exception 'IMPORT_ENTITY_TYPE_UNSUPPORTED'; end if;
    if v_operation not in ('CREATE','UPDATE') then raise exception 'IMPORT_OPERATION_UNSUPPORTED'; end if;
    if v_entity_id='' or v_entity_id !~ '^[a-z0-9][a-z0-9-]{0,119}$' then raise exception 'IMPORT_STABLE_ID_INVALID: %',v_entity_id; end if;
    if private.reviewed_csv_formula_like_v67(v_entity_id) then raise exception 'FORMULA_LIKE_VALUE: stable ID'; end if;
    v_key:=v_type||':'||v_entity_id;
    if v_seen ? v_key then raise exception 'DUPLICATE_IMPORT_ENTITY: %',v_key; end if;
    v_seen:=jsonb_set(v_seen,array[v_key],'true'::jsonb,true);

    for v_field in select key from jsonb_object_keys(v_changes) key loop
      if v_type='TEACHER' and v_field not in ('name','notes') then raise exception 'IMPORT_FIELD_UNSUPPORTED: TEACHER.%',v_field; end if;
      if v_type='STUDENT' and v_field not in ('name','level','cohortIds') then raise exception 'IMPORT_FIELD_UNSUPPORTED: STUDENT.%',v_field; end if;
      if v_type='CLASS' and v_field not in ('name','subject','level','durationMinutes','weeklyFrequency','rosterStudentIds','companyOnly') then raise exception 'IMPORT_FIELD_UNSUPPORTED: CLASS.%',v_field; end if;
      if jsonb_typeof(v_changes->v_field)='string' and private.reviewed_csv_formula_like_v67(v_changes->>v_field) then
        raise exception 'FORMULA_LIKE_VALUE: %.%',v_type,v_field;
      end if;
    end loop;
    if v_type='CLASS' and v_changes ? 'rosterStudentIds' then
      if jsonb_typeof(v_changes->'rosterStudentIds')<>'array' then raise exception 'IMPORT_ROSTER_SHAPE_INVALID'; end if;
      select count(*)<>count(distinct value) into v_duplicate_roster
      from jsonb_array_elements_text(v_changes->'rosterStudentIds') value;
      if v_duplicate_roster then raise exception 'DUPLICATE_ROSTER_REFERENCE: %',v_entity_id; end if;
      for v_item in select value from jsonb_array_elements_text(v_changes->'rosterStudentIds') value loop
        if v_item='' or v_item !~ '^[a-z0-9][a-z0-9-]{0,119}$' then raise exception 'MISSING_ROSTER_REFERENCE: %',v_item; end if;
        if private.reviewed_csv_formula_like_v67(v_item) then raise exception 'FORMULA_LIKE_VALUE: rosterStudentIds'; end if;
        select exists(select 1 from public.students s where s.studio_id=p_studio_id and s.id=v_item)
          or (v_all_ids ? ('STUDENT:'||v_item)) into v_has_student;
        if not v_has_student then raise exception 'MISSING_ROSTER_REFERENCE: %',v_item; end if;
      end loop;
    end if;

    if v_type='TEACHER' then
      select exists(select 1 from public.teachers where studio_id=p_studio_id and id=v_entity_id) into v_has_entity;
      v_teachers:=v_teachers+1;
    elsif v_type='STUDENT' then
      select exists(select 1 from public.students where studio_id=p_studio_id and id=v_entity_id) into v_has_entity;
      v_students:=v_students+1;
    else
      select exists(select 1 from public.class_definitions where studio_id=p_studio_id and id=v_entity_id) into v_has_entity;
      v_classes:=v_classes+1;
      v_class_roster:=coalesce(v_changes->'rosterStudentIds','[]'::jsonb);
      v_roster_links:=v_roster_links+jsonb_array_length(v_class_roster);
    end if;
    if v_operation='CREATE' and v_has_entity then raise exception 'DUPLICATE_IMPORT_ENTITY: %',v_key; end if;
    if v_operation='UPDATE' and not v_has_entity then raise exception 'IMPORT_UPDATE_ENTITY_MISSING: %',v_key; end if;
  end loop;

  v_import_counts:=jsonb_build_object('rows',v_applied,'teachers',v_teachers,'students',v_students,'classes',v_classes,'rosterLinks',v_roster_links);
  -- The caller's row order is not authoritative. Stable ordering guarantees
  -- same-batch student references are present before class mutations.
  for v_row in
    select value from jsonb_array_elements(p_rows) value
    order by case value->>'entityType' when 'TEACHER' then 1 when 'STUDENT' then 2 when 'CLASS' then 3 else 9 end, value->>'entityId'
  loop
    v_result:=public.mutate_planning_entity_v28(
      upper(v_row->>'operation'), upper(v_row->>'entityType'), v_row->>'entityId', v_row->'changes',
      btrim(p_reason)||' [reviewed CSV import '||p_batch_id||']', v_current
    );
    v_current:=(v_result->>'planningDatasetVersion')::integer;
    v_applied:=v_applied+1;
  end loop;

  v_import_counts:=jsonb_set(v_import_counts,'{rows}',to_jsonb(v_applied),true);
  v_result:=jsonb_build_object(
    'status','APPLIED',
    'batchId',p_batch_id,
    'replayed',false,
    'payloadHash',v_payload_hash,
    'expectedPlanningDatasetVersion',p_expected_planning_dataset_version,
    'planningDatasetVersion',v_current,
    'scheduleRequiresRevalidation',v_current<>p_expected_planning_dataset_version,
    'importCounts',v_import_counts,
    'sourceMetadata',p_source_metadata
  );
  insert into public.planning_import_batches(
    studio_id,batch_id,payload_hash,expected_planning_dataset_version,actor_user_id,actor_label,source_metadata,result
  ) values (
    p_studio_id,p_batch_id,v_payload_hash,p_expected_planning_dataset_version,v_uid,v_actor,p_source_metadata,v_result
  );
  insert into public.audit_events(studio_id,actor_user_id,actor_label,action,entity_type,entity_id,detail,payload)
  values(
    p_studio_id,v_uid,v_actor,'PLANNING_IMPORT_APPLIED','PLANNING_IMPORT',p_batch_id,
    'Reviewed CSV planning inventory applied atomically',
    jsonb_build_object(
      'batchId',p_batch_id,'payloadHash',v_payload_hash,
      'expectedPlanningDatasetVersion',p_expected_planning_dataset_version,
      'planningDatasetVersion',v_current,'importCounts',v_import_counts,
      'sourceMetadata',p_source_metadata
    )
  );
  return v_result;
end
$function$;

revoke all on function public.apply_reviewed_csv_import_v67(uuid,text,jsonb,integer,text,boolean,jsonb) from public, anon;
grant execute on function public.apply_reviewed_csv_import_v67(uuid,text,jsonb,integer,text,boolean,jsonb) to authenticated, service_role;
