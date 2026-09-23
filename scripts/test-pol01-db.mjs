import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { assertDisposableTarget, DatabaseHarnessError } from './test-db.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const postgresImage = 'postgres@sha256:ef257d85f76e48da1c64832459b59fcaba1a4dac97bf5d7450c77753542eee94';
const migrationV52 = path.join(repoRoot, 'supabase', 'migrations', '20260908050000_pol01_typed_policy_v52.sql');
const migrationV53 = path.join(repoRoot, 'supabase', 'migrations', '20260908051500_pol01_server_publication_closure_v53.sql');

function outputFor(result) {
  return [result.stdout, result.stderr].filter(Boolean).join('\n').trim();
}

function runProcess(command, args, input) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: 'utf8',
    input,
    maxBuffer: 32 * 1024 * 1024,
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

function psql(container, sql, label) {
  const result = runProcess('docker', [
    'exec', '-i', container,
    'psql', '-X', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', 'postgres',
  ], sql);
  if (result.status !== 0) throw new DatabaseHarnessError(`${label}:\n${outputFor(result)}`);
  return result.stdout;
}

async function waitForPostgres(container) {
  for (let attempt = 0; attempt < 45; attempt += 1) {
    const result = runProcess('docker', ['exec', container, 'pg_isready', '-U', 'postgres', '-d', 'postgres']);
    if (result.status === 0) return;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new DatabaseHarnessError('POL-01 PostgreSQL did not become ready within 45 seconds.');
}

// This fixture intentionally starts on a NON-canonical V3 marker so the real
// V5.2 data-cutover DO block skips it. The repository does not contain the private
// canonical 178-rule V3 snapshot, and this test must never reach production data.
// After V5.2/V5.3 are installed, the fixture constructs a deidentified historical
// V3 + current V4 pair with the accepted canonical V3 marker solely to exercise
// the V4 guard/publication semantics against disposable data. Current V4 hash is
// always recomputed from live rows by the production function.
const setupSql = String.raw`
create role anon nologin;
create role authenticated nologin;
create role service_role nologin;
create schema private;
create schema extensions;
create extension pgcrypto with schema extensions;

create table public.studios(id uuid primary key,name text not null);
create table public.studio_members(
  studio_id uuid not null,
  user_id uuid not null,
  role text not null,
  primary key(studio_id,user_id)
);
create table public.teachers(
  id text not null,
  studio_id uuid not null,
  name text not null,
  archived_at timestamptz,
  primary key(studio_id,id)
);
create table public.rules(
  studio_id uuid not null,
  id text not null,
  category text not null default 'test',
  type text,
  title text not null,
  description text not null,
  strength text,
  classification_raw text not null default 'HARD',
  status text not null default 'ACTIVE',
  verification_status text not null default 'VERIFIED',
  review_status text not null default 'VERIFIED',
  review jsonb not null default '{"decision":"APPROVED","verified":true}'::jsonb,
  affected_entity_ids text[] not null default '{}'::text[],
  parameters jsonb not null default '{}'::jsonb,
  exceptions jsonb not null default '[]'::jsonb,
  source jsonb not null default '{"type":"IMPORT"}'::jsonb,
  source_raw jsonb not null default '{"type":"DWDE_RULEBOOK_REVIEW"}'::jsonb,
  enforcement_status text not null default 'NOT_IMPLEMENTED',
  version_introduced integer not null default 2,
  updated_at timestamptz not null default '2026-09-02T00:00:00Z',
  primary key(studio_id,id)
);
create table public.rulebook_versions(
  id uuid primary key default extensions.gen_random_uuid(),
  studio_id uuid not null,
  version integer not null,
  name text not null,
  actor_user_id uuid,
  actor_label text,
  reason text,
  changed_rule_ids text[] not null default '{}'::text[],
  snapshot jsonb not null,
  rulebook_id text,
  status text not null,
  imported_at timestamptz,
  source_hash text,
  source_file_hash text,
  rule_count integer,
  parent_version integer,
  format_version text,
  document_type text,
  source_metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique(studio_id,version)
);
create table public.rule_history(
  id uuid primary key default extensions.gen_random_uuid(),
  studio_id uuid not null,
  rule_id text not null,
  rulebook_version integer not null,
  actor_user_id uuid,
  actor_label text,
  reason text,
  before_rule jsonb,
  after_rule jsonb,
  ai_proposed boolean not null default false,
  created_at timestamptz not null default now()
);
create table public.rule_enforcement_versions(
  id uuid primary key default extensions.gen_random_uuid(),
  studio_id uuid not null,
  version integer not null,
  rulebook_version integer not null,
  actor_user_id uuid,
  actor_label text,
  reason text,
  changed_rule_ids text[] not null default '{}'::text[],
  snapshot jsonb not null default '[]'::jsonb,
  status text not null,
  created_at timestamptz not null default now(),
  unique(studio_id,version)
);
create table public.rule_enforcement_proposals(
  id uuid primary key default extensions.gen_random_uuid(),
  studio_id uuid not null,
  base_rulebook_version integer not null,
  status text not null,
  review_reason text,
  updated_at timestamptz not null default now()
);
create table public.constraint_model_versions(
  id uuid primary key default extensions.gen_random_uuid(),
  studio_id uuid not null,
  version integer not null,
  rulebook_version integer not null,
  compiler_version text not null,
  actor_user_id uuid,
  actor_label text,
  reason text,
  snapshot jsonb not null,
  snapshot_hash text not null,
  complete_hard_constraint_compilation boolean not null,
  status text not null,
  created_at timestamptz not null default now(),
  unique(studio_id,version)
);
create table public.audit_events(
  id uuid primary key default extensions.gen_random_uuid(),
  studio_id uuid not null,
  actor_user_id uuid,
  actor_label text,
  action text not null,
  entity_type text not null,
  entity_id text,
  detail text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create or replace function private.assert_editor_context()
returns jsonb
language plpgsql
security definer
set search_path=''
as $function$
declare
  v_uid uuid:=nullif(pg_catalog.current_setting('request.jwt.claim.sub',true),'')::uuid;
  v_studio uuid;
  v_role text;
begin
  select m.studio_id,m.role into v_studio,v_role
  from public.studio_members m
  where m.user_id=v_uid
  order by m.studio_id
  limit 1
  for update;
  if not found or v_role not in ('OWNER','EDITOR') then
    raise exception using errcode='42501',message='Editor membership required';
  end if;
  return jsonb_build_object('user_id',v_uid,'studio_id',v_studio,'role',v_role,'actor','POL-01 Owner');
end
$function$;

create or replace function private.validate_constraint_model_snapshot_v27(p_snapshot jsonb,p_rulebook integer,p_compiler text)
returns void
language plpgsql
immutable
set search_path=''
as $function$
begin
  if jsonb_typeof(p_snapshot)<>'object' then raise exception 'ConstraintModel snapshot must be an object'; end if;
  if (p_snapshot->>'rulebookVersion')::integer is distinct from p_rulebook then raise exception 'ConstraintModel Rulebook mismatch'; end if;
  if p_snapshot->>'compilerVersion' is distinct from p_compiler then raise exception 'ConstraintModel compiler mismatch'; end if;
  if jsonb_typeof(p_snapshot->'hardConstraints')<>'array' then raise exception 'ConstraintModel hardConstraints must be an array'; end if;
end
$function$;

create or replace function private.constraint_model_hash_v27(p_snapshot jsonb)
returns text
language sql
immutable
set search_path=''
as $function$
  select encode(extensions.digest(pg_catalog.convert_to(p_snapshot::text,'UTF8'),'sha256'),'hex')
$function$;

create or replace function private.rulebook_required_roster_v38(p_studio uuid,p_class_name text)
returns jsonb
language sql
stable
security definer
set search_path=''
as $function$
  select jsonb_build_object('supported',false,'requiredStudentIds','[]'::jsonb,'ruleIds','[]'::jsonb,'relationshipLabels','[]'::jsonb,'rulebookVersion',3,'rulebookSourceHash','synthetic')
$function$;

insert into public.studios(id,name) values('11111111-1111-4111-8111-111111111111','POL-01 Disposable Studio');
insert into public.studio_members(studio_id,user_id,role) values(
  '11111111-1111-4111-8111-111111111111','10000000-0000-4000-8000-000000000001','OWNER'
);
insert into public.teachers(id,studio_id,name) values(
  'teacher-aimee-stable','11111111-1111-4111-8111-111111111111','Aimee'
);

insert into public.rules(studio_id,id,title,description)
values(
  '11111111-1111-4111-8111-111111111111','AIM-003','Aimee teaching days','Aimee is available Monday through Thursday.'
);
insert into public.rules(studio_id,id,title,description)
select
  '11111111-1111-4111-8111-111111111111',
  'SYN-'||lpad(g::text,3,'0'),
  'Synthetic residual rule '||g,
  'Synthetic unchanged residual policy '||g
from generate_series(1,177) g;

insert into public.rulebook_versions(
  studio_id,version,name,changed_rule_ids,snapshot,rulebook_id,status,source_hash,rule_count,parent_version,format_version,document_type,source_metadata
)
select
  '11111111-1111-4111-8111-111111111111',3,'Disposable noncanonical V3','{}'::text[],
  coalesce(jsonb_agg(to_jsonb(r) order by r.id collate "C"),'[]'::jsonb),
  'dwde-2026-2027-master-rulebook','CURRENT','synthetic-noncanonical-v3',178,2,'2.1','DWDE_SITE_RULEBOOK',
  jsonb_build_object('provenance','DISPOSABLE_TEST_BASELINE')
from public.rules r
where r.studio_id='11111111-1111-4111-8111-111111111111';
`;

const constructV4Sql = String.raw`
-- V5.2 correctly skipped the noncanonical seed. Construct a deidentified V4
-- state that follows the production transition contract, while retaining the
-- accepted V3 source-hash marker only as a historical comparison label.
update public.rulebook_versions set
  status='HISTORICAL',
  source_hash='7d03e131bd0b6a1eddafff70fd3024628215236d3d846cb156d1514329120c5b',
  source_metadata=jsonb_build_object('provenance','POST_REVIEW_CAMI_CONFIRMATION')
where studio_id='11111111-1111-4111-8111-111111111111' and version=3;

update public.rules set
  parameters=jsonb_build_object('policy',jsonb_build_object(
    'schemaVersion','1.0',
    'kind','TEACHER_DAY_WINDOW',
    'teacherId','teacher-aimee-stable',
    'allowedDays',jsonb_build_array('Monday','Tuesday','Wednesday','Thursday')
  )),
  affected_entity_ids=array['teacher-aimee-stable']::text[],
  updated_at='2026-09-08T05:00:00Z'
where studio_id='11111111-1111-4111-8111-111111111111' and id='AIM-003';

insert into public.rulebook_versions(
  studio_id,version,name,changed_rule_ids,snapshot,rulebook_id,status,source_hash,rule_count,parent_version,format_version,document_type,source_metadata
)
select
  '11111111-1111-4111-8111-111111111111',4,'Disposable bounded V4',array['AIM-003']::text[],
  private.rule_snapshot_v52('11111111-1111-4111-8111-111111111111'),
  'dwde-2026-2027-master-rulebook','CURRENT',
  encode(extensions.digest(pg_catalog.convert_to(private.rule_snapshot_v52('11111111-1111-4111-8111-111111111111')::text,'UTF8'),'sha256'),'hex'),
  178,3,'2.2','DWDE_SITE_RULEBOOK',jsonb_build_object(
    'provenance','TYPED_POLICY_MIGRATION',
    'residualBaselineSourceHash','7d03e131bd0b6a1eddafff70fd3024628215236d3d846cb156d1514329120c5b',
    'typedPolicyRuleIds',jsonb_build_array('AIM-003')
  );

select private.assert_reviewed_rulebook_v3_v36('11111111-1111-4111-8111-111111111111');
`;

const regressionSql = String.raw`
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',false);

-- The historical primitive must remain closed after V5.3.
do $block$
begin
  if has_function_privilege('service_role','public.publish_constraint_model_v30(jsonb,text,integer)','EXECUTE') then
    raise exception 'POL-01 reopened retired publish_constraint_model_v30 to service_role';
  end if;
  if not has_function_privilege('service_role','public.publish_server_constraint_model_v49(uuid,uuid,jsonb,text,integer)','EXECUTE') then
    raise exception 'POL-01 server publication wrapper is not executable by service_role';
  end if;
end
$block$;

-- Valid V4 publishes exactly one stable-ID AIM-003 semantic source.
do $block$
declare
  v_snapshot jsonb:=jsonb_build_object(
    'schemaVersion','1.0',
    'compilerVersion','dwde-ir-0.4',
    'rulebookVersion',4,
    'planningDatasetVersion',1,
    'activeRuleCount',178,
    'hardConstraints',jsonb_build_array(jsonb_build_object(
      'id','typed-aim-003-teacher-day-window',
      'kind','TEACHER_DAY_WINDOW',
      'ruleIds',jsonb_build_array('AIM-003'),
      'selector',jsonb_build_object('teacherIds',jsonb_build_array('teacher-aimee-stable')),
      'parameters',jsonb_build_object('allowedDays',jsonb_build_array('Monday','Tuesday','Wednesday','Thursday')),
      'explanation','Aimee is available Monday through Thursday.'
    )),
    'objectivePrioritySpine','[]'::jsonb,
    'readinessRuleIds','[]'::jsonb,
    'governanceAssertions','[]'::jsonb,
    'uncompiledConstraintRuleIds','[]'::jsonb,
    'completeHardConstraintCompilation',true
  );
  v_result jsonb;
begin
  v_result:=public.publish_server_constraint_model_v49(
    '11111111-1111-4111-8111-111111111111',
    '10000000-0000-4000-8000-000000000001',
    v_snapshot,'POL-01 valid V4 publication',4
  );
  if (v_result->>'compilerVersion')<>'dwde-ir-0.4' then raise exception 'valid V4 compiler not published: %',v_result; end if;
  if (select count(*) from public.constraint_model_versions where studio_id='11111111-1111-4111-8111-111111111111' and status='CURRENT')<>1 then
    raise exception 'valid V4 did not create exactly one current model';
  end if;
end
$block$;

-- Rename is irrelevant to stable-ID Rulebook validity and idempotent publication.
update public.teachers set name='Aimee Renamed' where studio_id='11111111-1111-4111-8111-111111111111' and id='teacher-aimee-stable';
select private.assert_reviewed_rulebook_v3_v36('11111111-1111-4111-8111-111111111111');

-- Invalid publication shapes must reject atomically without model/audit writes.
do $block$
declare
  v_base jsonb:=(select snapshot from public.constraint_model_versions where studio_id='11111111-1111-4111-8111-111111111111' and status='CURRENT');
  before_models integer:=(select count(*) from public.constraint_model_versions);
  before_audits integer:=(select count(*) from public.audit_events where action='CONSTRAINT_MODEL_PUBLISHED');
  bad jsonb;
  rejected boolean;
begin
  -- Name-bound selector cannot replace the typed stable-ID source.
  bad:=jsonb_set(v_base,'{hardConstraints,0,selector}',jsonb_build_object('teacherNames',jsonb_build_array('Aimee Renamed')),false);
  rejected:=false;
  begin
    perform public.publish_server_constraint_model_v49('11111111-1111-4111-8111-111111111111','10000000-0000-4000-8000-000000000001',bad,'bad name selector',4);
  exception when others then
    if position('POL01_CONSTRAINT_BINDING_MISMATCH' in sqlerrm)=0 then raise; end if;
    rejected:=true;
  end;
  if not rejected then raise exception 'name-bound V4 AIM-003 publication was accepted'; end if;

  -- Wrong stable ID cannot be substituted.
  bad:=jsonb_set(v_base,'{hardConstraints,0,selector}',jsonb_build_object('teacherIds',jsonb_build_array('teacher-other')),false);
  rejected:=false;
  begin
    perform public.publish_server_constraint_model_v49('11111111-1111-4111-8111-111111111111','10000000-0000-4000-8000-000000000001',bad,'bad stable id',4);
  exception when others then
    if position('POL01_CONSTRAINT_BINDING_MISMATCH' in sqlerrm)=0 then raise; end if;
    rejected:=true;
  end;
  if not rejected then raise exception 'wrong stable ID V4 publication was accepted'; end if;

  -- Duplicate AIM-003 semantic source cannot coexist.
  bad:=jsonb_set(v_base,'{hardConstraints}',(v_base->'hardConstraints') || (v_base->'hardConstraints'->0),false);
  rejected:=false;
  begin
    perform public.publish_server_constraint_model_v49('11111111-1111-4111-8111-111111111111','10000000-0000-4000-8000-000000000001',bad,'duplicate semantic source',4);
  exception when others then
    if position('POL01_CONSTRAINT_SOURCE_COUNT' in sqlerrm)=0 then raise; end if;
    rejected:=true;
  end;
  if not rejected then raise exception 'duplicate AIM-003 V4 publication was accepted'; end if;

  -- Wrong compiler cannot claim V4 semantics.
  bad:=jsonb_set(v_base,'{compilerVersion}','"dwde-ir-0.3"'::jsonb,false);
  rejected:=false;
  begin
    perform public.publish_server_constraint_model_v49('11111111-1111-4111-8111-111111111111','10000000-0000-4000-8000-000000000001',bad,'wrong compiler',4);
  exception when others then
    if position('CONSTRAINT_MODEL_COMPILER_MISMATCH' in sqlerrm)=0 then raise; end if;
    rejected:=true;
  end;
  if not rejected then raise exception 'V3 compiler was accepted for V4'; end if;

  if (select count(*) from public.constraint_model_versions)<>before_models
     or (select count(*) from public.audit_events where action='CONSTRAINT_MODEL_PUBLISHED')<>before_audits then
    raise exception 'rejected V4 publication mutated model/audit state';
  end if;
end
$block$;

-- Archived stable ID fails closed even when display name still matches.
update public.teachers set archived_at=now() where studio_id='11111111-1111-4111-8111-111111111111' and id='teacher-aimee-stable';
do $block$ declare rejected boolean:=false; begin
  begin perform private.assert_reviewed_rulebook_v3_v36('11111111-1111-4111-8111-111111111111');
  exception when others then
    if position('RULEBOOK_POLICY_REFERENCE_MISSING' in sqlerrm)=0 then raise; end if;
    rejected:=true;
  end;
  if not rejected then raise exception 'archived typed teacher ID remained valid'; end if;
end
$block$;
update public.teachers set archived_at=null where studio_id='11111111-1111-4111-8111-111111111111' and id='teacher-aimee-stable';

-- Missing stable ID cannot be rescued by a different teacher with the same name.
delete from public.teachers where studio_id='11111111-1111-4111-8111-111111111111' and id='teacher-aimee-stable';
insert into public.teachers(id,studio_id,name) values('teacher-aimee-replacement','11111111-1111-4111-8111-111111111111','Aimee Renamed');
do $block$ declare rejected boolean:=false; begin
  begin perform private.assert_reviewed_rulebook_v3_v36('11111111-1111-4111-8111-111111111111');
  exception when others then
    if position('RULEBOOK_POLICY_REFERENCE_MISSING' in sqlerrm)=0 then raise; end if;
    rejected:=true;
  end;
  if not rejected then raise exception 'replacement display-name match rescued missing stable teacher ID'; end if;
end
$block$;
delete from public.teachers where studio_id='11111111-1111-4111-8111-111111111111' and id='teacher-aimee-replacement';
insert into public.teachers(id,studio_id,name) values('teacher-aimee-stable','11111111-1111-4111-8111-111111111111','Aimee Renamed');

-- Residual rule drift remains blocked even if someone rewrites the V4 snapshot
-- and source hash to make live/current agree.
update public.rules set description='Unauthorized residual policy change' where studio_id='11111111-1111-4111-8111-111111111111' and id='SYN-001';
update public.rulebook_versions set
  snapshot=private.rule_snapshot_v52('11111111-1111-4111-8111-111111111111'),
  source_hash=encode(extensions.digest(pg_catalog.convert_to(private.rule_snapshot_v52('11111111-1111-4111-8111-111111111111')::text,'UTF8'),'sha256'),'hex')
where studio_id='11111111-1111-4111-8111-111111111111' and version=4;
do $block$ declare rejected boolean:=false; begin
  begin perform private.assert_reviewed_rulebook_v3_v36('11111111-1111-4111-8111-111111111111');
  exception when others then
    if position('residual V3 policy changed' in sqlerrm)=0 then raise; end if;
    rejected:=true;
  end;
  if not rejected then raise exception 'residual V3 policy drift was accepted'; end if;
end
$block$;

select 'POL-01 DB PASS: bounded V4 stable-ID authority, rename invariance, fail-closed references, single-source publication, residual pinning, retired primitive closure, and rejection no-write proof' as result;
`;

async function main() {
  const args = process.argv.slice(2);
  const allowDisposable = args.includes('--allow-disposable') || process.env.STUDIO_SCHEDULER_TEST_DB_ALLOW_DISPOSABLE === '1';
  const targetArg = args.find((argument) => argument.startsWith('--target='));
  const targetEnvironment = { ...process.env };
  if (targetArg) targetEnvironment.STUDIO_SCHEDULER_TEST_DB_TARGET = targetArg.slice('--target='.length);
  assertDisposableTarget(targetEnvironment);
  if (!allowDisposable) throw new DatabaseHarnessError('POL-01 refuses to run without --allow-disposable.');

  const dockerVersion = runProcess('docker', ['version', '--format', '{{.Server.Version}}']);
  if (dockerVersion.status !== 0) {
    throw new DatabaseHarnessError(`Docker daemon unavailable for POL-01 regression. Start Docker Desktop and retry.\n${outputFor(dockerVersion)}`);
  }

  const container = `studio-scheduler-pol01-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
  let running = false;
  try {
    docker(['run','--detach','--rm','--name',container,'--env','POSTGRES_PASSWORD=pol01-disposable-only',postgresImage]);
    running = true;
    await waitForPostgres(container);
    psql(container, setupSql, 'POL-01 minimal fixture');
    psql(container, readFileSync(migrationV52, 'utf8'), 'POL-01 V5.2 migration under test');
    psql(container, readFileSync(migrationV53, 'utf8'), 'POL-01 V5.3 closure migration under test');
    psql(container, constructV4Sql, 'POL-01 deidentified bounded V4 fixture');
    process.stdout.write(psql(container, regressionSql, 'POL-01 typed-policy regression'));
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
