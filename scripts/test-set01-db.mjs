import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { assertDisposableTarget, DatabaseHarnessError } from './test-db.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const postgresImage = 'postgres@sha256:ef257d85f76e48da1c64832459b59fcaba1a4dac97bf5d7450c77753542eee94';
const migrationPath = path.join(repoRoot, 'supabase', 'migrations', '20260908035000_set01_room_capacity_review_v51.sql');

function outputFor(result) {
  return [result.stdout, result.stderr].filter(Boolean).join('\n').trim();
}

function runProcess(command, args, input) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: 'utf8',
    input,
    maxBuffer: 16 * 1024 * 1024,
    windowsHide: true,
  });
  if (result.error) throw new DatabaseHarnessError(`${command} could not be started: ${result.error.message}`);
  return result;
}

function docker(args, input) {
  const result = runProcess('docker', args, input);
  if (result.status !== 0) throw new DatabaseHarnessError(`docker ${args[0] ?? 'command'} failed:\n${outputFor(result)}`);
  return result;
}

function psql(container, sql, label, extraArgs = []) {
  const result = docker([
    'exec', '-i', container,
    'psql', '-X', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', 'postgres',
    ...extraArgs,
  ], sql);
  if (result.status !== 0) throw new DatabaseHarnessError(`${label}: ${outputFor(result)}`);
  return result.stdout;
}

