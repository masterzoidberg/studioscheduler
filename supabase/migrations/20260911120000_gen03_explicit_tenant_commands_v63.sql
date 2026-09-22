-- GEN-03: every live command receives an explicit studio and verifies the
-- current membership row before delegating to the established command body.
-- The selected studio is transaction-local so nested historical command bodies
-- continue to share one exact authorization context without changing their
-- immutable migration bytes.

create or replace function private.dwde_actor_context()
returns jsonb
language plpgsql
volatile
security definer
set search_path=''
as $function$
declare
  v_uid uuid := auth.uid();
  v_studio uuid;
  v_role text;
  v_actor text;
  v_selected text := nullif(current_setting('app.selected_studio_id', true), '');
  v_membership_count integer;
begin
  if v_uid is null then raise exception 'Authentication required'; end if;

  if v_selected is not null then
    begin
      v_studio := v_selected::uuid;
    exception when invalid_text_representation then
      raise exception 'Invalid selected studio';
    end;
    select m.role into v_role
    from public.studio_members m
    where m.studio_id=v_studio and m.user_id=v_uid;
    if not found then raise exception 'Studio membership required for selected workspace'; end if;
  else
    select count(*)::integer into v_membership_count
    from public.studio_members m
    where m.user_id=v_uid;
    if v_membership_count=0 then raise exception 'Studio membership required'; end if;
    if v_membership_count>1 then raise exception 'Explicit studio selection is required'; end if;
    select m.studio_id,m.role into v_studio,v_role
    from public.studio_members m
    where m.user_id=v_uid;
  end if;

  select coalesce(p.display_name,u.email,'Studio user') into v_actor
  from auth.users u left join public.profiles p on p.id=u.id where u.id=v_uid;
  return jsonb_build_object('user_id',v_uid,'studio_id',v_studio,'role',v_role,'actor',v_actor);
end
$function$;

create or replace function private.require_studio_context_v63(
  p_studio_id uuid,
  p_required_role text default 'MEMBER'
)
returns jsonb
language plpgsql
volatile
security definer
set search_path=''
as $function$
declare
  v_uid uuid := auth.uid();
  v_role text;
  v_actor text;
begin
  if v_uid is null then raise exception 'Authentication required'; end if;
  if p_studio_id is null then raise exception 'Explicit studio selection is required'; end if;

  select m.role into v_role
  from public.studio_members m
  where m.studio_id=p_studio_id and m.user_id=v_uid
  for update;
  if not found then raise exception 'Studio membership required for selected workspace'; end if;
  if p_required_role='OWNER' and v_role<>'OWNER' then raise exception 'Owner membership required'; end if;
  if p_required_role='EDITOR' and v_role not in ('OWNER','EDITOR') then raise exception 'Editor membership required'; end if;

  perform set_config('app.selected_studio_id',p_studio_id::text,true);
  select coalesce(p.display_name,u.email,'Studio user') into v_actor
  from auth.users u left join public.profiles p on p.id=u.id where u.id=v_uid;
  return jsonb_build_object('user_id',v_uid,'studio_id',p_studio_id,'role',v_role,'actor',v_actor);
end
$function$;

create or replace function private.require_actor_studio_context_v63(
  p_studio_id uuid,
  p_actor_user_id uuid,
  p_required_role text default 'MEMBER'
)
returns jsonb
language plpgsql
volatile
security definer
set search_path=''
as $function$
begin
  if p_actor_user_id is null then raise exception 'Actor is required'; end if;
  perform pg_catalog.set_config('request.jwt.claim.sub',p_actor_user_id::text,true);
  return private.require_studio_context_v63(p_studio_id,p_required_role);
end
$function$;

create or replace function public.apply_authoritative_move_v63(
  p_studio_id uuid,p_actor_user_id uuid,p_assignment_id text,p_changes jsonb,p_reason text,
  p_expected_context jsonb,p_application_validation jsonb,p_ai_proposed boolean default false
)
returns jsonb language plpgsql security definer set search_path='' as $function$
begin
  perform private.require_actor_studio_context_v63(p_studio_id,p_actor_user_id,'EDITOR');
  return public.apply_authoritative_move_v46(p_studio_id,p_actor_user_id,p_assignment_id,p_changes,p_reason,p_expected_context,p_application_validation,p_ai_proposed);
