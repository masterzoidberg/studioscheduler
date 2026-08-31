-- V2.2 scenarios are reproducible against RulebookVersion + EnforcementVersion + ScheduleVersion.

alter table public.scenarios
  add column if not exists base_enforcement_version integer;

update public.scenarios s
set base_enforcement_version = coalesce(
  (select sv.enforcement_version from public.schedule_versions sv where sv.studio_id=s.studio_id and sv.version=s.base_schedule_version limit 1),
  (select ev.version from public.rule_enforcement_versions ev where ev.studio_id=s.studio_id and ev.status='CURRENT' limit 1),
  1
)
where s.base_enforcement_version is null;

alter table public.scenarios
  alter column base_enforcement_version set not null;

do $block$
begin
  if not exists(select 1 from pg_constraint where conname='scenarios_base_enforcement_version_fkey') then
    alter table public.scenarios
      add constraint scenarios_base_enforcement_version_fkey
      foreign key(studio_id,base_enforcement_version)
      references public.rule_enforcement_versions(studio_id,version);
  end if;
end $block$;

create or replace function public.create_scenario_v22(
  p_name text,
  p_rule_patches jsonb,
  p_schedule_patches jsonb,
  p_expected_rulebook_version integer,
  p_expected_enforcement_version integer,
  p_expected_schedule_version integer
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $function$
declare
  ctx jsonb:=private.assert_editor_context();
  v_studio uuid:=(ctx->>'studio_id')::uuid;
  v_uid uuid:=(ctx->>'user_id')::uuid;
  v_actor text:=ctx->>'actor';
  v_rb integer;
  v_ev integer;
  v_sv integer;
  v_id uuid;
begin
  if coalesce(btrim(p_name),'')='' then raise exception 'Scenario name is required'; end if;
  select version into v_rb from public.rulebook_versions where studio_id=v_studio and status='CURRENT';
  select version into v_ev from public.rule_enforcement_versions where studio_id=v_studio and status='CURRENT';
  select version into v_sv from public.schedule_versions where studio_id=v_studio and is_current;
  if v_rb<>p_expected_rulebook_version then raise exception 'STALE_RULEBOOK'; end if;
  if v_ev<>p_expected_enforcement_version then raise exception 'STALE_ENFORCEMENT'; end if;
  if v_sv<>p_expected_schedule_version then raise exception 'STALE_SCHEDULE'; end if;

  insert into public.scenarios(
    studio_id,name,base_rulebook_version,base_enforcement_version,base_schedule_version,
    rule_patches,schedule_patches,created_by
  ) values(
    v_studio,p_name,v_rb,v_ev,v_sv,coalesce(p_rule_patches,'[]'::jsonb),coalesce(p_schedule_patches,'[]'::jsonb),v_uid
  ) returning id into v_id;

  insert into public.audit_events(studio_id,actor_user_id,actor_label,action,entity_type,entity_id,detail,payload)
  values(v_studio,v_uid,v_actor,'SCENARIO_CREATE','SCENARIO',v_id::text,'Created isolated what-if scenario',
    jsonb_build_object('name',p_name,'rulebookVersion',v_rb,'enforcementVersion',v_ev,'scheduleVersion',v_sv));

  return jsonb_build_object('id',v_id,'baseRulebookVersion',v_rb,'baseEnforcementVersion',v_ev,'baseScheduleVersion',v_sv);
end
$function$;

revoke all on function public.create_scenario_v22(text,jsonb,jsonb,integer,integer,integer) from public,anon;
grant execute on function public.create_scenario_v22(text,jsonb,jsonb,integer,integer,integer) to authenticated,service_role;
