-- Compatibility bridge while the production V2.1 frontend is still live.
-- V2.1 callers do not send EnforcementVersion, so bind the scenario to the enforcement policy
-- attached to the current schedule and reject creation if that policy is stale.

create or replace function public.create_scenario_v21(
  p_name text,
  p_rule_patches jsonb,
  p_schedule_patches jsonb,
  p_expected_rulebook_version integer,
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
  v_rb integer;
  v_ev integer;
  v_sv integer;
  v_schedule_ev integer;
  v_id uuid;
begin
  if coalesce(btrim(p_name),'')='' then raise exception 'Scenario name is required'; end if;
  select version into v_rb from public.rulebook_versions where studio_id=v_studio and status='CURRENT';
  select version into v_ev from public.rule_enforcement_versions where studio_id=v_studio and status='CURRENT';
  select version,enforcement_version into v_sv,v_schedule_ev from public.schedule_versions where studio_id=v_studio and is_current;
  if v_rb<>p_expected_rulebook_version then raise exception 'STALE_RULEBOOK'; end if;
  if v_sv<>p_expected_schedule_version then raise exception 'STALE_SCHEDULE'; end if;
  if v_schedule_ev<>v_ev then raise exception 'STALE_ENFORCEMENT: revalidate the current schedule before creating a scenario'; end if;

  insert into public.scenarios(
    studio_id,name,base_rulebook_version,base_enforcement_version,base_schedule_version,
    rule_patches,schedule_patches,created_by
  ) values(
    v_studio,p_name,v_rb,v_ev,v_sv,coalesce(p_rule_patches,'[]'::jsonb),coalesce(p_schedule_patches,'[]'::jsonb),v_uid
  ) returning id into v_id;

  return jsonb_build_object('id',v_id,'baseRulebookVersion',v_rb,'baseEnforcementVersion',v_ev,'baseScheduleVersion',v_sv);
end
$function$;

revoke all on function public.create_scenario_v21(text,jsonb,jsonb,integer,integer) from public,anon;
grant execute on function public.create_scenario_v21(text,jsonb,jsonb,integer,integer) to authenticated,service_role;