end
$function$;

create or replace function public.apply_authoritative_incremental_command_v63(
  p_operation text,p_studio_id uuid,p_actor_user_id uuid,p_assignment_id text,p_session_id text,p_changes jsonb,
  p_reason text,p_expected_context jsonb,p_application_validation jsonb,p_draft_status jsonb,p_ai_proposed boolean default false
)
returns jsonb language plpgsql security definer set search_path='' as $function$
begin
  perform private.require_actor_studio_context_v63(p_studio_id,p_actor_user_id,'EDITOR');
  return public.apply_authoritative_incremental_command_v47(p_operation,p_studio_id,p_actor_user_id,p_assignment_id,p_session_id,p_changes,p_reason,p_expected_context,p_application_validation,p_draft_status,p_ai_proposed);
end
$function$;

create or replace function public.apply_authoritative_schedule_recovery_v63(
  p_operation text,p_studio_id uuid,p_actor_user_id uuid,p_source_schedule_id uuid,p_reason text,p_expected_context jsonb,
  p_candidate jsonb,p_application_validation jsonb,p_draft_status jsonb
)
returns jsonb language plpgsql security definer set search_path='' as $function$
begin
  perform private.require_actor_studio_context_v63(p_studio_id,p_actor_user_id,'EDITOR');
  return public.apply_authoritative_schedule_recovery_v48(p_operation,p_studio_id,p_actor_user_id,p_source_schedule_id,p_reason,p_expected_context,p_candidate,p_application_validation,p_draft_status);
end
$function$;

create or replace function public.publish_server_constraint_model_v63(
  p_studio_id uuid,p_actor_user_id uuid,p_snapshot jsonb,p_reason text,p_expected_rulebook_version integer
)
returns jsonb language plpgsql security definer set search_path='' as $function$
begin
  perform private.require_actor_studio_context_v63(p_studio_id,p_actor_user_id,'EDITOR');
  return public.publish_server_constraint_model_v49(p_studio_id,p_actor_user_id,p_snapshot,p_reason,p_expected_rulebook_version);
end
$function$;

create or replace function public.adopt_solver_candidate_v63(
  p_studio_id uuid,p_actor_user_id uuid,p_actor_label text,p_reason text,p_expected_context jsonb,p_candidate jsonb,p_application_validation jsonb
)
returns jsonb language plpgsql security definer set search_path='' as $function$
begin
  perform private.require_actor_studio_context_v63(p_studio_id,p_actor_user_id,'EDITOR');
  return public.adopt_solver_candidate_v49(p_studio_id,p_actor_user_id,p_actor_label,p_reason,p_expected_context,p_candidate,p_application_validation);
end
$function$;

create or replace function public.apply_authoritative_session_lock_v63(
  p_studio_id uuid,p_actor_user_id uuid,p_actor_label text,p_session_id text,p_locked boolean,p_reason text,p_expected_context jsonb
)
returns jsonb language plpgsql security definer set search_path='' as $function$
begin
  perform private.require_actor_studio_context_v63(p_studio_id,p_actor_user_id,'EDITOR');
  return public.apply_authoritative_session_lock_v61(p_studio_id,p_actor_user_id,p_actor_label,p_session_id,p_locked,p_reason,p_expected_context);
end
$function$;

create or replace function public.convert_reviewed_rulebook_to_tenant_records_v63(
  p_studio_id uuid,p_expected_rulebook_version integer,p_expected_rulebook_source_hash text,p_manifest jsonb,p_reason text
)
returns jsonb language plpgsql security definer set search_path='' as $function$
begin
  perform private.require_studio_context_v63(p_studio_id,'EDITOR');
  return public.convert_reviewed_rulebook_to_tenant_records_v62(p_studio_id,p_expected_rulebook_version,p_expected_rulebook_source_hash,p_manifest,p_reason);