async function waitForPostgres(container) {
  for (let attempt = 0; attempt < 45; attempt += 1) {
    const result = runProcess('docker', ['exec', container, 'pg_isready', '-U', 'postgres', '-d', 'postgres']);
    if (result.status === 0) return;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new DatabaseHarnessError('SET-01 PostgreSQL did not become ready within 45 seconds.');
}

const setupSql = String.raw`
create role anon nologin;
create role authenticated nologin;
create role service_role nologin;
create schema auth;
create schema private;
create schema extensions;
create extension pgcrypto with schema extensions;

create table auth.users(id uuid primary key,email text not null unique);
create table public.profiles(id uuid primary key references auth.users(id),display_name text);
create table public.studios(id uuid primary key,name text not null);
create table public.studio_members(
  studio_id uuid not null references public.studios(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check(role in ('OWNER','EDITOR','VIEWER')),
  primary key(studio_id,user_id)
);
create table public.planning_dataset_versions(
  id uuid primary key default extensions.gen_random_uuid(),
  studio_id uuid not null references public.studios(id) on delete cascade,
  version integer not null,
  snapshot jsonb not null,
  status text not null check(status in ('CURRENT','HISTORICAL')),
  created_at timestamptz not null default now(),
  unique(studio_id,version)
);
create table public.audit_events(
  id uuid primary key default extensions.gen_random_uuid(),
  studio_id uuid not null references public.studios(id) on delete cascade,
  actor_user_id uuid references auth.users(id),
  actor_label text,
  action text not null,
  entity_type text not null,
  entity_id text,
  detail text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create or replace function auth.uid()
returns uuid language sql stable security definer set search_path=''
as $function$
  select nullif(pg_catalog.current_setting('request.jwt.claim.sub',true),'')::uuid
$function$;

create or replace function private.is_studio_member(p_studio_id uuid)
returns boolean language sql stable security definer set search_path=''
as $function$
  select exists(
    select 1 from public.studio_members m
    where m.studio_id=p_studio_id and m.user_id=auth.uid()
  )
$function$;

insert into public.studios(id,name) values
  ('11111111-1111-4111-8111-111111111111','SET-01 Studio'),
  ('22222222-2222-4222-8222-222222222222','Other Studio');
insert into auth.users(id,email) values
  ('10000000-0000-4000-8000-000000000001','owner@example.test'),
  ('10000000-0000-4000-8000-000000000002','editor@example.test'),
  ('10000000-0000-4000-8000-000000000003','viewer@example.test'),
  ('10000000-0000-4000-8000-000000000004','nonmember@example.test');
insert into public.profiles(id,display_name) values
  ('10000000-0000-4000-8000-000000000001','SET Owner'),
  ('10000000-0000-4000-8000-000000000002','SET Editor'),
  ('10000000-0000-4000-8000-000000000003','SET Viewer'),
  ('10000000-0000-4000-8000-000000000004','SET Nonmember');
insert into public.studio_members(studio_id,user_id,role) values
  ('11111111-1111-4111-8111-111111111111','10000000-0000-4000-8000-000000000001','OWNER'),
  ('11111111-1111-4111-8111-111111111111','10000000-0000-4000-8000-000000000002','EDITOR'),
  ('11111111-1111-4111-8111-111111111111','10000000-0000-4000-8000-000000000003','VIEWER');

insert into public.planning_dataset_versions(studio_id,version,snapshot,status) values
(
  '11111111-1111-4111-8111-111111111111',1,
  '{"schemaVersion":"1.3","studioId":"11111111-1111-4111-8111-111111111111","teacherIds":[],"teachers":[],"rooms":[{"id":"room-a","name":"Room A","capacity":20,"features":[]},{"id":"room-b","name":"Room B","capacity":15,"features":[]},{"id":"room-missing","name":"Room Missing","capacity":null,"features":[]}],"students":[],"cohorts":[],"classes":[],"sessions":[]}'::jsonb,
  'CURRENT'
),
(
  '22222222-2222-4222-8222-222222222222',1,
  '{"schemaVersion":"1.3","studioId":"22222222-2222-4222-8222-222222222222","teacherIds":[],"teachers":[],"rooms":[{"id":"other-room","name":"Other Room","capacity":30,"features":[]}],"students":[],"cohorts":[],"classes":[],"sessions":[]}'::jsonb,
  'CURRENT'
);
`;

const regressionSql = String.raw`
set client_min_messages=notice;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',false);

-- Initial states: known values need review; missing capacity is derived MISSING.
do $block$
declare v jsonb;
begin
  v:=public.list_room_capacity_review_status_v51('11111111-1111-4111-8111-111111111111');
  if (select x->>'state' from jsonb_array_elements(v) x where x->>'roomId'='room-a')<>'NEEDS_REVIEW' then
    raise exception 'SET-01 room-a should begin NEEDS_REVIEW: %',v;
  end if;
  if (select x->>'state' from jsonb_array_elements(v) x where x->>'roomId'='room-missing')<>'MISSING' then
    raise exception 'SET-01 missing capacity should derive MISSING: %',v;
  end if;
end
$block$;

-- OWNER reviews both real capacities.
do $block$
declare v jsonb; fp_a text; fp_b text;
begin
  v:=public.list_room_capacity_review_status_v51('11111111-1111-4111-8111-111111111111');
  select x->>'currentFingerprint' into fp_a from jsonb_array_elements(v) x where x->>'roomId'='room-a';
  select x->>'currentFingerprint' into fp_b from jsonb_array_elements(v) x where x->>'roomId'='room-b';
  perform public.attest_room_capacity_review_v51('11111111-1111-4111-8111-111111111111','room-a',1,fp_a,'REVIEWED_VALUE','owner review');
  perform public.attest_room_capacity_review_v51('11111111-1111-4111-8111-111111111111','room-b',1,fp_b,'REVIEWED_VALUE',null);
  v:=public.list_room_capacity_review_status_v51('11111111-1111-4111-8111-111111111111');
  if (select x->>'state' from jsonb_array_elements(v) x where x->>'roomId'='room-a')<>'REVIEWED' then raise exception 'room-a review did not become REVIEWED: %',v; end if;
  if (select x->>'state' from jsonb_array_elements(v) x where x->>'roomId'='room-b')<>'REVIEWED' then raise exception 'room-b review did not become REVIEWED: %',v; end if;
end
$block$;

-- Unrelated planning change advances the version but leaves room-capacity slices identical.
update public.planning_dataset_versions set status='HISTORICAL' where studio_id='11111111-1111-4111-8111-111111111111' and status='CURRENT';
insert into public.planning_dataset_versions(studio_id,version,snapshot,status)
select studio_id,2,snapshot || '{"teachers":[{"id":"teacher-x","name":"Teacher X"}],"teacherIds":["teacher-x"]}'::jsonb,'CURRENT'
from public.planning_dataset_versions where studio_id='11111111-1111-4111-8111-111111111111' and version=1;
do $block$ declare v jsonb; begin
  v:=public.list_room_capacity_review_status_v51('11111111-1111-4111-8111-111111111111');
  if (select x->>'state' from jsonb_array_elements(v) x where x->>'roomId'='room-a')<>'REVIEWED' then raise exception 'unrelated planning change invalidated room-a: %',v; end if;
  if (select x->>'state' from jsonb_array_elements(v) x where x->>'roomId'='room-b')<>'REVIEWED' then raise exception 'unrelated planning change invalidated room-b: %',v; end if;
end $block$;

-- Change only room-a capacity. room-a must stale; room-b must remain reviewed.
update public.planning_dataset_versions set status='HISTORICAL' where studio_id='11111111-1111-4111-8111-111111111111' and status='CURRENT';
insert into public.planning_dataset_versions(studio_id,version,snapshot,status)
select studio_id,3,jsonb_set(snapshot,'{rooms,0,capacity}','25'::jsonb,false),'CURRENT'
from public.planning_dataset_versions where studio_id='11111111-1111-4111-8111-111111111111' and version=2;
do $block$ declare v jsonb; begin
  v:=public.list_room_capacity_review_status_v51('11111111-1111-4111-8111-111111111111');
  if (select x->>'state' from jsonb_array_elements(v) x where x->>'roomId'='room-a')<>'CHANGED_SINCE_REVIEW' then raise exception 'capacity change did not stale room-a: %',v; end if;
  if (select x->>'state' from jsonb_array_elements(v) x where x->>'roomId'='room-b')<>'REVIEWED' then raise exception 'room-a capacity change invalidated room-b: %',v; end if;
end $block$;

-- Returning to the old value must not revive the old attestation.
update public.planning_dataset_versions set status='HISTORICAL' where studio_id='11111111-1111-4111-8111-111111111111' and status='CURRENT';
insert into public.planning_dataset_versions(studio_id,version,snapshot,status)
select studio_id,4,jsonb_set(snapshot,'{rooms,0,capacity}','20'::jsonb,false),'CURRENT'
from public.planning_dataset_versions where studio_id='11111111-1111-4111-8111-111111111111' and version=3;
do $block$ declare v jsonb; begin
  v:=public.list_room_capacity_review_status_v51('11111111-1111-4111-8111-111111111111');
  if (select x->>'state' from jsonb_array_elements(v) x where x->>'roomId'='room-a')<>'CHANGED_SINCE_REVIEW' then raise exception 'old value silently revived old review: %',v; end if;
end $block$;

-- Rejections must not append either review evidence or success audit rows.
do $block$
declare before_reviews integer; before_audits integer; v jsonb; fp text; rejected boolean;
begin
  select count(*) into before_reviews from public.setup_review_attestations;
  select count(*) into before_audits from public.audit_events where action='SETUP_REVIEW_ATTESTED';
  v:=public.list_room_capacity_review_status_v51('11111111-1111-4111-8111-111111111111');
  select x->>'currentFingerprint' into fp from jsonb_array_elements(v) x where x->>'roomId'='room-a';

  rejected:=false;
  begin
    perform public.attest_room_capacity_review_v51('11111111-1111-4111-8111-111111111111','room-a',3,fp,'REVIEWED_VALUE',null);
  exception when others then
    if position('STALE_ROOM_CAPACITY_REVIEW_VERSION' in sqlerrm)=0 then raise; end if;
    rejected:=true;
  end;
  if not rejected then raise exception 'stale planning version was accepted'; end if;

  rejected:=false;
  begin
    perform public.attest_room_capacity_review_v51('11111111-1111-4111-8111-111111111111','room-a',4,repeat('0',64),'REVIEWED_VALUE',null);
  exception when others then
    if position('STALE_ROOM_CAPACITY_REVIEW_FINGERPRINT' in sqlerrm)=0 then raise; end if;
    rejected:=true;
  end;
  if not rejected then raise exception 'stale fingerprint was accepted'; end if;

  rejected:=false;
  begin
    select x->>'currentFingerprint' into fp from jsonb_array_elements(v) x where x->>'roomId'='room-missing';
    perform public.attest_room_capacity_review_v51('11111111-1111-4111-8111-111111111111','room-missing',4,fp,'REVIEWED_VALUE',null);
  exception when others then
    if position('ROOM_CAPACITY_REVIEW_MISSING' in sqlerrm)=0 then raise; end if;
    rejected:=true;
  end;
  if not rejected then raise exception 'missing capacity was attested'; end if;

  rejected:=false;
  begin
    perform public.attest_room_capacity_review_v51('11111111-1111-4111-8111-111111111111','room-a',4,fp,'REVIEWED_NO_ADDITIONAL_RESTRICTION',null);
  exception when others then
    if position('ROOM_CAPACITY_REVIEW_OUTCOME_INVALID' in sqlerrm)=0 then raise; end if;
    rejected:=true;
  end;
  if not rejected then raise exception 'capacity was waived as no restriction'; end if;

  rejected:=false;
  begin
    perform public.attest_room_capacity_review_v51('11111111-1111-4111-8111-111111111111','new-room',4,repeat('1',64),'REVIEWED_VALUE',null);
  exception when others then
    if position('ROOM_CAPACITY_REVIEW_ROOM_NOT_ACTIVE' in sqlerrm)=0 then raise; end if;
    rejected:=true;
  end;
  if not rejected then raise exception 'nonexistent/new room misuse was accepted'; end if;

  if (select count(*) from public.setup_review_attestations)<>before_reviews
     or (select count(*) from public.audit_events where action='SETUP_REVIEW_ATTESTED')<>before_audits then
    raise exception 'rejected room-capacity review wrote review or success audit state';
  end if;
end
$block$;

-- VIEWER and cross-tenant actor reject before any write.
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000003',false);
do $block$ declare rejected boolean:=false; begin
  begin
    perform public.attest_room_capacity_review_v51('11111111-1111-4111-8111-111111111111','room-a',4,repeat('0',64),'REVIEWED_VALUE',null);
  exception when insufficient_privilege then rejected:=true; end;
  if not rejected then raise exception 'VIEWER room review was accepted'; end if;
end $block$;

select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',false);
do $block$ declare rejected boolean:=false; begin
  begin
    perform public.attest_room_capacity_review_v51('22222222-2222-4222-8222-222222222222','other-room',1,repeat('0',64),'REVIEWED_VALUE',null);
  exception when insufficient_privilege then rejected:=true; end;
  if not rejected then raise exception 'cross-tenant room review was accepted'; end if;
end $block$;

-- Archive room-a by removing it from a new current canonical snapshot. Active
-- review listing drops it, but historical review evidence remains readable.
update public.planning_dataset_versions set status='HISTORICAL' where studio_id='11111111-1111-4111-8111-111111111111' and status='CURRENT';
insert into public.planning_dataset_versions(studio_id,version,snapshot,status)
select studio_id,5,jsonb_set(snapshot,'{rooms}',(
  select coalesce(jsonb_agg(x),'[]'::jsonb) from jsonb_array_elements(snapshot->'rooms') x where x->>'id'<>'room-a'
),false),'CURRENT'
from public.planning_dataset_versions where studio_id='11111111-1111-4111-8111-111111111111' and version=4;
do $block$ declare v jsonb; history jsonb; rejected boolean:=false; begin
  v:=public.list_room_capacity_review_status_v51('11111111-1111-4111-8111-111111111111');
  if exists(select 1 from jsonb_array_elements(v) x where x->>'roomId'='room-a') then raise exception 'archived room remained an active review obligation'; end if;
  history:=public.list_setup_review_history_v51('11111111-1111-4111-8111-111111111111','ROOM','room-a','capacity');
  if jsonb_array_length(history)<1 then raise exception 'archived room review history became unreadable'; end if;
  begin
    perform public.attest_room_capacity_review_v51('11111111-1111-4111-8111-111111111111','room-a',5,repeat('0',64),'REVIEWED_VALUE',null);
  exception when others then
    if position('ROOM_CAPACITY_REVIEW_ROOM_NOT_ACTIVE' in sqlerrm)=0 then raise; end if;
    rejected:=true;
  end;
  if not rejected then raise exception 'archived room accepted review'; end if;
end $block$;

-- Restore the room at the same original value: the prior review remains stale.
update public.planning_dataset_versions set status='HISTORICAL' where studio_id='11111111-1111-4111-8111-111111111111' and status='CURRENT';
insert into public.planning_dataset_versions(studio_id,version,snapshot,status)
select studio_id,6,jsonb_set(snapshot,'{rooms}',(snapshot->'rooms') || '[{"id":"room-a","name":"Room A","capacity":20,"features":[]}]'::jsonb,false),'CURRENT'
from public.planning_dataset_versions where studio_id='11111111-1111-4111-8111-111111111111' and version=5;
do $block$ declare v jsonb; begin
  v:=public.list_room_capacity_review_status_v51('11111111-1111-4111-8111-111111111111');
  if (select x->>'state' from jsonb_array_elements(v) x where x->>'roomId'='room-a')<>'CHANGED_SINCE_REVIEW' then raise exception 'restored room silently revived historical review: %',v; end if;
end $block$;

-- EDITOR may create a fresh review for the restored current slice.
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000002',false);
do $block$ declare v jsonb; fp text; begin
  v:=public.list_room_capacity_review_status_v51('11111111-1111-4111-8111-111111111111');
  select x->>'currentFingerprint' into fp from jsonb_array_elements(v) x where x->>'roomId'='room-a';
  perform public.attest_room_capacity_review_v51('11111111-1111-4111-8111-111111111111','room-a',6,fp,'REVIEWED_VALUE','editor re-review');
  v:=public.list_room_capacity_review_status_v51('11111111-1111-4111-8111-111111111111');
  if (select x->>'state' from jsonb_array_elements(v) x where x->>'roomId'='room-a')<>'REVIEWED' then raise exception 'fresh editor review did not restore REVIEWED state: %',v; end if;
end $block$;

select 'SET-01 DB PASS' as result;
`;

async function main() {
  const args = process.argv.slice(2);
  const allowDisposable = args.includes('--allow-disposable') || process.env.STUDIO_SCHEDULER_TEST_DB_ALLOW_DISPOSABLE === '1';
  const targetArg = args.find((argument) => argument.startsWith('--target='));
  const targetEnvironment = { ...process.env };
  if (targetArg) targetEnvironment.STUDIO_SCHEDULER_TEST_DB_TARGET = targetArg.slice('--target='.length);
  assertDisposableTarget(targetEnvironment);
  if (!allowDisposable) throw new DatabaseHarnessError('SET-01 refuses to run without --allow-disposable.');

  const dockerVersion = runProcess('docker', ['version', '--format', '{{.Server.Version}}']);
  if (dockerVersion.status !== 0) {
    throw new DatabaseHarnessError(`Docker daemon unavailable for SET-01 regression. Start Docker Desktop and retry.\n${outputFor(dockerVersion)}`);
  }

  const container = `studio-scheduler-set01-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
  let running = false;
  try {
    docker(['run','--detach','--rm','--name',container,'--env','POSTGRES_PASSWORD=set01-disposable-only',postgresImage]);
    running = true;
    await waitForPostgres(container);
    psql(container, setupSql, 'SET-01 minimal fixture');
    psql(container, readFileSync(migrationPath, 'utf8'), 'SET-01 migration under test');
    process.stdout.write(psql(container, regressionSql, 'SET-01 review regression'));
  } finally {
    if (running) runProcess('docker', ['rm','--force',container]);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
