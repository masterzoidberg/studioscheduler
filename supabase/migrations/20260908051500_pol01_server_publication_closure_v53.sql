-- POL-01 / V5.3 preserves the V4.9 server-authority publication boundary.
--
-- V5.2 strengthens the historical V3.0 publication primitive because current
-- server publication still delegates to it. Replacing a SECURITY DEFINER body
-- resets neither ownership nor intent, but V5.2's compatibility grant would have
-- reopened direct service-role execution that T13 deliberately retired. Close
-- that primitive again and keep V4 publication behind the selected-workspace
-- server wrapper. Also serialize the wrapper's human membership check so it has
-- the same commit-time revocation behavior as SAFE-01 adoption.

revoke all on function public.publish_constraint_model_v30(jsonb,text,integer)
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

  -- The service key is transport authority, not human authorization. Lock the
  -- selected membership for the transaction so publication serializes with a
  -- concurrent role downgrade/removal and never treats a missing row as NULL
  -- permission state.
  select m.role into v_selected_role
  from public.studio_members m
  where m.studio_id=p_studio_id and m.user_id=p_actor_user_id
  for update;
  if not found or v_selected_role not in ('OWNER','EDITOR') then
    raise exception using errcode = '42501', message = 'Editor membership required for selected workspace';
  end if;

  -- The V3.0 primitive still derives studio/actor from auth.uid(). Keep the
  -- compatibility bridge explicit and reject any mismatch before publication.
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
    'actorRoleRechecked',v_selected_role,
    'membershipSerialized',true
  )
  where studio_id=p_studio_id
    and action='CONSTRAINT_MODEL_PUBLISHED'
    and (payload->>'constraintModelVersion')::integer=(v_result->>'constraintModelVersion')::integer;

  return v_result || jsonb_build_object(
    'authority','SERVER_CONSTRAINT_COMPILER_V49',
    'serverDerivedConstraintModel',true,
    'membershipSerialized',true
  );
end
$function$;

revoke all on function public.publish_server_constraint_model_v49(uuid,uuid,jsonb,text,integer)
  from public,anon,authenticated;
grant execute on function public.publish_server_constraint_model_v49(uuid,uuid,jsonb,text,integer)
  to service_role;