end
$function$;

create or replace function public.apply_rule_patch_v63(
  p_studio_id uuid,p_operation text,p_rule_id text,p_changes jsonb,p_reason text,
  p_expected_rulebook_version integer,p_ai_proposed boolean default false
)
returns jsonb language plpgsql security definer set search_path='' as $function$
begin
  perform private.require_studio_context_v63(p_studio_id,'EDITOR');
  return public.apply_rule_patch_v22(p_operation,p_rule_id,p_changes,p_reason,p_expected_rulebook_version,p_ai_proposed);
end
$function$;

create or replace function public.propose_rule_enforcement_mapping_v63(
  p_studio_id uuid,p_rule_id text,p_mapping jsonb,p_rationale text,
  p_expected_rulebook_version integer,p_expected_enforcement_version integer,p_source text default 'USER'
)
returns jsonb language plpgsql security definer set search_path='' as $function$
begin
  perform private.require_studio_context_v63(p_studio_id,'EDITOR');
  return public.propose_rule_enforcement_mapping_v22(p_rule_id,p_mapping,p_rationale,p_expected_rulebook_version,p_expected_enforcement_version,p_source);
end
$function$;

create or replace function public.review_rule_enforcement_mapping_v63(
  p_studio_id uuid,p_proposal_id uuid,p_decision text,p_reason text,
  p_expected_rulebook_version integer,p_expected_enforcement_version integer
)
returns jsonb language plpgsql security definer set search_path='' as $function$
begin
  perform private.require_studio_context_v63(p_studio_id,'EDITOR');
  return public.review_rule_enforcement_mapping_v22(p_proposal_id,p_decision,p_reason,p_expected_rulebook_version,p_expected_enforcement_version);
end
$function$;

create or replace function public.update_studio_entity_v63(
  p_studio_id uuid,p_entity_type text,p_entity_id text,p_changes jsonb,p_reason text,
  p_expected_rulebook_version integer,p_expected_schedule_version integer
)
returns jsonb language plpgsql security definer set search_path='' as $function$
begin
  perform private.require_studio_context_v63(p_studio_id,'EDITOR');
  return public.update_studio_entity_v21(p_entity_type,p_entity_id,p_changes,p_reason,p_expected_rulebook_version,p_expected_schedule_version);
end
$function$;

create or replace function public.create_scenario_v63(
  p_studio_id uuid,p_name text,p_rule_patches jsonb,p_schedule_patches jsonb,
  p_expected_rulebook_version integer,p_expected_schedule_version integer
)
returns jsonb language plpgsql security definer set search_path='' as $function$
begin
  perform private.require_studio_context_v63(p_studio_id,'EDITOR');
  return public.create_scenario_v21(p_name,p_rule_patches,p_schedule_patches,p_expected_rulebook_version,p_expected_schedule_version);
end
$function$;

create or replace function public.mutate_planning_entity_v63(
  p_studio_id uuid,p_operation text,p_entity_type text,p_entity_id text,p_changes jsonb,p_reason text,
  p_expected_planning_dataset_version integer
)
returns jsonb language plpgsql security definer set search_path='' as $function$
begin
  perform private.require_studio_context_v63(p_studio_id,'EDITOR');
  return public.mutate_planning_entity_v28(p_operation,p_entity_type,p_entity_id,p_changes,p_reason,p_expected_planning_dataset_version);
end
$function$;

create or replace function public.create_reviewed_required_class_v63(
  p_studio_id uuid,p_changes jsonb,p_reason text,p_expected_planning_dataset_version integer,p_evidence jsonb
)
returns jsonb language plpgsql security definer set search_path='' as $function$
begin
  perform private.require_studio_context_v63(p_studio_id,'EDITOR');
  return public.create_reviewed_required_class_v34(p_changes,p_reason,p_expected_planning_dataset_version,p_evidence);
end
$function$;

