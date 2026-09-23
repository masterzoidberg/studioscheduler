import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { assertDisposableTarget, DatabaseHarnessError } from './test-db.mjs';
import { setupSql } from './test-set03-db.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const image = 'postgres@sha256:ef257d85f76e48da1c64832459b59fcaba1a4dac97bf5d7450c77753542eee94';
const migrationPath = path.join(repoRoot, 'supabase', 'migrations', '20260911140000_gen04_empty_workspace_v64.sql');
const calendarMigrationPath = path.join(repoRoot, 'supabase', 'migrations', '20260911150000_gen04_sunday_calendar_v65.sql');
const setupMigrationPath = path.join(repoRoot, 'supabase', 'migrations', '20260911160000_gen04_empty_workspace_setup_v66.sql');
const planningMigrationPath = path.join(repoRoot, 'supabase', 'migrations', '20260902080544_planning_dataset_versions_v25.sql');
const typedSetupMigrationPath = path.join(repoRoot, 'supabase', 'migrations', '20260909100000_set03_typed_setup_policies_v55.sql');
const owner = '10000000-0000-4000-8000-000000000001';
const viewer = '10000000-0000-4000-8000-000000000003';
const requestId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const secondRequestId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

function run(command, args, input) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    input,
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 32 * 1024 * 1024,
  });
  if (result.error) throw new DatabaseHarnessError(result.error.message);
  return result;
}

function output(result) {
  return [result.stdout, result.stderr].filter(Boolean).join('\n').trim();
}

function docker(args, input) {
  const result = run('docker', args, input);
  if (result.status !== 0) throw new DatabaseHarnessError(output(result));
  return result;
}

