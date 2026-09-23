-- T13 / V4.9 closes superseded canonical write RPC surfaces.
--
-- Historical functions remain in place for migration reproducibility and
-- narrow SECURITY DEFINER delegation from current server-authority wrappers,
-- but application roles may no longer execute them directly.

-- Retire all browser/service-role callable schedule mutation generations.
revoke all on function public.apply_schedule_patch_v21(text,jsonb,text,integer,integer,boolean)
  from public,anon,authenticated,service_role;
revoke all on function public.rebase_current_schedule_v21(integer,integer,text)
  from public,anon,authenticated,service_role;
revoke all on function public.apply_schedule_patch_v22(text,jsonb,text,integer,integer,integer,boolean)
  from public,anon,authenticated,service_role;
revoke all on function public.rebase_current_schedule_v22(integer,integer,integer,text)
  from public,anon,authenticated,service_role;
revoke all on function public.apply_schedule_builder_patch_v23(text,text,text,jsonb,text,integer,integer,integer,boolean)
  from public,anon,authenticated,service_role;
revoke all on function public.undo_last_schedule_change_v23(integer,integer,integer,text)
  from public,anon,authenticated,service_role;
revoke all on function public.apply_schedule_command_v25(text,text,text,jsonb,text,integer,integer,integer,integer,boolean)
  from public,anon,authenticated,service_role;
revoke all on function public.undo_last_schedule_change_v25(integer,integer,integer,integer,text)
  from public,anon,authenticated,service_role;
revoke all on function public.rebase_current_schedule_v25(integer,integer,integer,integer,text)
  from public,anon,authenticated,service_role;

-- V3.0 accepts a caller-supplied Constraint IR artifact. Keep it available
-- only as an implementation primitive behind the deterministic server wrapper.
revoke all on function public.publish_constraint_model_v30(jsonb,text,integer)
  from public,anon,authenticated,service_role;

-- V3.3 and V4.4 remain implementation primitives behind V4.9 adoption.
revoke all on function public.adopt_solver_candidate_v33(
  uuid,uuid,text,text,integer,integer,integer,integer,integer,jsonb,jsonb
) from public,anon,authenticated,service_role;
revoke all on function public.adopt_solver_candidate_v44(uuid,uuid,text,text,jsonb,jsonb,jsonb)
  from public,anon,authenticated,service_role;

create or replace function public.publish_server_constraint_model_v49(
  p_studio_id uuid,
  p_actor_user_id uuid,
  p_snapshot jsonb,
  p_reason text,
  p_expected_rulebook_version integer
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $function$
declare
  v_selected_role text;
  v_actor_context jsonb;
  v_result jsonb;
begin
  if p_studio_id is null then raise exception 'Studio is required'; end if;
  if p_actor_user_id is null then raise exception 'Actor is required'; end if;
  if coalesce(btrim(p_reason),'')='' then raise exception 'Reason is required'; end if;

  select m.role into v_selected_role
  from public.studio_members m
  where m.studio_id=p_studio_id and m.user_id=p_actor_user_id;
  if v_selected_role not in ('OWNER','EDITOR') then
    raise exception 'Editor membership required for selected workspace';
  end if;

  -- V3.0 still derives its studio/actor from auth.uid(). Until T22/T23
  -- remove that compatibility assumption, make the selected studio explicit
  -- and reject any mismatch instead of silently publishing for another tenant.
  perform pg_catalog.set_config('request.jwt.claim.sub',p_actor_user_id::text,true);
  v_actor_context:=private.assert_editor_context();
  if (v_actor_context->>'studio_id')::uuid is distinct from p_studio_id then
    raise exception 'WORKSPACE_SELECTION_MISMATCH: selected %, legacy active %',
      p_studio_id,v_actor_context->>'studio_id';
  end if;

  v_result:=public.publish_constraint_model_v30(
    p_snapshot,p_reason,p_expected_rulebook_version
  );

  update public.audit_events
  set payload=coalesce(payload,'{}'::jsonb) || jsonb_build_object(
    'authority','SERVER_CONSTRAINT_COMPILER_V49',
    'serverDerivedConstraintModel',true,
    'actorRoleRechecked',v_selected_role
  )
  where studio_id=p_studio_id
    and action='CONSTRAINT_MODEL_PUBLISHED'
    and (payload->>'constraintModelVersion')::integer=(v_result->>'constraintModelVersion')::integer;

  return v_result || jsonb_build_object(
    'authority','SERVER_CONSTRAINT_COMPILER_V49',
    'serverDerivedConstraintModel',true
  );
end
$function$;

revoke all on function public.publish_server_constraint_model_v49(uuid,uuid,jsonb,text,integer)
  from public,anon,authenticated;
grant execute on function public.publish_server_constraint_model_v49(uuid,uuid,jsonb,text,integer)
  to service_role;

create or replace function public.adopt_solver_candidate_v49(
  p_studio_id uuid,
  p_actor_user_id uuid,
  p_actor_label text,
  p_reason text,
  p_expected_context jsonb,
  p_candidate jsonb,
  p_application_validation jsonb
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $function$
declare
  v_selected_role text;
  v_result jsonb;
begin
  if p_studio_id is null then raise exception 'Studio is required'; end if;
  if p_actor_user_id is null then raise exception 'Actor is required'; end if;

  -- The service key is transport authority, not human authorization.
  -- Recheck the submitted actor at commit time so revoked/downgraded users
  -- cannot adopt with a request authorized earlier in the route lifecycle.
  select m.role into v_selected_role
  from public.studio_members m
  where m.studio_id=p_studio_id and m.user_id=p_actor_user_id;
  if v_selected_role not in ('OWNER','EDITOR') then
    raise exception 'Editor membership required for selected workspace';
  end if;

  v_result:=public.adopt_solver_candidate_v44(
    p_studio_id,p_actor_user_id,p_actor_label,p_reason,
    p_expected_context,p_candidate,p_application_validation
  );
  return v_result || jsonb_build_object(
    'authority','SERVER_CONSTRAINT_IR_V49',
    'actorRoleRechecked',true
  );
end
$function$;

revoke all on function public.adopt_solver_candidate_v49(uuid,uuid,text,text,jsonb,jsonb,jsonb)
  from public,anon,authenticated;
grant execute on function public.adopt_solver_candidate_v49(uuid,uuid,text,text,jsonb,jsonb,jsonb)
  to service_role;