create or replace function public.apply_rulebook_structure_repair_v63(
  p_studio_id uuid,p_class_id text,p_reason text,p_expected_planning_dataset_version integer
)
returns jsonb language plpgsql security definer set search_path='' as $function$
begin
  perform private.require_studio_context_v63(p_studio_id,'EDITOR');
  return public.apply_rulebook_structure_repair_v36(p_class_id,p_reason,p_expected_planning_dataset_version);
end
$function$;

create or replace function public.apply_rulebook_roster_repair_v63(
  p_studio_id uuid,p_class_id text,p_reason text,p_expected_planning_dataset_version integer
)
returns jsonb language plpgsql security definer set search_path='' as $function$
begin
  perform private.require_studio_context_v63(p_studio_id,'EDITOR');
  return public.apply_rulebook_roster_repair_v36(p_class_id,p_reason,p_expected_planning_dataset_version);
end
$function$;

create or replace function public.update_class_session_durations_v63(
  p_studio_id uuid,p_class_id text,p_session_durations jsonb,p_reason text,p_expected_planning_dataset_version integer
)
returns jsonb language plpgsql security definer set search_path='' as $function$
begin
  perform private.require_studio_context_v63(p_studio_id,'EDITOR');
  return public.update_class_session_durations_v31(p_class_id,p_session_durations,p_reason,p_expected_planning_dataset_version);
end
$function$;

create or replace function public.set_planning_entity_archive_v63(
  p_studio_id uuid,p_entity_type text,p_entity_id text,p_archive boolean,p_reason text,
  p_expected_planning_dataset_version integer
)
returns jsonb language plpgsql security definer set search_path='' as $function$
begin
  perform private.require_studio_context_v63(p_studio_id,'EDITOR');
  return public.set_planning_entity_archive_v40(p_entity_type,p_entity_id,p_archive,p_reason,p_expected_planning_dataset_version);
end
$function$;

create or replace function public.apply_setup_typed_policies_v63(
  p_studio_id uuid,p_policies jsonb,p_reason text,p_expected_rulebook_version integer,
  p_expected_enforcement_version integer,p_expected_planning_dataset_version integer
)
returns jsonb language plpgsql security definer set search_path='' as $function$
begin
  perform private.require_studio_context_v63(p_studio_id,'EDITOR');
  return public.apply_setup_typed_policies_v55(p_policies,p_reason,p_expected_rulebook_version,p_expected_enforcement_version,p_expected_planning_dataset_version);
end
$function$;

create or replace function public.confirm_current_planning_dataset_v63(
  p_studio_id uuid,p_expected_planning_dataset_version integer,p_expected_snapshot_hash text,
  p_expected_rulebook_version integer,p_expected_constraint_model_version integer,
  p_expected_constraint_model_snapshot_hash text,p_expected_review_set_fingerprint text,
  p_expected_review_set_schema_version integer,p_note text,p_evidence jsonb
)
returns jsonb language plpgsql security definer set search_path='' as $function$
begin
  perform private.require_studio_context_v63(p_studio_id,'EDITOR');
  return public.confirm_current_planning_dataset_v60(
    p_expected_planning_dataset_version,p_expected_snapshot_hash,p_expected_rulebook_version,
    p_expected_constraint_model_version,p_expected_constraint_model_snapshot_hash,p_expected_review_set_fingerprint,
    p_expected_review_set_schema_version,p_note,p_evidence
  );
end
$function$;

create or replace function public.list_studio_members_v63(p_studio_id uuid)
returns table(user_id uuid, role text, display_name text, email text, created_at timestamptz)
language plpgsql volatile security definer set search_path='' as $function$
begin
  perform private.require_studio_context_v63(p_studio_id,'MEMBER');
  return query select m.user_id,m.role,m.display_name,m.email,m.created_at from public.list_studio_members_v21() m;
end
$function$;

create or replace function public.invite_studio_member_v63(p_studio_id uuid,p_email text,p_role text)
returns jsonb language plpgsql security definer set search_path='' as $function$
begin
  perform private.require_studio_context_v63(p_studio_id,'OWNER');
  return public.invite_studio_member_v21(p_email,p_role);
end
$function$;

