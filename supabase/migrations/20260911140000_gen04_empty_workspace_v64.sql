-- GEN-04: atomically provision an empty tenant with one owner and empty
-- canonical authorities. The request id is the idempotency boundary; neither
-- studio slugs nor names participate in version authority.

create table if not exists public.studio_creation_requests (
  request_id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  studio_id uuid not null references public.studios(id) on delete cascade,
  studio_name text not null,
  studio_slug text not null,
  created_at timestamptz not null default now(),
  unique (studio_id)
);

alter table public.studio_creation_requests enable row level security;
revoke all on table public.studio_creation_requests from public, anon, authenticated;
grant all on table public.studio_creation_requests to service_role;

create or replace function public.create_studio_v64(
  p_request_id uuid,
  p_name text,
  p_slug text default null
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $function$
declare
  v_uid uuid := auth.uid();
  v_existing public.studio_creation_requests%rowtype;
  v_studio_id uuid;
  v_name text := btrim(coalesce(p_name,''));
  v_slug text := lower(btrim(coalesce(p_slug,'')));
  v_actor text;
  v_snapshot jsonb := '[]'::jsonb;
  v_snapshot_hash text;
  v_planning_version integer;
begin
  if v_uid is null then
    raise exception using errcode='42501', message='STUDIO_CREATION_AUTH_REQUIRED';
  end if;

  if p_request_id is null then
    raise exception using errcode='22023', message='STUDIO_CREATION_REQUEST_ID_REQUIRED';
  end if;

  -- Serialize retries for the same request before checking or creating any
  -- tenant row. A retry after an uncertain response returns the original
  -- immutable tenant reference instead of creating a second workspace.
  perform pg_advisory_xact_lock(
    pg_catalog.hashtextextended('studio-create:' || p_request_id::text, 0)
  );

  select * into v_existing
  from public.studio_creation_requests
  where request_id=p_request_id
  for update;

  if v_existing.request_id is not null then
    if v_existing.user_id<>v_uid then
      raise exception using errcode='42501', message='STUDIO_CREATION_REQUEST_FORBIDDEN';
    end if;

    return jsonb_build_object(
      'status','ALREADY_CREATED',
      'studioId',v_existing.studio_id,
      'name',v_existing.studio_name,
      'slug',v_existing.studio_slug,
      'role','OWNER',
      'rulebookVersion',1,
      'enforcementVersion',1,
      'planningDatasetVersion',1,
      'authority','EMPTY_WORKSPACE_PROVISIONING_V64'
    );
  end if;

  if length(v_name)<1 or length(v_name)>120 then
    raise exception using errcode='22023', message='STUDIO_CREATION_NAME_INVALID';
  end if;

  if v_slug='' then
    v_slug:=pg_catalog.regexp_replace(v_name,'[^a-zA-Z0-9]+','-','g');
    v_slug:=lower(pg_catalog.regexp_replace(v_slug,'(^-+|-+$)','','g'));
  end if;

  if length(v_slug)<1 or length(v_slug)>63 or v_slug !~ '^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$' then
    raise exception using errcode='22023', message='STUDIO_CREATION_SLUG_INVALID';
  end if;

  v_studio_id:=extensions.gen_random_uuid();
  begin
    insert into public.studios(id,slug,name)
    values(v_studio_id,v_slug,v_name);
  exception when unique_violation then
    raise exception using errcode='23505', message='STUDIO_CREATION_SLUG_TAKEN';
  end;

  insert into public.studio_members(studio_id,user_id,role)
  values(v_studio_id,v_uid,'OWNER');

  select coalesce(p.display_name,u.email,'Studio owner') into v_actor
  from auth.users u
  left join public.profiles p on p.id=u.id
  where u.id=v_uid;
  v_actor:=coalesce(nullif(btrim(v_actor),''),'Studio owner');

  v_snapshot_hash:=encode(
    extensions.digest(pg_catalog.convert_to(v_snapshot::text,'UTF8'),'sha256'),
    'hex'
  );

  insert into public.rulebook_versions(
    studio_id,version,name,actor_user_id,actor_label,reason,changed_rule_ids,
    snapshot,rulebook_id,status,source_hash,rule_count,format_version,
    document_type,source_metadata
  ) values(
    v_studio_id,1,'Initial empty rulebook',v_uid,v_actor,
    'Initial empty workspace provisioning','{}',v_snapshot,
    'initial-empty-rulebook','CURRENT',v_snapshot_hash,0,'1.0',
    'STUDIO_RULEBOOK',jsonb_build_object(
      'provisioning','EMPTY_WORKSPACE',
      'seeded',false,
      'authority','EMPTY_WORKSPACE_PROVISIONING_V64'
    )
  );

  insert into public.rule_enforcement_versions(
    studio_id,version,rulebook_version,actor_user_id,actor_label,reason,
    changed_rule_ids,snapshot,status
  ) values(
    v_studio_id,1,1,v_uid,v_actor,'Initial empty workspace provisioning',
    '{}',v_snapshot,'CURRENT'
  );

  v_planning_version:=private.ensure_planning_dataset_version_v25(
    v_studio_id,v_uid,v_actor,'Initial empty workspace provisioning'
  );
  if v_planning_version<>1 then
    raise exception using errcode='P0001', message='STUDIO_CREATION_PLANNING_AUTHORITY_INVALID';
  end if;

  insert into public.studio_creation_requests(
    request_id,user_id,studio_id,studio_name,studio_slug
  ) values(
    p_request_id,v_uid,v_studio_id,v_name,v_slug
  );

  insert into public.audit_events(
    studio_id,actor_user_id,actor_label,action,entity_type,entity_id,detail,payload
  ) values(
    v_studio_id,v_uid,v_actor,'STUDIO_CREATED','STUDIO',v_studio_id::text,
    'Empty workspace provisioned',jsonb_build_object(
      'requestId',p_request_id,
      'role','OWNER',
      'rulebookVersion',1,
      'enforcementVersion',1,
      'planningDatasetVersion',v_planning_version,
      'seededRules',0,
      'seededPeople',0,
      'authority','EMPTY_WORKSPACE_PROVISIONING_V64'
    )
  );

  return jsonb_build_object(
    'status','CREATED',
    'studioId',v_studio_id,
    'name',v_name,
    'slug',v_slug,
    'role','OWNER',
    'rulebookVersion',1,
    'enforcementVersion',1,
    'planningDatasetVersion',v_planning_version,
    'authority','EMPTY_WORKSPACE_PROVISIONING_V64'
  );
end
$function$;

revoke all on function public.create_studio_v64(uuid,text,text) from public, anon;
grant execute on function public.create_studio_v64(uuid,text,text) to authenticated, service_role;
