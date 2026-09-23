-- M01-T01: provide a complete owner-scoped workspace data export.

create or replace function public.export_studio_data_v72(p_studio_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path=''
as $function$
declare
  v_studio jsonb;
  v_members jsonb;
  v_invites jsonb;
  v_data jsonb:='{}'::jsonb;
  v_rows jsonb;
  v_table_name text;
  v_tenant_tables constant text[]:=array[
    'teachers','rooms','students','cohorts','class_definitions','class_sessions',
    'rules','rulebook_versions','rule_history','rule_enforcement_versions',
    'rule_enforcement_proposals','planning_dataset_versions',
    'planning_source_manifest_versions','constraint_model_versions',
    'schedule_versions','assignments','scenarios','ai_proposals','audit_events',
    'entity_versions','setup_review_attestations','studio_creation_requests',
    'planning_import_batches','solver_candidate_reviews','setup_assignments'
  ];
begin
  if p_studio_id is null then
    raise exception using errcode='22023',message='Explicit studio selection is required';
  end if;

  -- This row lock makes authorization current through the export transaction.
  perform private.require_studio_context_v63(p_studio_id,'OWNER');

  select to_jsonb(s) into v_studio
  from public.studios s
  where s.id=p_studio_id;

  select coalesce(
    jsonb_agg(jsonb_build_object(
      'userId',m.user_id,
      'role',m.role,
      'createdAt',m.created_at,
      'email',u.email,
      'displayName',p.display_name
    ) order by m.created_at,m.user_id),
    '[]'::jsonb
  ) into v_members
  from public.studio_members m
  join auth.users u on u.id=m.user_id
  left join public.profiles p on p.id=m.user_id
  where m.studio_id=p_studio_id;

  select coalesce(jsonb_agg(to_jsonb(i) order by i.created_at,i.id),'[]'::jsonb)
  into v_invites
  from public.studio_invites i
  where i.studio_id=p_studio_id;

  -- Keep this explicit table allowlist tenant-scoped. Account credentials,
  -- Auth tokens, and global service logs are deliberately outside workspace export.
  foreach v_table_name in array v_tenant_tables loop
    execute pg_catalog.format(
      'select coalesce(jsonb_agg(to_jsonb(t)),''[]''::jsonb) from public.%I t where t.studio_id=$1',
      v_table_name
    ) into v_rows using p_studio_id;
    v_data:=v_data || jsonb_build_object(v_table_name,v_rows);
  end loop;

  return jsonb_build_object(
    'format','studio-scheduler/workspace-v1',
    'exportedAt',pg_catalog.clock_timestamp(),
    'studio',v_studio,
    'members',v_members,
    'invitations',v_invites,
    'data',v_data
  );
end
$function$;

revoke all on function public.export_studio_data_v72(uuid) from public,anon;
grant execute on function public.export_studio_data_v72(uuid) to authenticated,service_role;