create or replace function public.set_studio_member_role_v63(p_studio_id uuid,p_user_id uuid,p_role text)
returns boolean language plpgsql security definer set search_path='' as $function$
begin
  perform private.require_studio_context_v63(p_studio_id,'OWNER');
  return public.set_studio_member_role_v21(p_user_id,p_role);
end
$function$;

create or replace function public.remove_studio_member_v63(p_studio_id uuid,p_user_id uuid)
returns boolean language plpgsql security definer set search_path='' as $function$
begin
  perform private.require_studio_context_v63(p_studio_id,'OWNER');
  return public.remove_studio_member_v21(p_user_id);
end
$function$;

create or replace function public.cancel_studio_invite_v63(p_studio_id uuid,p_invite_id uuid)
returns boolean language plpgsql security definer set search_path='' as $function$
begin
  perform private.require_studio_context_v63(p_studio_id,'OWNER');
  return public.cancel_studio_invite_v21(p_invite_id);
end
$function$;

create or replace function public.record_ai_proposal_v63(
  p_studio_id uuid,p_proposal_type text,p_request_text text,p_response_text text,p_patch jsonb,p_impact jsonb
)
returns uuid language plpgsql security definer set search_path='' as $function$
begin
  perform private.require_studio_context_v63(p_studio_id,'MEMBER');
  return public.record_ai_proposal_v21(p_proposal_type,p_request_text,p_response_text,p_patch,p_impact);
end
$function$;

revoke all on function private.require_studio_context_v63(uuid,text) from public,anon,authenticated;
revoke all on function private.require_actor_studio_context_v63(uuid,uuid,text) from public,anon,authenticated;

revoke all on function public.apply_authoritative_move_v63(uuid,uuid,text,jsonb,text,jsonb,jsonb,boolean) from public,anon,authenticated;
revoke all on function public.apply_authoritative_incremental_command_v63(text,uuid,uuid,text,text,jsonb,text,jsonb,jsonb,jsonb,boolean) from public,anon,authenticated;
revoke all on function public.apply_authoritative_schedule_recovery_v63(text,uuid,uuid,uuid,text,jsonb,jsonb,jsonb,jsonb) from public,anon,authenticated;
revoke all on function public.publish_server_constraint_model_v63(uuid,uuid,jsonb,text,integer) from public,anon,authenticated;
revoke all on function public.adopt_solver_candidate_v63(uuid,uuid,text,text,jsonb,jsonb,jsonb) from public,anon,authenticated;
revoke all on function public.apply_authoritative_session_lock_v63(uuid,uuid,text,text,boolean,text,jsonb) from public,anon,authenticated;
revoke all on function public.convert_reviewed_rulebook_to_tenant_records_v63(uuid,integer,text,jsonb,text) from public,anon;

revoke all on function public.apply_rule_patch_v63(uuid,text,text,jsonb,text,integer,boolean) from public,anon;
revoke all on function public.propose_rule_enforcement_mapping_v63(uuid,text,jsonb,text,integer,integer,text) from public,anon;
revoke all on function public.review_rule_enforcement_mapping_v63(uuid,uuid,text,text,integer,integer) from public,anon;
revoke all on function public.update_studio_entity_v63(uuid,text,text,jsonb,text,integer,integer) from public,anon;
revoke all on function public.create_scenario_v63(uuid,text,jsonb,jsonb,integer,integer) from public,anon;
revoke all on function public.mutate_planning_entity_v63(uuid,text,text,text,jsonb,text,integer) from public,anon;
revoke all on function public.create_reviewed_required_class_v63(uuid,jsonb,text,integer,jsonb) from public,anon;
revoke all on function public.apply_rulebook_structure_repair_v63(uuid,text,text,integer) from public,anon;
revoke all on function public.apply_rulebook_roster_repair_v63(uuid,text,text,integer) from public,anon;
revoke all on function public.update_class_session_durations_v63(uuid,text,jsonb,text,integer) from public,anon;
revoke all on function public.set_planning_entity_archive_v63(uuid,text,text,boolean,text,integer) from public,anon;
revoke all on function public.apply_setup_typed_policies_v63(uuid,jsonb,text,integer,integer,integer) from public,anon;
revoke all on function public.confirm_current_planning_dataset_v63(uuid,integer,text,integer,integer,text,text,integer,text,jsonb) from public,anon;
revoke all on function public.list_studio_members_v63(uuid) from public,anon;
revoke all on function public.invite_studio_member_v63(uuid,text,text) from public,anon;
revoke all on function public.set_studio_member_role_v63(uuid,uuid,text) from public,anon;
revoke all on function public.remove_studio_member_v63(uuid,uuid) from public,anon;
revoke all on function public.cancel_studio_invite_v63(uuid,uuid) from public,anon;
revoke all on function public.record_ai_proposal_v63(uuid,text,text,text,jsonb,jsonb) from public,anon;