function psql(container, sql, label) {
  const result = run('docker', ['exec', '-i', container, 'psql', '-X', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', 'postgres'], sql);
  if (result.status !== 0) throw new DatabaseHarnessError(`${label}:\n${output(result)}`);
  return result.stdout;
}

const contextAndFixtureExpansion = String.raw`
alter table public.studios add column slug text;
update public.studios set slug=case when id='11111111-1111-4111-8111-111111111111' then 'set03' else 'other' end where slug is null;
alter table public.studios alter column slug set not null;
create unique index studios_slug_uq_gen04_test on public.studios(slug);

alter table public.planning_dataset_versions add column actor_user_id uuid;
alter table public.planning_dataset_versions add column actor_label text;
alter table public.planning_dataset_versions add column reason text;
alter table public.planning_dataset_versions add column snapshot_hash text;
update public.planning_dataset_versions
set actor_label='GEN-04 fixture', reason='GEN-04 fixture',
    snapshot_hash=encode(extensions.digest(pg_catalog.convert_to(snapshot::text,'UTF8'),'sha256'),'hex')
where snapshot_hash is null;

create table public.rooms(
  id text not null, studio_id uuid not null, name text not null,
  capacity integer, features text[] not null default '{}', primary key(studio_id,id)
);
create table public.students(
  id text not null, studio_id uuid not null, name text not null default 'Student',
  level text not null, cohort_ids text[] not null default '{}', primary key(studio_id,id)
);
create table public.cohorts(
  id text not null, studio_id uuid not null, name text not null default 'Cohort',
  student_ids text[] not null default '{}', primary key(studio_id,id)
);
create table public.class_definitions(
  id text not null, studio_id uuid not null, name text not null default 'Class',
  subject text not null, level text not null, duration_minutes integer not null,
  weekly_frequency integer not null default 1, roster_student_ids text[] not null default '{}',
  company_only boolean not null default false, primary key(studio_id,id)
);
create table public.class_sessions(
  id text not null, studio_id uuid not null, class_id text not null,
  ordinal integer not null default 1, locked boolean not null default false,
  primary key(studio_id,id)
);
create table public.assignments(day text);
create table public.schedule_versions(
  id uuid primary key default extensions.gen_random_uuid(), studio_id uuid not null,
  version integer not null, rulebook_version integer not null,
  actor_user_id uuid, actor_label text, planning_dataset_version integer,
  is_current boolean not null default false
);
create table public.scenarios(
  id uuid primary key default extensions.gen_random_uuid(), studio_id uuid not null,
  base_rulebook_version integer not null, base_schedule_version integer not null,
  created_by uuid, base_planning_dataset_version integer
);

create or replace function private.dwde_actor_context()
returns jsonb language plpgsql stable security definer set search_path=''
as $function$
declare v_uid uuid:=auth.uid(); v_studio uuid; v_role text;
begin
  select m.studio_id,m.role into v_studio,v_role
  from public.studio_members m where m.user_id=v_uid order by m.studio_id limit 1;
  return jsonb_build_object('user_id',v_uid,'studio_id',v_studio,'role',v_role,'actor','GEN-04 fixture');
end
$function$;

create or replace function private.canonical_tenant_typed_policy_value_v62(p_value jsonb,p_field text)
returns jsonb language plpgsql immutable security definer set search_path='' as $function$
begin
  return case when p_field='day' then case p_value #>> '{}' when 'Friday' then '5'::jsonb when 'Saturday' then '6'::jsonb else '99'::jsonb end else p_value end;
end
$function$;

grant select on public.studios,public.studio_members,public.teachers,public.rooms,
  public.students,public.cohorts,public.class_definitions,public.class_sessions,
  public.rules,public.rulebook_versions,public.rule_enforcement_versions,
  public.audit_events,public.planning_dataset_versions to authenticated;
grant update on public.studios to authenticated;
`;

const authenticatedReadGrants = String.raw`
grant select on public.studio_creation_requests to authenticated;
`;

const regression = String.raw`
set search_path=public,extensions;
set role authenticated;
select set_config('request.jwt.claim.sub','${owner}',false);
do $block$
declare
  v_created jsonb;
  v_retry jsonb;
  v_setup jsonb;
  v_studio uuid;
  v_rulebook_id uuid;
  v_enforcement_id uuid;
  v_planning_id uuid;
  v_before jsonb;
  v_after jsonb;
  v_rejected boolean;
begin
  v_created:=public.create_studio_v64('${requestId}','Second Studio','second-studio');
  if v_created->>'status'<>'CREATED' or v_created->>'role'<>'OWNER' then
    raise exception 'initial provisioning result is incorrect: %',v_created;
  end if;
  v_studio:=(v_created->>'studioId')::uuid;

  if (select count(*) from public.studios where id=v_studio)<>1 then raise exception 'studio was not created'; end if;
  if (select count(*) from public.studio_members where studio_id=v_studio)<>1
     or (select role from public.studio_members where studio_id=v_studio and user_id='${owner}')<>'OWNER' then
    raise exception 'owner membership is not unambiguous';
  end if;
  if exists(select 1 from public.teachers where studio_id=v_studio)
     or exists(select 1 from public.rooms where studio_id=v_studio)
     or exists(select 1 from public.rules where studio_id=v_studio)
     or exists(select 1 from public.rulebook_versions where studio_id=v_studio and snapshot<>'[]'::jsonb)
     or exists(select 1 from public.rule_enforcement_versions where studio_id=v_studio and snapshot<>'[]'::jsonb) then
    raise exception 'empty workspace received seeded data';
  end if;
  if (select count(*) from public.rulebook_versions where studio_id=v_studio and status='CURRENT')<>1
     or (select version from public.rulebook_versions where studio_id=v_studio and status='CURRENT')<>1 then
    raise exception 'empty Rulebook authority is missing';
  end if;
  if (select count(*) from public.rule_enforcement_versions where studio_id=v_studio and status='CURRENT')<>1
     or (select version from public.rule_enforcement_versions where studio_id=v_studio and status='CURRENT')<>1 then
    raise exception 'empty Enforcement authority is missing';
  end if;
  if (select count(*) from public.planning_dataset_versions where studio_id=v_studio and status='CURRENT')<>1
     or (select version from public.planning_dataset_versions where studio_id=v_studio and status='CURRENT')<>1 then
    raise exception 'empty PlanningDataset authority is missing';
  end if;

  v_before:=jsonb_build_object(
    'studios',(select count(*) from public.studios),
    'requests',(select count(*) from public.studio_creation_requests),
    'members',(select count(*) from public.studio_members),
    'rulebooks',(select count(*) from public.rulebook_versions),
    'enforcement',(select count(*) from public.rule_enforcement_versions),
    'planning',(select count(*) from public.planning_dataset_versions),
    'audits',(select count(*) from public.audit_events)
  );
  v_retry:=public.create_studio_v64('${requestId}','Changed name must be ignored','changed-slug');
  v_after:=jsonb_build_object(
    'studios',(select count(*) from public.studios),
    'requests',(select count(*) from public.studio_creation_requests),
    'members',(select count(*) from public.studio_members),
    'rulebooks',(select count(*) from public.rulebook_versions),
    'enforcement',(select count(*) from public.rule_enforcement_versions),
    'planning',(select count(*) from public.planning_dataset_versions),
    'audits',(select count(*) from public.audit_events)
  );
  if v_retry->>'status'<>'ALREADY_CREATED' or (v_retry->>'studioId')::uuid<>v_studio or v_before<>v_after then
    raise exception 'idempotent retry changed authority or did not return original studio: % / % / %',v_retry,v_before,v_after;
  end if;

  select id into v_rulebook_id from public.rulebook_versions where studio_id=v_studio and status='CURRENT';
  select id into v_enforcement_id from public.rule_enforcement_versions where studio_id=v_studio and status='CURRENT';
  select id into v_planning_id from public.planning_dataset_versions where studio_id=v_studio and status='CURRENT';
  update public.studios set name='Renamed Independent Studio',slug='renamed-independent-studio' where id=v_studio;
  if (select id from public.rulebook_versions where studio_id=v_studio and status='CURRENT')<>v_rulebook_id
     or (select id from public.rule_enforcement_versions where studio_id=v_studio and status='CURRENT')<>v_enforcement_id
     or (select id from public.planning_dataset_versions where studio_id=v_studio and status='CURRENT')<>v_planning_id then
    raise exception 'tenant rename changed canonical authority';
  end if;

  v_setup:=public.apply_empty_workspace_setup_policies_v66(
    v_studio,
    '[{"ruleId":"OPS-001","policy":{"schemaVersion":"1.0","kind":"STUDIO_OPERATING_WINDOWS","windows":[{"day":"Sunday","start":"09:00","end":"15:00"}],"closedDays":[]}}]'::jsonb,
    'Configure independent Sunday hours',1,1,1
  );
  if v_setup->>'status'<>'APPLIED' or v_setup->>'rulebookVersion'<>'2' or v_setup->>'enforcementVersion'<>'2' then
    raise exception 'empty workspace setup did not create the generic Rulebook successor: %',v_setup;
  end if;
  if (select count(*) from public.rules where studio_id=v_studio)<>1
     or (select parameters#>>'{policy,kind}' from public.rules where studio_id=v_studio and id='OPS-001')<>'STUDIO_OPERATING_WINDOWS'
     or not exists(select 1 from public.rules where studio_id=v_studio and id='OPS-001' and parameters#>>'{policy,windows,0,day}'='Sunday') then
    raise exception 'Sunday operating policy was not persisted as the submitted tenant rule';
  end if;
  if (select source_metadata->>'provisioning' from public.rulebook_versions where studio_id=v_studio and status='CURRENT')<>'EMPTY_WORKSPACE'
     or (select source_metadata->>'authority' from public.rulebook_versions where studio_id=v_studio and status='CURRENT')<>'GENERIC_SETUP_POLICY_V66' then
    raise exception 'generic empty-workspace authority metadata is missing';
  end if;

  v_before:=jsonb_build_object(
    'rules',(select count(*) from public.rules where studio_id=v_studio),
    'rulebooks',(select count(*) from public.rulebook_versions where studio_id=v_studio),
    'enforcement',(select count(*) from public.rule_enforcement_versions where studio_id=v_studio),
    'audits',(select count(*) from public.audit_events where studio_id=v_studio)
  );
  v_rejected:=false;
  begin
    perform public.apply_empty_workspace_setup_policies_v66(
      v_studio,
      '[{"ruleId":"DWDE-001","policy":{"schemaVersion":"1.0","kind":"STUDIO_OPERATING_WINDOWS","windows":[{"day":"Sunday","start":"09:00","end":"10:00"}]}}]'::jsonb,
      'Unsupported owner',2,2,1
    );
  exception when others then
    if position('EMPTY_WORKSPACE_SETUP_OWNER_UNSUPPORTED' in sqlerrm)=0 then raise; end if;
    v_rejected:=true;
  end;
  if not v_rejected then raise exception 'unsupported DWDE owner was accepted by the neutral path'; end if;
  if v_before<>jsonb_build_object(
    'rules',(select count(*) from public.rules where studio_id=v_studio),
    'rulebooks',(select count(*) from public.rulebook_versions where studio_id=v_studio),
    'enforcement',(select count(*) from public.rule_enforcement_versions where studio_id=v_studio),
    'audits',(select count(*) from public.audit_events where studio_id=v_studio)
  ) then raise exception 'rejected neutral setup wrote canonical state'; end if;

  v_rejected:=false;
  begin
    perform public.apply_empty_workspace_setup_policies_v66(
      v_studio,
      '[{"ruleId":"OPS-001","policy":{"schemaVersion":"1.0","kind":"STUDIO_OPERATING_WINDOWS","windows":[{"day":"Sunday","start":"09:00","end":"10:00"}],"closedDays":["Sunday"]}}]'::jsonb,
      'Conflicting Sunday hours',2,2,1
    );
  exception when others then
    if position('SETUP_TYPED_POLICY_WINDOW_CLOSED_DAY_CONFLICT' in sqlerrm)=0 then raise; end if;
    v_rejected:=true;
  end;
  if not v_rejected then raise exception 'closed Sunday conflict was accepted'; end if;
  if v_before<>jsonb_build_object(
    'rules',(select count(*) from public.rules where studio_id=v_studio),
    'rulebooks',(select count(*) from public.rulebook_versions where studio_id=v_studio),
    'enforcement',(select count(*) from public.rule_enforcement_versions where studio_id=v_studio),
    'audits',(select count(*) from public.audit_events where studio_id=v_studio)
  ) then raise exception 'invalid Sunday setup wrote canonical state'; end if;

  v_before:=jsonb_build_object('studios',(select count(*) from public.studios),'requests',(select count(*) from public.studio_creation_requests),'members',(select count(*) from public.studio_members),'rulebooks',(select count(*) from public.rulebook_versions),'enforcement',(select count(*) from public.rule_enforcement_versions),'planning',(select count(*) from public.planning_dataset_versions),'audits',(select count(*) from public.audit_events));
  v_rejected:=false;
  begin perform public.create_studio_v64(null,'Invalid request','invalid'); exception when others then if position('STUDIO_CREATION_REQUEST_ID_REQUIRED' in sqlerrm)=0 then raise; end if; v_rejected:=true; end;
  if not v_rejected then raise exception 'null request was accepted'; end if;
  if v_before<>jsonb_build_object('studios',(select count(*) from public.studios),'requests',(select count(*) from public.studio_creation_requests),'members',(select count(*) from public.studio_members),'rulebooks',(select count(*) from public.rulebook_versions),'enforcement',(select count(*) from public.rule_enforcement_versions),'planning',(select count(*) from public.planning_dataset_versions),'audits',(select count(*) from public.audit_events)) then raise exception 'invalid request wrote state'; end if;

  v_rejected:=false;
  begin perform public.create_studio_v64('${secondRequestId}','   ','bad'); exception when others then if position('STUDIO_CREATION_NAME_INVALID' in sqlerrm)=0 then raise; end if; v_rejected:=true; end;
  if not v_rejected then raise exception 'invalid name was accepted'; end if;

  perform set_config('request.jwt.claim.sub','${viewer}',false);
  v_rejected:=false;
  begin perform public.create_studio_v64('${requestId}','Cross-user retry','cross-user'); exception when insufficient_privilege then if position('STUDIO_CREATION_REQUEST_FORBIDDEN' in sqlerrm)=0 then raise; end if; v_rejected:=true; end;
  if not v_rejected then raise exception 'cross-user retry was accepted'; end if;
end
$block$;

select 'GEN-04 DB PASS: atomic provisioning, neutral Sunday setup, idempotent retry, owner role, canonical authorities, rename stability and rejection no-write' as result;
`;

export async function main(argv = process.argv.slice(2)) {
  const target = argv.find((arg) => arg.startsWith('--target='))?.slice('--target='.length);
  if (target) process.env.STUDIO_SCHEDULER_TEST_DB_TARGET = target;
  assertDisposableTarget(process.env);
  if (!argv.includes('--allow-disposable') && process.env.STUDIO_SCHEDULER_TEST_DB_ALLOW_DISPOSABLE !== '1') {
    throw new DatabaseHarnessError('Refusing to run without disposable opt-in.');
  }

  const container = `studio-scheduler-gen04-${process.pid}`;
  let running = false;
  try {
    docker(['run','--detach','--rm','--name',container,'-e','POSTGRES_HOST_AUTH_METHOD=trust',image,'postgres']);
    running = true;
    for (let attempt = 0; attempt < 45; attempt += 1) {
      const ready = run('docker',['exec',container,'pg_isready','-U','postgres','-d','postgres']);
      if (ready.status === 0) break;
      if (attempt === 44) throw new DatabaseHarnessError('GEN-04 PostgreSQL did not become ready.');
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    psql(container, setupSql, 'GEN-04 base fixture');
    psql(container, contextAndFixtureExpansion, 'GEN-04 fixture expansion');
    psql(container, readFileSync(planningMigrationPath, 'utf8'), 'GEN-04 PlanningDataset prerequisite');
    psql(container, readFileSync(typedSetupMigrationPath, 'utf8'), 'GEN-04 typed setup prerequisite');
    psql(container, readFileSync(migrationPath, 'utf8'), 'GEN-04 migration');
    psql(container, readFileSync(calendarMigrationPath, 'utf8'), 'GEN-04 Sunday calendar migration');
    psql(container, readFileSync(setupMigrationPath, 'utf8'), 'GEN-04 empty workspace setup migration');
    psql(container, authenticatedReadGrants, 'GEN-04 authenticated assertion grants');
    process.stdout.write(psql(container, regression, 'GEN-04 regression'));
  } finally {
    if (running) run('docker',['rm','--force',container]);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
