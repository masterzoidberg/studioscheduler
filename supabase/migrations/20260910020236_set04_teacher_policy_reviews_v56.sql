-- SET-04 / teacher availability, qualification and review boundary.
--
-- This is a forward-only successor to the SET-03 typed setup boundary. Teacher
-- identity remains PlanningDatasetVersion data; Rulebook owns only the typed
-- policy meaning and append-only review attestations.

create or replace function private.validate_setup_typed_policy_v55(
  p_studio_id uuid,
  p_rule_id text,
  p_policy jsonb
)
returns void
language plpgsql
security definer
set search_path=''
as $function$
declare
  v_planning jsonb;
  v_item jsonb;
  v_other jsonb;
  v_day text;
  v_start text;
  v_end text;
  v_room_id text;
  v_teacher_id text;
  v_class_id text;
  v_feature text;
  v_expected_kind text;
  v_availability_prefix constant text:='SET04-TEACHER-AVAILABILITY-';
  v_qualification_prefix constant text:='SET04-TEACHER-QUALIFICATION-';
begin
  if p_rule_id not in ('OPS-001','ROOM-002','ROOM-007','ROOM-009','AIM-001','AIM-003')
     and p_rule_id not like v_availability_prefix||'%'
     and p_rule_id not like v_qualification_prefix||'%' then
    raise exception 'SETUP_TYPED_POLICY_RULE_UNSUPPORTED: rule % is not an approved setup policy owner',p_rule_id;
  end if;

  v_expected_kind:=case
    when p_rule_id in ('AIM-003') or p_rule_id like v_availability_prefix||'%' then 'TEACHER_DAY_WINDOW'
    when p_rule_id in ('AIM-001') or p_rule_id like v_qualification_prefix||'%' then 'TEACHER_QUALIFICATION'
    when p_rule_id='OPS-001' then 'STUDIO_OPERATING_WINDOWS'
    when p_rule_id='ROOM-002' then 'ROOM_UNAVAILABLE_WINDOWS'
    when p_rule_id='ROOM-007' then 'ROOM_CAPACITY_POLICY'
    when p_rule_id='ROOM-009' then 'ROOM_REQUIRED_FEATURES'
  end;

  if p_policy is null then
    if p_rule_id like v_availability_prefix||'%' then return; end if;
    raise exception 'SETUP_TYPED_POLICY_INVALID: policy may be cleared only for a generated teacher availability owner';
  end if;
  if jsonb_typeof(p_policy)<>'object' then raise exception 'SETUP_TYPED_POLICY_INVALID: policy must be an object'; end if;

  if exists(select 1 from jsonb_object_keys(p_policy) key where key not in ('schemaVersion','kind','teacherId','allowedDays','windows','unavailableDays','day','start','end','roomId','closedDays','exemptClassIds','classIds','requiredFeatures')) then
    raise exception 'SETUP_TYPED_POLICY_UNKNOWN_FIELD: policy contains an unsupported field';
  end if;
  if p_policy->>'schemaVersion'<>'1.0' or p_policy->>'kind'<>v_expected_kind then
    raise exception 'SETUP_TYPED_POLICY_KIND_MISMATCH: % requires typed kind %',p_rule_id,v_expected_kind;
  end if;

  select pd.snapshot into v_planning
  from public.planning_dataset_versions pd
  where pd.studio_id=p_studio_id and pd.status='CURRENT'
  order by pd.version desc limit 1;
  if v_planning is null then raise exception 'SETUP_TYPED_POLICY_NO_PLANNING_DATASET: current PlanningDatasetVersion is required'; end if;

  if v_expected_kind in ('TEACHER_DAY_WINDOW','TEACHER_QUALIFICATION') then
    v_teacher_id:=nullif(btrim(p_policy->>'teacherId'),'');
    if v_teacher_id is null then raise exception 'SETUP_TYPED_POLICY_TEACHER_ID_REQUIRED: teacherId must be a stable teacher ID'; end if;
    if not exists(
      select 1 from jsonb_array_elements_text(coalesce(v_planning->'teacherIds','[]'::jsonb)) teacher(value)
      where teacher.value=v_teacher_id
    ) and not exists(
      select 1 from jsonb_array_elements(coalesce(v_planning->'teachers','[]'::jsonb)) teacher(value)
      where teacher.value->>'id'=v_teacher_id
    ) then
      raise exception 'SETUP_TYPED_POLICY_TEACHER_NOT_ACTIVE: teacherId must identify an active PlanningDataset teacher';
    end if;
    if p_rule_id like v_availability_prefix||'%' and substring(p_rule_id from char_length(v_availability_prefix)+1)<>v_teacher_id then
      raise exception 'SETUP_TYPED_POLICY_OWNER_CONFLICT: generated availability owner must match teacherId';
    end if;
    if p_rule_id like v_qualification_prefix||'%' and substring(p_rule_id from char_length(v_qualification_prefix)+1)<>v_teacher_id then
      raise exception 'SETUP_TYPED_POLICY_OWNER_CONFLICT: generated qualification owner must match teacherId';
    end if;
  end if;

  if v_expected_kind='TEACHER_DAY_WINDOW' then
    if exists(select 1 from jsonb_object_keys(p_policy) key where key not in ('schemaVersion','kind','teacherId','allowedDays','windows','unavailableDays','day','start','end')) then raise exception 'SETUP_TYPED_POLICY_UNKNOWN_FIELD: teacher availability policy contains an unsupported field'; end if;
    if p_rule_id='AIM-003' and p_policy is null then raise exception 'SETUP_TYPED_POLICY_INVALID: AIM-003 cannot be cleared; use a generated SET-04 availability owner for explicit unrestricted review'; end if;
    if p_policy ? 'allowedDays' then
      if jsonb_typeof(p_policy->'allowedDays')<>'array' or jsonb_array_length(p_policy->'allowedDays')=0 then raise exception 'SETUP_TYPED_POLICY_ALLOWED_DAYS_INVALID: allowedDays must be a non-empty array'; end if;
      for v_day in select value from jsonb_array_elements_text(p_policy->'allowedDays') loop
        if v_day not in ('Monday','Tuesday','Wednesday','Thursday','Friday','Saturday') then raise exception 'SETUP_TYPED_POLICY_ALLOWED_DAYS_INVALID: allowedDays contains an unsupported day'; end if;
      end loop;
      if jsonb_array_length(p_policy->'allowedDays')<>jsonb_array_length((select jsonb_agg(distinct value order by value) from jsonb_array_elements(p_policy->'allowedDays') item(value))) then raise exception 'SETUP_TYPED_POLICY_DUPLICATE: allowedDays must be duplicate-free'; end if;
    end if;
    if p_policy ? 'unavailableDays' then
      if jsonb_typeof(p_policy->'unavailableDays')<>'array' then raise exception 'SETUP_TYPED_POLICY_UNAVAILABLE_DAYS_INVALID: unavailableDays must be an array'; end if;
      for v_day in select value from jsonb_array_elements_text(p_policy->'unavailableDays') loop
        if v_day not in ('Monday','Tuesday','Wednesday','Thursday','Friday','Saturday') then raise exception 'SETUP_TYPED_POLICY_UNAVAILABLE_DAYS_INVALID: unavailableDays contains an unsupported day'; end if;
      end loop;
      if jsonb_array_length(p_policy->'unavailableDays')<>jsonb_array_length((select coalesce(jsonb_agg(distinct value order by value),'[]'::jsonb) from jsonb_array_elements(p_policy->'unavailableDays') item(value))) then raise exception 'SETUP_TYPED_POLICY_DUPLICATE: unavailableDays must be duplicate-free'; end if;
    end if;
    if p_policy ? 'windows' then
      if jsonb_typeof(p_policy->'windows')<>'array' or jsonb_array_length(p_policy->'windows')=0 then raise exception 'SETUP_TYPED_POLICY_WINDOWS_INVALID: teacher windows must be a non-empty array'; end if;
      for v_item in select value from jsonb_array_elements(p_policy->'windows') item(value) loop
        if jsonb_typeof(v_item)<>'object' or exists(select 1 from jsonb_object_keys(v_item) key where key not in ('day','start','end')) then raise exception 'SETUP_TYPED_POLICY_WINDOWS_INVALID: teacher window must contain only day,start,end'; end if;
        v_day:=v_item->>'day'; v_start:=v_item->>'start'; v_end:=v_item->>'end';
        if v_day not in ('Monday','Tuesday','Wednesday','Thursday','Friday','Saturday')
           or v_start !~ '^(0[0-9]|1[0-9]|2[0-3]):[0-5][0-9]$'
           or v_end !~ '^(0[0-9]|1[0-9]|2[0-3]):[0-5][0-9]$'
           or v_start>=v_end
           or substring(v_start from 4 for 2)::integer%15<>0
           or substring(v_end from 4 for 2)::integer%15<>0 then
          raise exception 'SETUP_TYPED_POLICY_WINDOWS_INVALID: teacher windows must be same-day HH:MM intervals on the 15-minute grid';
        end if;
      end loop;
      if jsonb_array_length(p_policy->'windows')<>jsonb_array_length((select jsonb_agg(distinct value order by value) from jsonb_array_elements(p_policy->'windows') item(value))) then raise exception 'SETUP_TYPED_POLICY_DUPLICATE: teacher windows must be duplicate-free'; end if;
      for v_item in select value from jsonb_array_elements(p_policy->'windows') item(value) loop
        if exists(
          select 1 from jsonb_array_elements(p_policy->'windows') other(value)
          where other.value->>'day'=v_item->>'day'
            and other.value->>'start'<v_item->>'end'
            and v_item->>'start'<other.value->>'end'
            and other.value<>v_item
        ) then raise exception 'SETUP_TYPED_POLICY_WINDOWS_CONFLICT: teacher availability windows overlap on %',v_item->>'day'; end if;
      end loop;
    end if;
    if (p_policy ? 'day')<>(p_policy ? 'start') or (p_policy ? 'day')<>(p_policy ? 'end') then raise exception 'SETUP_TYPED_POLICY_WINDOW_INVALID: day,start,end must be supplied together'; end if;
    if p_policy ? 'day' then
      v_day:=p_policy->>'day'; v_start:=p_policy->>'start'; v_end:=p_policy->>'end';
      if v_day not in ('Monday','Tuesday','Wednesday','Thursday','Friday','Saturday') or v_start !~ '^(0[0-9]|1[0-9]|2[0-3]):[0-5][0-9]$' or v_end !~ '^(0[0-9]|1[0-9]|2[0-3]):[0-5][0-9]$' or v_start>=v_end or substring(v_start from 4 for 2)::integer%15<>0 or substring(v_end from 4 for 2)::integer%15<>0 then raise exception 'SETUP_TYPED_POLICY_WINDOWS_INVALID: teacher day window must be a same-day HH:MM interval on the 15-minute grid'; end if;
    end if;
    if (p_policy ? 'allowedDays') and ((p_policy ? 'windows') or (p_policy ? 'day')) then raise exception 'SETUP_TYPED_POLICY_WINDOW_AMBIGUOUS: use allowedDays, windows, or one day window, not more than one'; end if;
    if (p_policy ? 'windows') and (p_policy ? 'day') then raise exception 'SETUP_TYPED_POLICY_WINDOW_AMBIGUOUS: use windows or one day window, not both'; end if;
    if not (p_policy ? 'allowedDays') and not (p_policy ? 'windows') and not (p_policy ? 'day') then raise exception 'SETUP_TYPED_POLICY_WINDOW_REQUIRED: teacher availability requires allowedDays, windows, or a specific day window'; end if;
    if p_policy ? 'unavailableDays' and exists(
      select 1 from jsonb_array_elements_text(p_policy->'unavailableDays') unavailable(day)
      where (p_policy ? 'allowedDays' and unavailable.day=any(array(select value from jsonb_array_elements_text(p_policy->'allowedDays'))))
         or (p_policy ? 'day' and unavailable.day=p_policy->>'day')
         or (p_policy ? 'windows' and unavailable.day=any(array(select value->>'day' from jsonb_array_elements(p_policy->'windows') item(value))))
    ) then raise exception 'SETUP_TYPED_POLICY_UNAVAILABLE_DAY_CONFLICT: unavailableDays overlaps an allowed day'; end if;
  end if;

  if v_expected_kind='TEACHER_QUALIFICATION' then
    if exists(select 1 from jsonb_object_keys(p_policy) key where key not in ('schemaVersion','kind','teacherId','classIds')) then raise exception 'SETUP_TYPED_POLICY_UNKNOWN_FIELD: teacher qualification policy contains an unsupported field'; end if;
    if jsonb_typeof(p_policy->'classIds')<>'array' then raise exception 'SETUP_TYPED_POLICY_CLASS_IDS_INVALID: qualification classIds must be an array; an explicit empty array means default-deny'; end if;
    for v_class_id in select value from jsonb_array_elements_text(p_policy->'classIds') loop
      if coalesce(btrim(v_class_id),'')='' or not exists(select 1 from jsonb_array_elements(coalesce(v_planning->'classes','[]'::jsonb)) klass(value) where value->>'id'=v_class_id) then raise exception 'SETUP_TYPED_POLICY_CLASS_NOT_ACTIVE: qualification classIds contains a class outside the current PlanningDataset'; end if;
    end loop;
    if jsonb_array_length(p_policy->'classIds')<>jsonb_array_length((select coalesce(jsonb_agg(distinct value order by value),'[]'::jsonb) from jsonb_array_elements(p_policy->'classIds') item(value))) then raise exception 'SETUP_TYPED_POLICY_DUPLICATE: qualification classIds must be duplicate-free'; end if;
  end if;

  if v_expected_kind in ('STUDIO_OPERATING_WINDOWS','ROOM_UNAVAILABLE_WINDOWS') then
    if jsonb_typeof(p_policy->'windows')<>'array' or jsonb_array_length(p_policy->'windows')=0 then raise exception 'SETUP_TYPED_POLICY_WINDOWS_INVALID: % windows must be a non-empty array',p_rule_id; end if;
    for v_item in select value from jsonb_array_elements(p_policy->'windows') item(value) loop
      v_day:=v_item->>'day'; v_start:=v_item->>'start'; v_end:=v_item->>'end';
      if v_day not in ('Monday','Tuesday','Wednesday','Thursday','Friday','Saturday') or v_start !~ '^(0[0-9]|1[0-9]|2[0-3]):[0-5][0-9]$' or v_end !~ '^(0[0-9]|1[0-9]|2[0-3]):[0-5][0-9]$' or v_start>=v_end or substring(v_start from 4 for 2)::integer%15<>0 or substring(v_end from 4 for 2)::integer%15<>0 then raise exception 'SETUP_TYPED_POLICY_WINDOWS_INVALID: % windows must be same-day HH:MM intervals on the 15-minute grid',p_rule_id; end if;
    end loop;
    if v_expected_kind='STUDIO_OPERATING_WINDOWS' and p_policy ? 'closedDays' then
      for v_day in select value from jsonb_array_elements_text(p_policy->'closedDays') loop if v_day not in ('Monday','Tuesday','Wednesday','Thursday','Friday','Saturday') then raise exception 'SETUP_TYPED_POLICY_CLOSED_DAYS_INVALID: closedDays contains an unsupported day'; end if; end loop;
      if jsonb_array_length(p_policy->'closedDays')<>jsonb_array_length((select coalesce(jsonb_agg(distinct value order by value),'[]'::jsonb) from jsonb_array_elements(p_policy->'closedDays') item(value))) then raise exception 'SETUP_TYPED_POLICY_CLOSED_DAYS_INVALID: closedDays must be duplicate-free'; end if;
      if exists(select 1 from jsonb_array_elements(p_policy->'windows') win(value) join jsonb_array_elements_text(p_policy->'closedDays') closed(day) on closed.day=win.value->>'day') then raise exception 'SETUP_TYPED_POLICY_WINDOW_CLOSED_DAY_CONFLICT: a window cannot be configured on a closed day'; end if;
    end if;
  end if;

  if v_expected_kind in ('ROOM_UNAVAILABLE_WINDOWS','ROOM_CAPACITY_POLICY') then
    v_room_id:=nullif(btrim(p_policy->>'roomId'),'');
    if v_room_id is null or not exists(select 1 from jsonb_array_elements(coalesce(v_planning->'rooms','[]'::jsonb)) room(value) where value->>'id'=v_room_id) then raise exception 'SETUP_TYPED_POLICY_ROOM_NOT_ACTIVE: roomId must identify an active PlanningDataset room'; end if;
  end if;
  if v_expected_kind='ROOM_CAPACITY_POLICY' and p_policy ? 'exemptClassIds' then
    if jsonb_typeof(p_policy->'exemptClassIds')<>'array' then raise exception 'SETUP_TYPED_POLICY_CLASS_IDS_INVALID: exemptClassIds must be an array'; end if;
    for v_class_id in select value from jsonb_array_elements_text(p_policy->'exemptClassIds') loop if not exists(select 1 from jsonb_array_elements(coalesce(v_planning->'classes','[]'::jsonb)) klass(value) where value->>'id'=v_class_id) then raise exception 'SETUP_TYPED_POLICY_CLASS_NOT_ACTIVE: exemptClassIds contains a class outside the current PlanningDataset'; end if; end loop;
  end if;
  if v_expected_kind='ROOM_REQUIRED_FEATURES' then
    if jsonb_typeof(p_policy->'classIds')<>'array' or jsonb_array_length(p_policy->'classIds')=0 or jsonb_typeof(p_policy->'requiredFeatures')<>'array' or jsonb_array_length(p_policy->'requiredFeatures')=0 then raise exception 'SETUP_TYPED_POLICY_FEATURES_INVALID: classIds and requiredFeatures must be non-empty arrays'; end if;
    for v_class_id in select value from jsonb_array_elements_text(p_policy->'classIds') loop if not exists(select 1 from jsonb_array_elements(coalesce(v_planning->'classes','[]'::jsonb)) klass(value) where value->>'id'=v_class_id) then raise exception 'SETUP_TYPED_POLICY_CLASS_NOT_ACTIVE: classIds contains a class outside the current PlanningDataset'; end if; end loop;
    for v_feature in select value from jsonb_array_elements_text(p_policy->'requiredFeatures') loop if coalesce(btrim(v_feature),'')='' then raise exception 'SETUP_TYPED_POLICY_FEATURES_INVALID: requiredFeatures cannot contain blanks'; end if; end loop;
  end if;