grant execute on function public.apply_rule_patch_v63(uuid,text,text,jsonb,text,integer,boolean) to authenticated,service_role;
grant execute on function public.apply_authoritative_move_v63(uuid,uuid,text,jsonb,text,jsonb,jsonb,boolean) to service_role;
grant execute on function public.apply_authoritative_incremental_command_v63(text,uuid,uuid,text,text,jsonb,text,jsonb,jsonb,jsonb,boolean) to service_role;
grant execute on function public.apply_authoritative_schedule_recovery_v63(text,uuid,uuid,uuid,text,jsonb,jsonb,jsonb,jsonb) to service_role;
grant execute on function public.publish_server_constraint_model_v63(uuid,uuid,jsonb,text,integer) to service_role;
grant execute on function public.adopt_solver_candidate_v63(uuid,uuid,text,text,jsonb,jsonb,jsonb) to service_role;
grant execute on function public.apply_authoritative_session_lock_v63(uuid,uuid,text,text,boolean,text,jsonb) to service_role;
grant execute on function public.convert_reviewed_rulebook_to_tenant_records_v63(uuid,integer,text,jsonb,text) to authenticated,service_role;
grant execute on function public.propose_rule_enforcement_mapping_v63(uuid,text,jsonb,text,integer,integer,text) to authenticated,service_role;
grant execute on function public.review_rule_enforcement_mapping_v63(uuid,uuid,text,text,integer,integer) to authenticated,service_role;
grant execute on function public.update_studio_entity_v63(uuid,text,text,jsonb,text,integer,integer) to authenticated,service_role;
grant execute on function public.create_scenario_v63(uuid,text,jsonb,jsonb,integer,integer) to authenticated,service_role;
grant execute on function public.mutate_planning_entity_v63(uuid,text,text,text,jsonb,text,integer) to authenticated,service_role;
grant execute on function public.create_reviewed_required_class_v63(uuid,jsonb,text,integer,jsonb) to authenticated,service_role;
grant execute on function public.apply_rulebook_structure_repair_v63(uuid,text,text,integer) to authenticated,service_role;
grant execute on function public.apply_rulebook_roster_repair_v63(uuid,text,text,integer) to authenticated,service_role;
grant execute on function public.update_class_session_durations_v63(uuid,text,jsonb,text,integer) to authenticated,service_role;
grant execute on function public.set_planning_entity_archive_v63(uuid,text,text,boolean,text,integer) to authenticated,service_role;
grant execute on function public.apply_setup_typed_policies_v63(uuid,jsonb,text,integer,integer,integer) to authenticated,service_role;
grant execute on function public.confirm_current_planning_dataset_v63(uuid,integer,text,integer,integer,text,text,integer,text,jsonb) to authenticated,service_role;
grant execute on function public.list_studio_members_v63(uuid) to authenticated,service_role;
grant execute on function public.invite_studio_member_v63(uuid,text,text) to authenticated,service_role;
grant execute on function public.set_studio_member_role_v63(uuid,uuid,text) to authenticated,service_role;
grant execute on function public.remove_studio_member_v63(uuid,uuid) to authenticated,service_role;
grant execute on function public.cancel_studio_invite_v63(uuid,uuid) to authenticated,service_role;
grant execute on function public.record_ai_proposal_v63(uuid,text,text,text,jsonb,jsonb) to authenticated,service_role;