end
$function$;
revoke all on function private.validate_setup_typed_policy_v55(uuid,text,jsonb) from public,anon,authenticated;

create or replace function public.apply_setup_typed_policies_v55(
  p_policies jsonb,p_reason text,p_expected_rulebook_version integer,p_expected_enforcement_version integer,p_expected_planning_dataset_version integer
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $function$
declare
  ctx jsonb:=private.assert_editor_context(); v_uid uuid:=(ctx->>'user_id')::uuid; v_studio uuid:=(ctx->>'studio_id')::uuid; v_actor text:=ctx->>'actor'; v_role text;
  v_rulebook public.rulebook_versions%rowtype; v_enforcement public.rule_enforcement_versions%rowtype; v_policy_item jsonb; v_policy jsonb; v_rule_id text;
  v_input_ids text[]:='{}'::text[]; v_changed_ids text[]:='{}'::text[]; v_owner_ids text[]:='{}'::text[]; v_old_owner_ids text[]:='{}'::text[]; v_introduced_ids text[]:='{}'::text[];
  v_bundle jsonb; v_bundles jsonb:='[]'::jsonb; v_before jsonb; v_after jsonb; v_history_id uuid; v_snapshot jsonb; v_new_version integer; v_new_enforcement integer; v_source_hash text; v_expected_kind text; v_planning_version integer; v_teacher_id text;
  v_availability_prefix constant text:='SET04-TEACHER-AVAILABILITY-'; v_qualification_prefix constant text:='SET04-TEACHER-QUALIFICATION-';
begin
  if coalesce(btrim(p_reason),'')='' then raise exception 'Reason is required'; end if;
  select m.role into v_role from public.studio_members m where m.studio_id=v_studio and m.user_id=v_uid for update;
  if not found or v_role not in ('OWNER','EDITOR') then raise exception using errcode='42501',message='Editor membership required for selected workspace'; end if;
  perform pg_advisory_xact_lock(hashtextextended('typed-setup:'||v_studio::text,0));
  perform pg_advisory_xact_lock(hashtextextended('planning-dataset:'||v_studio::text,0));
  select * into v_rulebook from public.rulebook_versions rb where rb.studio_id=v_studio and rb.status='CURRENT' for update;
  if v_rulebook.id is null then raise exception 'SETUP_TYPED_POLICY_NO_RULEBOOK: no current RulebookVersion exists'; end if;
  if v_rulebook.version<4 or v_rulebook.version>100 then raise exception 'SETUP_TYPED_POLICY_RULEBOOK_UNSUPPORTED: setup policies require the accepted typed Rulebook'; end if;
  select * into v_enforcement from public.rule_enforcement_versions ev where ev.studio_id=v_studio and ev.status='CURRENT' limit 1 for update;
  if coalesce(v_enforcement.version,0)<>coalesce(p_expected_enforcement_version,0) then raise exception 'STALE_ENFORCEMENT: expected %, current %',coalesce(p_expected_enforcement_version,0),coalesce(v_enforcement.version,0); end if;
  if v_rulebook.version<>p_expected_rulebook_version then raise exception 'STALE_RULEBOOK: expected %, current %',p_expected_rulebook_version,v_rulebook.version; end if;
  select pd.version into v_planning_version from public.planning_dataset_versions pd where pd.studio_id=v_studio and pd.status='CURRENT' order by pd.version desc limit 1;
  if v_planning_version is null then raise exception 'SETUP_TYPED_POLICY_NO_PLANNING_DATASET: current PlanningDatasetVersion is required'; end if;
  if v_planning_version<>p_expected_planning_dataset_version then raise exception 'STALE_PLANNING_DATASET: expected %, current %',p_expected_planning_dataset_version,v_planning_version; end if;
  if jsonb_typeof(coalesce(p_policies,'[]'::jsonb))<>'array' then raise exception 'SETUP_TYPED_POLICY_INVALID: policies must be an array'; end if;

  for v_policy_item in select value from jsonb_array_elements(coalesce(p_policies,'[]'::jsonb)) item(value) loop
    if jsonb_typeof(v_policy_item)<>'object' or coalesce((select array_agg(key order by key) from jsonb_object_keys(v_policy_item) key),array[]::text[])<>array['policy','ruleId'] then raise exception 'SETUP_TYPED_POLICY_INVALID: each policy entry must contain exactly ruleId and policy'; end if;
    v_rule_id:=nullif(btrim(v_policy_item->>'ruleId'),''); v_policy:=nullif(v_policy_item->'policy','null'::jsonb);
    if v_rule_id is null or v_rule_id=any(v_input_ids) then raise exception 'SETUP_TYPED_POLICY_DUPLICATE: each setup policy owner may be supplied once'; end if;
    if not exists(select 1 from public.rules r where r.studio_id=v_studio and r.id=v_rule_id) then
      if v_rule_id like v_availability_prefix||'%' or v_rule_id like v_qualification_prefix||'%' then
        v_teacher_id:=substring(v_rule_id from char_length(case when v_rule_id like v_availability_prefix||'%' then v_availability_prefix else v_qualification_prefix end)+1);
        if coalesce(btrim(v_teacher_id),'')='' then raise exception 'SETUP_TYPED_POLICY_RULE_MISSING: generated teacher owner must include a teacher ID'; end if;
        insert into public.rules(id,studio_id,category,type,title,description,strength,status,verification_status,review_status,affected_entity_ids,parameters,exceptions,source,version_introduced,classification_raw,review,source_raw,enforcement_status)
        values(v_rule_id,v_studio,'TEACHER_POLICY','SETUP_TYPED_POLICY','Teacher setup policy '||v_teacher_id,'SET-04 manager-owned teacher setup policy for stable teacher '||v_teacher_id,'HARD','ACTIVE','VERIFIED','VERIFIED','{}'::text[],'{}'::jsonb,'[]'::jsonb,jsonb_build_object('type','SETUP','task','SET-04'),v_rulebook.version,'HARD','{}'::jsonb,'{}'::jsonb,'NOT_IMPLEMENTED');
      else
        raise exception 'SETUP_TYPED_POLICY_RULE_MISSING: rule % is not present in the current Rulebook',v_rule_id;
      end if;
    end if;
    perform private.validate_setup_typed_policy_v55(v_studio,v_rule_id,v_policy);
    v_input_ids:=array_append(v_input_ids,v_rule_id);
  end loop;

  foreach v_rule_id in array array['OPS-001','ROOM-002','ROOM-009']::text[] loop
    if not (v_rule_id=any(v_input_ids)) then
      select to_jsonb(r) into v_before from public.rules r where r.studio_id=v_studio and r.id=v_rule_id for update;
      v_expected_kind:=case v_rule_id when 'OPS-001' then 'STUDIO_OPERATING_WINDOWS' when 'ROOM-002' then 'ROOM_UNAVAILABLE_WINDOWS' when 'ROOM-009' then 'ROOM_REQUIRED_FEATURES' end;
      if v_before is not null and v_before->'parameters' ? 'policy' then
        if v_before->'parameters'->'policy'->>'kind'<>v_expected_kind then raise exception 'SETUP_TYPED_POLICY_OWNER_CONFLICT: % already owns another typed policy kind',v_rule_id; end if;
        insert into public.rule_history(studio_id,rule_id,rulebook_version,actor_user_id,actor_label,reason,before_rule,after_rule,ai_proposed) values(v_studio,v_rule_id,v_rulebook.version+1,v_uid,v_actor,p_reason,v_before,null,false) returning id into v_history_id;
        update public.rules set parameters='{}'::jsonb,affected_entity_ids='{}'::text[],updated_at=now() where studio_id=v_studio and id=v_rule_id;
        select to_jsonb(r) into v_after from public.rules r where r.studio_id=v_studio and r.id=v_rule_id; update public.rule_history set after_rule=v_after where id=v_history_id; v_changed_ids:=array_append(v_changed_ids,v_rule_id);
      end if;
    end if;
  end loop;

  for v_policy_item in select value from jsonb_array_elements(coalesce(p_policies,'[]'::jsonb)) item(value) loop
    v_rule_id:=v_policy_item->>'ruleId'; v_policy:=nullif(v_policy_item->'policy','null'::jsonb); select to_jsonb(r) into v_before from public.rules r where r.studio_id=v_studio and r.id=v_rule_id for update;
    v_expected_kind:=case when v_rule_id='AIM-003' or v_rule_id like v_availability_prefix||'%' then 'TEACHER_DAY_WINDOW' when v_rule_id='AIM-001' or v_rule_id like v_qualification_prefix||'%' then 'TEACHER_QUALIFICATION' when v_rule_id='OPS-001' then 'STUDIO_OPERATING_WINDOWS' when v_rule_id='ROOM-002' then 'ROOM_UNAVAILABLE_WINDOWS' when v_rule_id='ROOM-007' then 'ROOM_CAPACITY_POLICY' when v_rule_id='ROOM-009' then 'ROOM_REQUIRED_FEATURES' end;
    if v_before->'parameters' ? 'policy' and v_before->'parameters'->'policy'->>'kind'<>v_expected_kind then raise exception 'SETUP_TYPED_POLICY_OWNER_CONFLICT: % already owns another typed policy kind',v_rule_id; end if;
    update public.rules set parameters=case when v_policy is null then '{}'::jsonb else jsonb_build_object('policy',v_policy) end,
      affected_entity_ids=case when v_policy is null then '{}'::text[] when v_rule_id='ROOM-009' then coalesce((select array_agg(value order by value) from jsonb_array_elements_text(v_policy->'classIds') ids(value)),'{}'::text[]) when v_rule_id in ('ROOM-002','ROOM-007') then array[v_policy->>'roomId']::text[] || coalesce((select array_agg(value order by value) from jsonb_array_elements_text(coalesce(v_policy->'exemptClassIds','[]'::jsonb)) ids(value)),'{}'::text[]) when v_expected_kind in ('TEACHER_DAY_WINDOW','TEACHER_QUALIFICATION') then array[v_policy->>'teacherId']::text[] || case when v_expected_kind='TEACHER_QUALIFICATION' then coalesce((select array_agg(value order by value) from jsonb_array_elements_text(v_policy->'classIds') ids(value)),'{}'::text[]) else '{}'::text[] end else '{}'::text[] end,
      updated_at=now() where studio_id=v_studio and id=v_rule_id;
    select to_jsonb(r) into v_after from public.rules r where r.studio_id=v_studio and r.id=v_rule_id;
    insert into public.rule_history(studio_id,rule_id,rulebook_version,actor_user_id,actor_label,reason,before_rule,after_rule,ai_proposed) values(v_studio,v_rule_id,v_rulebook.version+1,v_uid,v_actor,p_reason,v_before,v_after,false);
    v_changed_ids:=array_append(v_changed_ids,v_rule_id);
  end loop;

  select coalesce(array_agg(r.id order by r.id),'{}'::text[]) into v_owner_ids from public.rules r where r.studio_id=v_studio and r.parameters ? 'policy';
  v_old_owner_ids:=coalesce((select array_agg(value #>> '{}' order by value #>> '{}') from jsonb_array_elements(coalesce(v_rulebook.source_metadata->'typedPolicyRuleIds','[]'::jsonb)) item(value)),'{}'::text[]);
  for v_rule_id in select unnest(v_owner_ids) loop
    if not (v_rule_id=any(v_old_owner_ids)) then v_introduced_ids:=array_append(v_introduced_ids,v_rule_id); end if;
    select value into v_bundle from jsonb_array_elements(coalesce(v_rulebook.source_metadata->'typedPolicyBundles','[]'::jsonb)) item(value) where value->>'ownerRuleId'=v_rule_id limit 1;
    if v_bundle is null then v_bundle:=jsonb_build_object('ownerRuleId',v_rule_id,'consumedRuleIds',jsonb_build_array(v_rule_id)); end if;
    v_bundles:=v_bundles||jsonb_build_array(v_bundle);
  end loop;
  v_new_version:=v_rulebook.version+1; v_snapshot:=coalesce((select jsonb_agg(to_jsonb(r) order by r.id) from public.rules r where r.studio_id=v_studio),'[]'::jsonb); v_source_hash:=encode(extensions.digest(pg_catalog.convert_to(v_snapshot::text,'UTF8'),'sha256'),'hex');
  update public.rulebook_versions set status='HISTORICAL' where id=v_rulebook.id;
  insert into public.rulebook_versions(studio_id,version,name,actor_user_id,actor_label,reason,changed_rule_ids,snapshot,rulebook_id,status,imported_at,source_hash,source_file_hash,rule_count,parent_version,format_version,document_type,source_metadata)
  values(v_studio,v_new_version,'DWDE Rulebook v'||v_new_version,v_uid,v_actor,p_reason,coalesce((select array_agg(distinct value order by value) from unnest(v_changed_ids) ids(value)),'{}'::text[]),v_snapshot,v_rulebook.rulebook_id,'CURRENT',now(),v_source_hash,v_rulebook.source_file_hash,v_rulebook.rule_count,v_rulebook.version,case when v_rulebook.version=4 then '2.3' else '2.4' end,'DWDE_SITE_RULEBOOK',jsonb_build_object('provenance',case when v_rulebook.version=4 then 'TYPED_POLICY_BUNDLE_MIGRATION' else 'TYPED_POLICY_BUNDLE_EDIT' end,'parentVersion',v_rulebook.version,'residualBaselineSourceHash',coalesce(v_rulebook.source_metadata->>'residualBaselineSourceHash',v_rulebook.source_hash),'previousTypedPolicyVersion',v_rulebook.version,'typedPolicyRuleIds',to_jsonb(v_owner_ids),'introducedTypedPolicyRuleIds',to_jsonb(case when v_rulebook.version=4 then v_introduced_ids else v_changed_ids end),'typedPolicyBundles',v_bundles,'hashSemantics','DATABASE_RULE_SNAPSHOT_JSONB_SHA256','transition','SET-04 teacher setup policy edit'));
  if v_enforcement.id is not null then v_new_enforcement:=v_enforcement.version+1; update public.rule_enforcement_versions set status='HISTORICAL' where id=v_enforcement.id; insert into public.rule_enforcement_versions(studio_id,version,rulebook_version,actor_user_id,actor_label,reason,changed_rule_ids,snapshot,status) values(v_studio,v_new_enforcement,v_new_version,v_uid,v_actor,'Carry forward compatibility mappings; SET-04 typed policy is Rulebook-owned',v_changed_ids,v_enforcement.snapshot,'CURRENT'); end if;
  update public.constraint_model_versions set status='HISTORICAL' where studio_id=v_studio and status='CURRENT';
  insert into public.audit_events(studio_id,actor_user_id,actor_label,action,entity_type,entity_id,detail,payload) values(v_studio,v_uid,v_actor,'RULEBOOK_VERSION','RULEBOOK',v_new_version::text,p_reason,jsonb_build_object('version',v_new_version,'parentVersion',v_rulebook.version,'changedRuleIds',v_changed_ids,'typedPolicyRuleIds',v_owner_ids,'sourceHash',v_source_hash));
  if v_enforcement.id is not null then insert into public.audit_events(studio_id,actor_user_id,actor_label,action,entity_type,entity_id,detail,payload) values(v_studio,v_uid,v_actor,'ENFORCEMENT_REBASE','RULE_ENFORCEMENT',v_new_enforcement::text,'SET-04 typed setup policy changed; compatibility mappings carried forward',jsonb_build_object('rulebookVersion',v_new_version,'enforcementVersion',v_new_enforcement,'changedRuleIds',v_changed_ids)); end if;
  return jsonb_build_object('status','APPLIED','rulebookVersion',v_new_version,'enforcementVersion',case when v_enforcement.id is null then null else v_new_enforcement end,'changedRuleIds',v_changed_ids,'typedPolicyRuleIds',v_owner_ids);
end
$function$;
revoke all on function public.apply_setup_typed_policies_v55(jsonb,text,integer,integer,integer) from public,anon;
grant execute on function public.apply_setup_typed_policies_v55(jsonb,text,integer,integer,integer) to authenticated,service_role;

-- Extend the effective POL-04 safeguard through a forward wrapper. The V54
-- implementation remains byte-identical and is retained as the base evaluator.
do $block$
begin
  if to_regprocedure('private.validate_typed_schedule_v54(uuid)') is not null
     and to_regprocedure('private.validate_typed_schedule_v54_base(uuid)') is null then
    alter function private.validate_typed_schedule_v54(uuid) rename to validate_typed_schedule_v54_base;
  end if;
end
$block$;

create or replace function private.validate_typed_schedule_v54(p_schedule_version_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $function$
declare
  v_base jsonb; v_schedule public.schedule_versions%rowtype; v_model public.constraint_model_versions%rowtype; v_planning public.planning_dataset_versions%rowtype;
  v_node jsonb; v_assignment record; v_teacher_id text; v_class_id text; v_day text; v_has_windows boolean; v_legal boolean; v_params jsonb;
  v_teacher_rule_ids jsonb:='[]'::jsonb; v_teacher_violations jsonb:='[]'::jsonb; v_model_errors jsonb:='[]'::jsonb; v_ids jsonb:='[]'::jsonb;
begin
  if to_regprocedure('private.validate_typed_schedule_v54_base(uuid)') is null then
    return jsonb_build_object('modelPresent',false,'typedRuleIds','[]'::jsonb,'violations','[]'::jsonb,'modelErrors',jsonb_build_array('V56 teacher safeguard base evaluator is unavailable'));
  end if;
  v_base:=private.validate_typed_schedule_v54_base(p_schedule_version_id);
  select * into v_schedule from public.schedule_versions where id=p_schedule_version_id;
  if v_schedule.id is null then return v_base; end if;
  select * into v_model from public.constraint_model_versions cm where cm.studio_id=v_schedule.studio_id and cm.version=v_schedule.constraint_model_version;
  if v_model.id is null then return v_base; end if;
  select * into v_planning from public.planning_dataset_versions pd where pd.studio_id=v_schedule.studio_id and pd.version=v_schedule.planning_dataset_version;

  for v_node in select value from jsonb_array_elements(case when jsonb_typeof(v_model.snapshot->'hardConstraints')='array' then v_model.snapshot->'hardConstraints' else '[]'::jsonb end) item(value) loop
    if v_node->>'kind'<>'TEACHER_DAY_WINDOW' then continue; end if;
    select coalesce(jsonb_agg(value order by value),'[]'::jsonb) into v_ids from jsonb_array_elements(case when jsonb_typeof(v_node->'ruleIds')='array' then v_node->'ruleIds' else '[]'::jsonb end) item(value);
    v_teacher_rule_ids:=v_teacher_rule_ids||v_ids;
    if jsonb_typeof(v_node->'ruleIds')<>'array' or jsonb_array_length(v_node->'ruleIds')=0 then v_model_errors:=v_model_errors||jsonb_build_array('Teacher-day ConstraintModel node has an invalid ruleIds array'); end if;
    if jsonb_typeof(v_node->'selector')<>'object' or jsonb_typeof(v_node->'selector'->'teacherIds')<>'array' or jsonb_array_length(v_node->'selector'->'teacherIds')=0 then v_model_errors:=v_model_errors||jsonb_build_array('Teacher-day ConstraintModel node has a malformed teacherIds selector'); continue; end if;
    for v_teacher_id in select value from jsonb_array_elements_text(v_node->'selector'->'teacherIds') item(value) loop
      if not exists(select 1 from jsonb_array_elements(coalesce(v_planning.snapshot->'teacherIds','[]'::jsonb)) item(value) where item.value #>> '{}'=v_teacher_id) and not exists(select 1 from jsonb_array_elements(coalesce(v_planning.snapshot->'teachers','[]'::jsonb)) item(value) where item.value->>'id'=v_teacher_id) then v_model_errors:=v_model_errors||jsonb_build_array('Typed ConstraintModel references a missing PlanningDataset teacher'); end if;
    end loop;
    v_params:=case when jsonb_typeof(v_node->'parameters')='object' then v_node->'parameters' else '{}'::jsonb end;
    if jsonb_typeof(v_node->'parameters')<>'object' then v_model_errors:=v_model_errors||jsonb_build_array('Teacher-day ConstraintModel node has invalid parameters'); continue; end if;
    if v_params ? 'windows' then
      if jsonb_typeof(v_params->'windows')<>'array' or jsonb_array_length(v_params->'windows')=0 then v_model_errors:=v_model_errors||jsonb_build_array('Teacher-day ConstraintModel node has malformed policy windows');
      else
        for v_ids in select value from jsonb_array_elements(v_params->'windows') item(value) loop
          if jsonb_typeof(v_ids)<>'object' or v_ids->>'day' not in ('Monday','Tuesday','Wednesday','Thursday','Friday','Saturday') or v_ids->>'start' !~ '^(?:[01][0-9]|2[0-3]):[0-5][0-9]$' or v_ids->>'end' !~ '^(?:[01][0-9]|2[0-3]):[0-5][0-9]$' or (v_ids->>'start')::time >= (v_ids->>'end')::time then v_model_errors:=v_model_errors||jsonb_build_array('Teacher-day ConstraintModel node has malformed policy windows'); end if;
        end loop;
      end if;
    elsif not (v_params ? 'allowedDays') and not (v_params ? 'day') then
      v_model_errors:=v_model_errors||jsonb_build_array('Teacher-day ConstraintModel node has no allowed day or window');
    end if;
    if v_params ? 'unavailableDays' and jsonb_typeof(v_params->'unavailableDays')<>'array' then v_model_errors:=v_model_errors||jsonb_build_array('Teacher-day ConstraintModel node has malformed unavailableDays'); end if;
  end loop;
  select coalesce(jsonb_agg(distinct value order by value),'[]'::jsonb) into v_teacher_rule_ids from jsonb_array_elements(v_teacher_rule_ids) item(value);

  if jsonb_array_length(coalesce(v_base->'modelErrors','[]'::jsonb))>0 or jsonb_array_length(v_model_errors)>0 then
    return v_base||jsonb_build_object('typedRuleIds',coalesce(v_base->'typedRuleIds','[]'::jsonb)||v_teacher_rule_ids,'modelErrors',coalesce(v_base->'modelErrors','[]'::jsonb)||v_model_errors,'violations','[]'::jsonb);
  end if;

  for v_node in select value from jsonb_array_elements(v_model.snapshot->'hardConstraints') item(value) where value->>'kind'='TEACHER_DAY_WINDOW' loop
    v_params:=v_node->'parameters';
    for v_assignment in select a.id,a.day,a.start_time,a.end_time,a.teacher_id,a.session_id from public.assignments a where a.schedule_version_id=p_schedule_version_id order by a.id loop
      if not (v_node->'selector'->'teacherIds' ? v_assignment.teacher_id) then continue; end if;
      select coalesce((select item.value->>'classId' from jsonb_array_elements(coalesce(v_planning.snapshot->'sessions','[]'::jsonb)) item(value) where item.value->>'id'=v_assignment.session_id limit 1),v_assignment.session_id) into v_class_id;
      v_legal:=true;
      if v_params ? 'unavailableDays' and (v_params->'unavailableDays' ? v_assignment.day) then v_legal:=false; end if;
      if v_legal and v_params ? 'windows' then
        select exists(select 1 from jsonb_array_elements(v_params->'windows') item(value) where item.value->>'day'=v_assignment.day and v_assignment.start_time >= (item.value->>'start')::time and v_assignment.end_time <= (item.value->>'end')::time) into v_has_windows;
        if not v_has_windows then v_legal:=false; end if;
      elsif v_legal and v_params ? 'allowedDays' and not (v_params->'allowedDays' ? v_assignment.day) then v_legal:=false;
      elsif v_legal and v_params ? 'day' and (v_params->>'day') is distinct from v_assignment.day then v_legal:=false;
      elsif v_legal and v_params ? 'day' and v_params ? 'start' and (v_assignment.start_time < (v_params->>'start')::time or v_assignment.end_time > (v_params->>'end')::time) then v_legal:=false;
      end if;
      if not v_legal then
        v_teacher_violations:=v_teacher_violations||jsonb_build_array(jsonb_build_object('constraintId',v_node->>'id','ruleIds',v_node->'ruleIds','severity','HARD','message',v_assignment.teacher_id||' is outside the configured teacher availability for '||v_assignment.day||'.','assignmentIds',jsonb_build_array(v_assignment.id),'affectedEntityIds',jsonb_build_array(v_assignment.teacher_id,v_class_id)));
      end if;
    end loop;
  end loop;
  return v_base||jsonb_build_object('typedRuleIds',coalesce(v_base->'typedRuleIds','[]'::jsonb)||v_teacher_rule_ids,'violations',coalesce(v_base->'violations','[]'::jsonb)||v_teacher_violations,'modelErrors',coalesce(v_base->'modelErrors','[]'::jsonb)||v_model_errors);
end
$function$;
revoke all on function private.validate_typed_schedule_v54(uuid) from public,anon,authenticated;

create or replace function private.teacher_setup_review_fingerprint_v56(
  p_rulebook_snapshot jsonb,
  p_planning_snapshot jsonb,
  p_teacher_id text,
  p_aspect text,
  p_review_schema_version integer default 1
)
returns text
language sql
immutable
security definer
set search_path=''
as $function$
  with availability as (
    select coalesce(jsonb_agg(jsonb_build_object('ruleId',value->>'id','policy',value->'parameters'->'policy') order by value->>'id'),'[]'::jsonb) as policies
    from jsonb_array_elements(coalesce(p_rulebook_snapshot,'[]'::jsonb)) item(value)
    where value->'parameters'->'policy'->>'kind'='TEACHER_DAY_WINDOW'
      and value->'parameters'->'policy'->>'teacherId'=p_teacher_id
  ), qualification as (
    select coalesce(jsonb_agg(jsonb_build_object('ruleId',value->>'id','policy',value->'parameters'->'policy') order by value->>'id'),'[]'::jsonb) as policies
    from jsonb_array_elements(coalesce(p_rulebook_snapshot,'[]'::jsonb)) item(value)
    where value->'parameters'->'policy'->>'kind'='TEACHER_QUALIFICATION'
      and value->'parameters'->'policy'->>'teacherId'=p_teacher_id
  ), operating as (
    select coalesce(jsonb_agg(value->'parameters'->'policy' order by value->>'id'),'[]'::jsonb) as policies
    from jsonb_array_elements(coalesce(p_rulebook_snapshot,'[]'::jsonb)) item(value)
    where value->'parameters'->'policy'->>'kind'='STUDIO_OPERATING_WINDOWS'
  )
  select encode(extensions.digest(pg_catalog.convert_to(jsonb_build_object(
    'scopeKind','TEACHER','entityId',p_teacher_id,'aspect',p_aspect,'reviewSchemaVersion',p_review_schema_version,
    'availabilityPolicies',availability.policies,'qualificationPolicies',qualification.policies,'studioOperatingPolicies',operating.policies,
    'teacherInPlanningDataset',exists(select 1 from jsonb_array_elements_text(coalesce(p_planning_snapshot->'teacherIds','[]'::jsonb)) item(value) where item.value=p_teacher_id)
  )::text,'UTF8'),'sha256'),'hex')
  from availability cross join qualification cross join operating
$function$;
revoke all on function private.teacher_setup_review_fingerprint_v56(jsonb,jsonb,text,text,integer) from public,anon,authenticated;

create or replace function public.list_teacher_setup_review_status_v56(p_studio_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $function$
declare
  v_rulebook public.rulebook_versions%rowtype; v_planning_version integer; v_planning_snapshot jsonb; v_teacher_id text; v_teacher_name text; v_teacher jsonb;
  v_availability_fp text; v_qualification_fp text; v_has_availability boolean; v_has_qualification boolean; v_latest public.setup_review_attestations%rowtype; v_has_latest boolean;
  v_availability_state text; v_qualification_state text; v_availability_history jsonb; v_qualification_history jsonb; v_items jsonb:='[]'::jsonb;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not private.is_studio_member(p_studio_id) then raise exception 'Studio membership required'; end if;
  select * into v_rulebook from public.rulebook_versions where studio_id=p_studio_id and status='CURRENT' limit 1;
  select pd.version,pd.snapshot into v_planning_version,v_planning_snapshot from public.planning_dataset_versions pd where pd.studio_id=p_studio_id and pd.status='CURRENT' order by pd.version desc limit 1;
  if v_rulebook.id is null or v_planning_version is null then raise exception 'Current Rulebook and PlanningDatasetVersion are required'; end if;

  for v_teacher_id,v_teacher_name in
    select ids.value,coalesce(max(teacher.value->>'name'),ids.value)
    from jsonb_array_elements_text(coalesce(v_planning_snapshot->'teacherIds','[]'::jsonb)) ids(value)
    left join lateral jsonb_array_elements(coalesce(v_planning_snapshot->'teachers','[]'::jsonb)) teacher(value) on teacher.value->>'id'=ids.value
    group by ids.value order by coalesce(max(teacher.value->>'name'),ids.value),ids.value
  loop
    v_availability_fp:=private.teacher_setup_review_fingerprint_v56(v_rulebook.snapshot,v_planning_snapshot,v_teacher_id,'availability',1);
    v_qualification_fp:=private.teacher_setup_review_fingerprint_v56(v_rulebook.snapshot,v_planning_snapshot,v_teacher_id,'qualification',1);
    select exists(select 1 from jsonb_array_elements(coalesce(v_rulebook.snapshot,'[]'::jsonb)) item(value) where value->'parameters'->'policy'->>'kind'='TEACHER_DAY_WINDOW' and value->'parameters'->'policy'->>'teacherId'=v_teacher_id) into v_has_availability;
    select exists(select 1 from jsonb_array_elements(coalesce(v_rulebook.snapshot,'[]'::jsonb)) item(value) where value->'parameters'->'policy'->>'kind'='TEACHER_QUALIFICATION' and value->'parameters'->'policy'->>'teacherId'=v_teacher_id) into v_has_qualification;

    select a.* into v_latest from public.setup_review_attestations a where a.studio_id=p_studio_id and a.scope_kind='TEACHER' and a.entity_id=v_teacher_id and a.aspect='availability' and a.review_schema_version=1 order by a.created_at desc,a.id desc limit 1;
    v_has_latest:=found;
    if not v_has_latest then v_availability_state:='NEEDS_REVIEW';
    elsif v_latest.dependency_fingerprint is distinct from v_availability_fp then v_availability_state:='CHANGED_SINCE_REVIEW';
    elsif v_has_availability and v_latest.outcome='REVIEWED_VALUE' then v_availability_state:='REVIEWED_VALUE';
    elsif not v_has_availability and v_latest.outcome='REVIEWED_NO_ADDITIONAL_RESTRICTION' then v_availability_state:='REVIEWED_NO_ADDITIONAL_RESTRICTION';
    else v_availability_state:='CHANGED_SINCE_REVIEW'; end if;
    select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'outcome',a.outcome,'reviewerUserId',a.reviewer_user_id,'reviewerLabel',a.reviewer_label,'sourcePlanningDatasetVersion',a.source_planning_dataset_version,'note',a.note,'createdAt',a.created_at) order by a.created_at desc,a.id desc),'[]'::jsonb) into v_availability_history from public.setup_review_attestations a where a.studio_id=p_studio_id and a.scope_kind='TEACHER' and a.entity_id=v_teacher_id and a.aspect='availability' and a.review_schema_version=1;

    select a.* into v_latest from public.setup_review_attestations a where a.studio_id=p_studio_id and a.scope_kind='TEACHER' and a.entity_id=v_teacher_id and a.aspect='qualification' and a.review_schema_version=1 order by a.created_at desc,a.id desc limit 1;
    v_has_latest:=found;
    if not v_has_qualification then v_qualification_state:='BLOCKED';
    elsif not v_has_latest then v_qualification_state:='NEEDS_REVIEW';
    elsif v_latest.dependency_fingerprint is distinct from v_qualification_fp then v_qualification_state:='CHANGED_SINCE_REVIEW';
    elsif v_latest.outcome='REVIEWED_VALUE' then v_qualification_state:='REVIEWED_VALUE';
    else v_qualification_state:='CHANGED_SINCE_REVIEW'; end if;
    select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'outcome',a.outcome,'reviewerUserId',a.reviewer_user_id,'reviewerLabel',a.reviewer_label,'sourcePlanningDatasetVersion',a.source_planning_dataset_version,'note',a.note,'createdAt',a.created_at) order by a.created_at desc,a.id desc),'[]'::jsonb) into v_qualification_history from public.setup_review_attestations a where a.studio_id=p_studio_id and a.scope_kind='TEACHER' and a.entity_id=v_teacher_id and a.aspect='qualification' and a.review_schema_version=1;

    v_items:=v_items||jsonb_build_array(jsonb_build_object('teacherId',v_teacher_id,'teacherName',v_teacher_name,'availabilityState',v_availability_state,'qualificationState',v_qualification_state,'hasAvailabilityPolicy',v_has_availability,'hasQualificationPolicy',v_has_qualification,'availabilityFingerprint',v_availability_fp,'qualificationFingerprint',v_qualification_fp,'rulebookVersion',v_rulebook.version,'planningDatasetVersion',v_planning_version,'availabilityHistory',v_availability_history,'qualificationHistory',v_qualification_history));
  end loop;
  return v_items;
end
$function$;
revoke all on function public.list_teacher_setup_review_status_v56(uuid) from public,anon;
grant execute on function public.list_teacher_setup_review_status_v56(uuid) to authenticated,service_role;

create or replace function public.attest_teacher_setup_review_v56(
  p_studio_id uuid,p_teacher_id text,p_aspect text,p_expected_rulebook_version integer,p_expected_planning_dataset_version integer,p_expected_fingerprint text,p_outcome text,p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $function$
declare
  v_uid uuid:=auth.uid(); v_role text; v_actor text; v_rulebook public.rulebook_versions%rowtype; v_planning_version integer; v_planning_snapshot jsonb; v_fingerprint text; v_review_id uuid; v_has_policy boolean;
begin
  if v_uid is null then raise exception 'Authentication required'; end if;
  if p_aspect not in ('availability','qualification') then raise exception 'Teacher setup review aspect is invalid'; end if;
  if coalesce(btrim(p_teacher_id),'')='' then raise exception 'Teacher is required'; end if;
  if p_expected_rulebook_version is null or p_expected_planning_dataset_version is null then raise exception 'Expected Rulebook and PlanningDataset versions are required'; end if;
  if coalesce(btrim(p_expected_fingerprint),'')='' then raise exception 'Expected teacher setup fingerprint is required'; end if;
  if p_note is not null and char_length(p_note)>500 then raise exception 'Review note is limited to 500 characters'; end if;
  select m.role into v_role from public.studio_members m where m.studio_id=p_studio_id and m.user_id=v_uid for update;
  if not found or v_role not in ('OWNER','EDITOR') then raise exception using errcode='42501',message='Editor membership required for selected workspace'; end if;
  perform pg_advisory_xact_lock(hashtextextended('typed-setup:'||p_studio_id::text,0));
  select * into v_rulebook from public.rulebook_versions where studio_id=p_studio_id and status='CURRENT' for share;
  select pd.version,pd.snapshot into v_planning_version,v_planning_snapshot from public.planning_dataset_versions pd where pd.studio_id=p_studio_id and pd.status='CURRENT' order by pd.version desc limit 1;
  if v_rulebook.id is null or v_planning_version is null then raise exception 'Current Rulebook and PlanningDatasetVersion are required'; end if;
  if v_rulebook.version<>p_expected_rulebook_version then raise exception 'STALE_TEACHER_SETUP_REVIEW_RULEBOOK: expected %, current %',p_expected_rulebook_version,v_rulebook.version; end if;
  if v_planning_version<>p_expected_planning_dataset_version then raise exception 'STALE_TEACHER_SETUP_REVIEW_VERSION: expected %, current %',p_expected_planning_dataset_version,v_planning_version; end if;
  if not exists(select 1 from jsonb_array_elements_text(coalesce(v_planning_snapshot->'teacherIds','[]'::jsonb)) item(value) where item.value=p_teacher_id) then raise exception 'TEACHER_SETUP_REVIEW_TEACHER_NOT_ACTIVE: teacher is missing or archived in the current Planning Dataset'; end if;
  select exists(select 1 from jsonb_array_elements(coalesce(v_rulebook.snapshot,'[]'::jsonb)) item(value) where value->'parameters'->'policy'->>'kind'=case when p_aspect='availability' then 'TEACHER_DAY_WINDOW' else 'TEACHER_QUALIFICATION' end and value->'parameters'->'policy'->>'teacherId'=p_teacher_id) into v_has_policy;
  if p_aspect='availability' then
    if (v_has_policy and p_outcome<>'REVIEWED_VALUE') or (not v_has_policy and p_outcome<>'REVIEWED_NO_ADDITIONAL_RESTRICTION') then raise exception 'TEACHER_SETUP_REVIEW_OUTCOME_INVALID: choose the outcome matching the current availability policy'; end if;
  elsif not v_has_policy or p_outcome<>'REVIEWED_VALUE' then
    raise exception 'TEACHER_SETUP_REVIEW_OUTCOME_INVALID: qualification requires an explicit class domain and REVIEWED_VALUE';
  end if;
  v_fingerprint:=private.teacher_setup_review_fingerprint_v56(v_rulebook.snapshot,v_planning_snapshot,p_teacher_id,p_aspect,1);
  if lower(p_expected_fingerprint) is distinct from v_fingerprint then raise exception 'STALE_TEACHER_SETUP_REVIEW_FINGERPRINT: teacher setup changed before review commit'; end if;
  select coalesce(p.display_name,u.email,'Studio user') into v_actor from auth.users u left join public.profiles p on p.id=u.id where u.id=v_uid;
  insert into public.setup_review_attestations(studio_id,scope_kind,entity_id,aspect,review_schema_version,dependency_fingerprint,outcome,reviewer_user_id,reviewer_label,source_planning_dataset_version,note) values(p_studio_id,'TEACHER',p_teacher_id,p_aspect,1,v_fingerprint,p_outcome,v_uid,coalesce(v_actor,'Studio user'),v_planning_version,nullif(btrim(coalesce(p_note,'')),'')) returning id into v_review_id;
  insert into public.audit_events(studio_id,actor_user_id,actor_label,action,entity_type,entity_id,detail,payload) values(p_studio_id,v_uid,coalesce(v_actor,'Studio user'),'SETUP_REVIEW_ATTESTED','TEACHER',p_teacher_id,'Reviewed teacher setup',jsonb_build_object('reviewId',v_review_id,'scopeKind','TEACHER','aspect',p_aspect,'reviewSchemaVersion',1,'outcome',p_outcome,'rulebookVersion',v_rulebook.version,'planningDatasetVersion',v_planning_version));
  return jsonb_build_object('status','REVIEWED','reviewId',v_review_id,'teacherId',p_teacher_id,'aspect',p_aspect,'outcome',p_outcome,'currentFingerprint',v_fingerprint,'rulebookVersion',v_rulebook.version,'planningDatasetVersion',v_planning_version);
end
$function$;
revoke all on function public.attest_teacher_setup_review_v56(uuid,text,text,integer,integer,text,text,text) from public,anon;
grant execute on function public.attest_teacher_setup_review_v56(uuid,text,text,integer,integer,text,text,text) to authenticated,service_role;
