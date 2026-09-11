import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const postgresImage = 'postgres@sha256:ef257d85f76e48da1c64832459b59fcaba1a4dac97bf5d7450c77753542eee94';
const productionProjectHost = 'kbgzrefivxqoiwumfyui.supabase.co';

export class DatabaseHarnessError extends Error {}

function runProcess(command, args, input) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: 'utf8',
    input,
    maxBuffer: 32 * 1024 * 1024,
    windowsHide: true,
  });

  if (result.error) {
    throw new DatabaseHarnessError(`${command} could not be started: ${result.error.message}`);
  }

  return result;
}

function outputFor(result) {
  return [result.stdout, result.stderr].filter(Boolean).join('\n').trim();
}

function targetHost(value) {
  try {
    return new URL(value).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function isLoopbackHost(host) {
  return host === 'localhost' || host === '127.0.0.1' || host === '::1';
}

export function assertDisposableTarget(env = process.env) {
  const target = (env.STUDIO_SCHEDULER_TEST_DB_TARGET ?? '').trim();
  if (target && target !== 'docker-local') {
    throw new DatabaseHarnessError(
      `Refusing database target "${target}". Only the disposable Docker target "docker-local" is supported.`,
    );
  }

  const candidates = [
    ['STUDIO_SCHEDULER_TEST_DB_URL', env.STUDIO_SCHEDULER_TEST_DB_URL],
    ['NEXT_PUBLIC_SUPABASE_URL', env.NEXT_PUBLIC_SUPABASE_URL],
    ['SUPABASE_URL', env.SUPABASE_URL],
  ];

  for (const [name, value] of candidates) {
    if (!value?.trim()) continue;

    const host = targetHost(value.trim());
    if (host === productionProjectHost || value.includes(productionProjectHost)) {
      throw new DatabaseHarnessError(
        `Refusing production target from ${name}. The database harness never connects to ${productionProjectHost}.`,
      );
    }

    if (name === 'STUDIO_SCHEDULER_TEST_DB_URL' && !isLoopbackHost(host)) {
      throw new DatabaseHarnessError(
        `Refusing external target from ${name}. Disposable tests accept loopback URLs only and create their own container.`,
      );
    }

    if (name !== 'STUDIO_SCHEDULER_TEST_DB_URL' && host && !isLoopbackHost(host)) {
      throw new DatabaseHarnessError(
        `Refusing external Supabase target from ${name}. Unset application database configuration before running the disposable harness.`,
      );
    }
  }
}

function parseArgs(argv) {
  const targetArgument = argv.find((argument) => argument.startsWith('--target='));
  return {
    allowDisposable:
      argv.includes('--allow-disposable') || process.env.STUDIO_SCHEDULER_TEST_DB_ALLOW_DISPOSABLE === '1',
    checkTarget: argv.includes('--check-target'),
    onlyPol04: argv.includes('--only-pol04'),
    onlyOps01: argv.includes('--only-ops01'),
    target: targetArgument ? targetArgument.slice('--target='.length) : null,
  };
}

function docker(args, input) {
  const result = runProcess('docker', args, input);
  if (result.status !== 0) {
    throw new DatabaseHarnessError(`docker ${args[0] ?? 'command'} failed:\n${outputFor(result)}`);
  }
  return result;
}

function sqlFiles(directory) {
  return readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.sql'))
    .map((entry) => path.join(directory, entry.name))
    .sort((left, right) => path.basename(left).localeCompare(path.basename(right), 'en'));
}

function validateArchiveManifest(archiveFiles) {
  const manifestPath = path.join(repoRoot, 'supabase', 'production-ledger', 'manifest.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const entries = manifest.entries;
  const actualNames = archiveFiles.map((file) => path.basename(file));
  const manifestNames = entries.map((entry) => entry.file);

  if (JSON.stringify(actualNames) !== JSON.stringify(manifestNames)) {
    throw new DatabaseHarnessError(
      `Production-ledger archive does not match manifest.json. Expected ${manifestNames.length} files, found ${actualNames.length}.`,
    );
  }

  for (const entry of entries) {
    const bytes = readFileSync(path.join(repoRoot, 'supabase', 'production-ledger', entry.file));
    const blobHeader = Buffer.from(`blob ${bytes.length}\0`, 'utf8');
    const gitBlobSha1 = createHash('sha1').update(Buffer.concat([blobHeader, bytes])).digest('hex');
    if (bytes.length !== entry.bytes || gitBlobSha1 !== entry.git_blob_sha1) {
      throw new DatabaseHarnessError(
        `Production-ledger integrity check failed for ${entry.file}: expected ${entry.bytes} bytes/${entry.git_blob_sha1}, got ${bytes.length} bytes/${gitBlobSha1}.`,
      );
    }
  }
}

function prepareBootstrap() {
  const bootstrapPath = path.join(repoRoot, 'supabase', 'bootstrap', '2026-08-31-production-schema-baseline.sql');
  const bootstrap = readFileSync(bootstrapPath, 'utf8');
  const vaultExtension = /^create extension if not exists supabase_vault;\r?\n?/im;
  if (!vaultExtension.test(bootstrap)) {
    throw new DatabaseHarnessError('Bootstrap no longer contains the expected Supabase Vault extension boundary.');
  }
  return bootstrap.replace(vaultExtension, '');
}

const compatibilityBridge = String.raw`
-- Test-only bridge for the bootstrap snapshot's pre-V2.1 entity_versions shape.
alter table public.entity_versions add column if not exists version integer;
alter table public.entity_versions add column if not exists before_entity jsonb;
alter table public.entity_versions add column if not exists after_entity jsonb;
update public.entity_versions
set version=coalesce(version,1),
    before_entity=coalesce(before_entity,before_data),
    after_entity=coalesce(after_entity,after_data,'{}'::jsonb)
where version is null or before_entity is null or after_entity is null;
alter table public.entity_versions alter column version set not null;
alter table public.entity_versions alter column after_entity set not null;
create unique index if not exists entity_versions_studio_entity_version_uq
  on public.entity_versions(studio_id,entity_type,entity_id,version);

-- The bootstrap snapshot omits legacy RPC definitions that the archived V2.1
-- hardening migration revokes. Keep the historical revoke statements intact;
-- these inert signatures only let the archive apply and are never executable.
create or replace function public.apply_rule_patch(text,text,jsonb,text,boolean)
returns jsonb language plpgsql security definer set search_path=''
as $function$ begin raise exception 'Legacy rule mutation RPC is unavailable'; end $function$;
create or replace function public.apply_schedule_patch(text,jsonb,text,jsonb,boolean)
returns jsonb language plpgsql security definer set search_path=''
as $function$ begin raise exception 'Legacy schedule mutation RPC is unavailable'; end $function$;
create or replace function public.import_canonical_rulebook(jsonb,text)
returns jsonb language plpgsql security definer set search_path=''
as $function$ begin raise exception 'Legacy canonical import RPC is unavailable'; end $function$;
create or replace function public.import_reviewed_rulebook(jsonb,text,text)
returns jsonb language plpgsql security definer set search_path=''
as $function$ begin raise exception 'Legacy reviewed import RPC is unavailable'; end $function$;
`;

const authVaultShim = String.raw`
create schema if not exists extensions;
create schema if not exists auth;
create schema if not exists vault;
create schema if not exists private;
do $block$
begin
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated login nosuperuser nobypassrls; end if;
  if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role nologin; end if;
end
$block$;
create extension if not exists pgcrypto with schema extensions;
set search_path=public,extensions;
create table if not exists auth.users(
  id uuid primary key,
  email text not null unique,
  raw_user_meta_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create or replace function auth.uid()
returns uuid
language sql
stable
security definer
set search_path=''
as $function$
  select nullif(pg_catalog.current_setting('request.jwt.claim.sub',true),'')::uuid
$function$;
grant usage on schema auth to public;
grant execute on function auth.uid() to public;
create table if not exists vault.secrets(
  id uuid primary key,
  secret text not null,
  name text not null,
  description text,
  created_at timestamptz not null default now()
);
create table if not exists vault.decrypted_secrets(
  id uuid primary key,
  decrypted_secret text not null
);
create or replace function vault.create_secret(p_secret text,p_name text,p_description text)
returns uuid
language plpgsql
security definer
set search_path=''
as $function$
declare v_id uuid:=extensions.gen_random_uuid();
begin
  insert into vault.secrets(id,secret,name,description) values(v_id,p_secret,p_name,p_description);
  insert into vault.decrypted_secrets(id,decrypted_secret) values(v_id,p_secret);
  return v_id;
end
$function$;
create or replace function vault.update_secret(p_id uuid,p_secret text,p_name text,p_description text)
returns void
language plpgsql
security definer
set search_path=''
as $function$
begin
  update vault.secrets set secret=p_secret,name=p_name,description=p_description where id=p_id;
  update vault.decrypted_secrets set decrypted_secret=p_secret where id=p_id;
end
$function$;
grant usage on schema vault to public;
grant execute on function vault.create_secret(text,text,text),vault.update_secret(uuid,text,text,text) to public;
`;

const fixtureSql = String.raw`
set search_path=public,extensions;
insert into auth.users(id,email,raw_user_meta_data) values
  ('10000000-0000-4000-8000-000000000001','t02-owner@example.test','{"full_name":"T02 Owner"}'),
  ('10000000-0000-4000-8000-000000000002','t02-editor@example.test','{"full_name":"T02 Editor"}'),
  ('10000000-0000-4000-8000-000000000003','t02-viewer@example.test','{"full_name":"T02 Viewer"}'),
  ('10000000-0000-4000-8000-000000000004','t02-nonmember@example.test','{"full_name":"T02 Nonmember"}');
insert into public.studio_members(studio_id,user_id,role) values
  ('11111111-1111-4111-8111-111111111111','10000000-0000-4000-8000-000000000001','OWNER'),
  ('11111111-1111-4111-8111-111111111111','10000000-0000-4000-8000-000000000002','EDITOR'),
  ('11111111-1111-4111-8111-111111111111','10000000-0000-4000-8000-000000000003','VIEWER');
`;

const rulebookMigrationPrereqSql = String.raw`
-- The bootstrap is schema-only. This deidentified fixture supplies the exact
-- data precondition required by the post-review V3 migration, then remains in
-- the disposable database as current Rulebook data.
insert into public.rules(
  id,studio_id,category,type,title,description,strength,status,verification_status,
  affected_entity_ids,parameters,exceptions,source,version_introduced,
  classification_raw,review_status,review,source_raw,enforcement_status
) values
  (
    'OPS-002','11111111-1111-4111-8111-111111111111','OPS','TEST_FIXTURE',
    'Weekday 4:30 start exceptions',
    'Only Elementary 1, Elementary 2, Level 4B, and 4B/5 levels may start at 4:30 PM. 4:45 PM remains the preferred normal weekday start time.',
    'HARD','ACTIVE','VERIFIED','{}','{}','[]','{}',2,'HARD','VERIFIED','{}','{}','NOT_IMPLEMENTED'
  ),
  (
    'ADV-004','11111111-1111-4111-8111-111111111111','ADV','TEST_FIXTURE',
    'Kiran Landis lower-level exception',
    'Kiran Landis has more flexibility than the normal lower-level rule; pursue lower-level placement, but do not treat it with the same hard rigidity as the general requirement.',
    'HARD','ACTIVE','VERIFIED','{}','{}','[]','{}',2,'HARD','VERIFIED','{}','{}','NOT_IMPLEMENTED'
  );
insert into public.rules(
  id,studio_id,category,type,title,description,strength,status,verification_status,
  affected_entity_ids,parameters,exceptions,source,version_introduced,
  classification_raw,review_status,review,source_raw,enforcement_status
)
select
  'T02-RULE-'||lpad(n::text,3,'0'),
  '11111111-1111-4111-8111-111111111111','TEST','TEST_FIXTURE',
  'T02 fixture rule '||n,
  'Deidentified T02 migration witness rule '||n,
  'LIGHT','ACTIVE','VERIFIED','{}','{}','[]','{}',2,'LIGHT','VERIFIED','{}','{}','NOT_IMPLEMENTED'
from generate_series(1,176) as s(n);
insert into public.rulebook_versions(
  studio_id,version,name,actor_user_id,actor_label,reason,changed_rule_ids,snapshot,
  rulebook_id,status,source_hash,rule_count,parent_version,format_version,document_type,source_metadata
)
select
  '11111111-1111-4111-8111-111111111111',2,'T02 deidentified Rulebook V2',null,
  'T02 fixture','Migration prerequisite fixture','{}',
  coalesce(jsonb_agg(to_jsonb(r) order by r.id),'[]'::jsonb),
  'dwde-2026-2027-master-rulebook','CURRENT',
  encode(extensions.digest(pg_catalog.convert_to(coalesce(jsonb_agg(to_jsonb(r) order by r.id),'[]'::jsonb)::text,'UTF8'),'sha256'),'hex'),
  count(*)::integer, null,'2.0','DWDE_SITE_RULEBOOK','{"fixture":"T02-deidentified-rulebook-v2"}'::jsonb
from public.rules r
where r.studio_id='11111111-1111-4111-8111-111111111111';
`;

const roleTestSql = String.raw`
set search_path=public,extensions;
set client_min_messages=notice;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',false);
select version as initial_planning_version
from public.planning_dataset_versions
where studio_id='11111111-1111-4111-8111-111111111111' and status='CURRENT'
\gset
select public.mutate_planning_entity_v28(
  'CREATE','TEACHER','t02-owner-teacher',
  '{"name":"T02 Owner Teacher"}'::jsonb,
  'T02 owner governed write',:initial_planning_version
)->>'planningDatasetVersion' as owner_write_planning_version;
do $block$
begin
  if not exists(select 1 from public.teachers where id='t02-owner-teacher' and studio_id='11111111-1111-4111-8111-111111111111') then
    raise exception 'Owner governed write did not persist';
  end if;
end
$block$;

select version as owner_planning_version
from public.planning_dataset_versions
where studio_id='11111111-1111-4111-8111-111111111111' and status='CURRENT'
\gset
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000002',false);
select public.mutate_planning_entity_v28(
  'CREATE','TEACHER','t02-editor-teacher',
  '{"name":"T02 Editor Teacher"}'::jsonb,
  'T02 editor governed write',:owner_planning_version
)->>'planningDatasetVersion' as editor_write_planning_version;
do $block$
begin
  if not exists(select 1 from public.teachers where id='t02-editor-teacher' and studio_id='11111111-1111-4111-8111-111111111111') then
    raise exception 'Editor governed write did not persist';
  end if;
end
$block$;

select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000003',false);
do $block$
declare v_rejected boolean:=false; v_visible integer;
begin
  begin
    perform public.mutate_planning_entity_v28(
      'CREATE','TEACHER','t02-viewer-teacher','{"name":"T02 Viewer Teacher"}'::jsonb,
      'T02 viewer rejection',0
    );
  exception when others then
    if position('Editor membership required' in sqlerrm)=0 then raise; end if;
    v_rejected:=true;
  end;
  if not v_rejected then raise exception 'Viewer governed write was accepted'; end if;
  select count(*) into v_visible from public.teachers where id='t02-viewer-teacher';
  if v_visible<>0 then raise exception 'Viewer rejection left a teacher row'; end if;
  if (select count(*) from public.teachers where studio_id='11111111-1111-4111-8111-111111111111')<>2 then
    raise exception 'Viewer RLS fixture visibility changed unexpectedly';
  end if;
end
$block$;

select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000004',false);
do $block$
declare v_rejected boolean:=false; v_visible integer;
begin
  begin
    perform public.mutate_planning_entity_v28(
      'CREATE','TEACHER','t02-nonmember-teacher','{"name":"T02 Nonmember Teacher"}'::jsonb,
      'T02 nonmember rejection',0
    );
  exception when others then
    if position('Studio membership required' in sqlerrm)=0 then raise; end if;
    v_rejected:=true;
  end;
  if not v_rejected then raise exception 'Nonmember governed write was accepted'; end if;
  select count(*) into v_visible from public.teachers where studio_id='11111111-1111-4111-8111-111111111111';
  if v_visible<>0 then raise exception 'Nonmember RLS exposed studio rows'; end if;
end
$block$;

select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',false);
do $block$
declare v_rejected boolean:=false; v_count integer; v_stale_expected integer;
begin
  select version-1 into v_stale_expected
  from public.planning_dataset_versions
  where studio_id='11111111-1111-4111-8111-111111111111' and status='CURRENT';
  begin
    perform public.mutate_planning_entity_v28(
      'CREATE','TEACHER','t02-stale-teacher','{"name":"T02 Stale Teacher"}'::jsonb,
      'T02 stale-version rejection',v_stale_expected
    );
  exception when others then
    if position('STALE_PLANNING_DATASET' in sqlerrm)=0 then raise; end if;
    v_rejected:=true;
  end;
  if not v_rejected then raise exception 'Stale planning dataset write was accepted'; end if;
  select count(*) into v_count from public.teachers where id='t02-stale-teacher';
  if v_count<>0 then raise exception 'Stale rejection left a teacher row'; end if;
end
$block$;

do $block$
begin
  if to_regprocedure('public.apply_rule_patch(text,text,jsonb,text,boolean)') is not null then
    if has_function_privilege(current_user,'public.apply_rule_patch(text,text,jsonb,text,boolean)','execute') then
      raise exception 'Legacy rule mutation RPC remains executable by authenticated role';
    end if;
  end if;
end
$block$;

select 'T02 PASS: owner/editor writes, viewer/nonmember rejection, RLS visibility, stale-version atomicity, and legacy RPC privilege boundary' as result;
`;

const constraintModelRoundTripSql = String.raw`
set search_path=public,extensions;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',false);
do $block$
declare
  v_rulebook integer;
  v_submitted jsonb:= $json$
  {
    "schemaVersion":"1.0",
    "compilerVersion":"t03-jsonb-test",
    "rulebookVersion":3,
    "activeRuleCount":178,
    "hardConstraints":[{
      "id":"t03-time-grid",
      "kind":"TIME_GRID",
      "ruleIds":["OPS-017"],
      "selector":{"teacherNames":["Teacher"],"subjects":["Ballet"]},
      "parameters":{"window":{"end":"18:00","start":"17:00"},"minutes":15},
      "explanation":"T03 JSONB round-trip witness"
    }],
    "objectivePrioritySpine":[{"ruleId":"OPT-001"},{"ruleId":"OPT-002"},{"ruleId":"OPT-003"},{"ruleId":"OPT-004"},{"ruleId":"OPT-005"},{"ruleId":"OPT-006"},{"ruleId":"OPT-007"},{"ruleId":"OPT-008"},{"ruleId":"OPT-009"}],
    "readinessRuleIds":["CUR-001"],
    "governanceAssertions":[],
    "uncompiledConstraintRuleIds":[],
    "completeHardConstraintCompilation":true
  }
  $json$::jsonb;
  v_reordered jsonb:= $json$
  {
    "completeHardConstraintCompilation":true,
    "uncompiledConstraintRuleIds":[],
    "governanceAssertions":[],
    "readinessRuleIds":["CUR-001"],
    "objectivePrioritySpine":[{"ruleId":"OPT-001"},{"ruleId":"OPT-002"},{"ruleId":"OPT-003"},{"ruleId":"OPT-004"},{"ruleId":"OPT-005"},{"ruleId":"OPT-006"},{"ruleId":"OPT-007"},{"ruleId":"OPT-008"},{"ruleId":"OPT-009"}],
    "hardConstraints":[{
      "explanation":"T03 JSONB round-trip witness",
      "parameters":{"minutes":15,"window":{"start":"17:00","end":"18:00"}},
      "selector":{"subjects":["Ballet"],"teacherNames":["Teacher"]},
      "ruleIds":["OPS-017"],
      "kind":"TIME_GRID",
      "id":"t03-time-grid"
    }],
    "activeRuleCount":178,
    "rulebookVersion":3,
    "compilerVersion":"t03-jsonb-test",
    "schemaVersion":"1.0"
  }
  $json$::jsonb;
  v_first jsonb;
  v_republished jsonb;
  v_readback jsonb;
  v_hash text;
  v_version integer;
begin
  select version into v_rulebook
  from public.rulebook_versions
  where studio_id='11111111-1111-4111-8111-111111111111' and status='CURRENT'
  limit 1;
  if v_rulebook is null then raise exception 'T03 JSONB test has no current RulebookVersion'; end if;

  v_first:=public.publish_server_constraint_model_v49('11111111-1111-4111-8111-111111111111','10000000-0000-4000-8000-000000000001',v_submitted,'T03 JSONB publication',v_rulebook);
  select snapshot,snapshot_hash,version into v_readback,v_hash,v_version
  from public.constraint_model_versions
  where studio_id='11111111-1111-4111-8111-111111111111'
    and version=(v_first->>'constraintModelVersion')::integer;

  if v_readback is distinct from v_submitted then
    raise exception 'T03 JSONB publication/read-back changed the semantic model';
  end if;
  if (v_first->>'alreadyCurrent')::boolean is distinct from false then
    raise exception 'T03 first JSONB publication unexpectedly reused an existing version';
  end if;
  if v_first->>'snapshotHash' is distinct from v_hash then
    raise exception 'T03 publication returned a hash different from the historical snapshot hash';
  end if;

  v_republished:=public.publish_server_constraint_model_v49('11111111-1111-4111-8111-111111111111','10000000-0000-4000-8000-000000000001',v_reordered,'T03 JSONB reordered read-back',v_rulebook);
  if (v_republished->>'alreadyCurrent')::boolean is distinct from true then
    raise exception 'T03 reordered JSONB model caused a silent new publication';
  end if;
  if (v_republished->>'constraintModelVersion')::integer is distinct from v_version
     or v_republished->>'snapshotHash' is distinct from v_hash then
    raise exception 'T03 reordered JSONB model changed the historical version or fingerprint';
  end if;
end
$block$;

select 'T03 PASS: JSONB publication/read-back preserves semantic model and historical version/fingerprint across object-key reordering' as result;
`;

const candidateIntervalFixtureSql = String.raw`
set search_path=public,extensions;
alter role service_role bypassrls;
grant usage on schema public to service_role;
grant select on public.schedule_versions,public.rulebook_versions,
  public.rule_enforcement_versions,public.planning_dataset_versions,
  public.constraint_model_versions,public.class_sessions,public.class_definitions,
  public.teachers,public.rooms to service_role;
grant select,insert,update on public.assignments,public.audit_events,
  public.schedule_versions to service_role;
do $block$
declare
  v_studio uuid := '11111111-1111-4111-8111-111111111111';
  v_rulebook integer;
  v_enforcement public.rule_enforcement_versions%rowtype;
  v_constraint integer;
  v_planning integer;
  v_new_enforcement integer;
begin
  insert into public.teachers(id,studio_id,name)
  values ('t04-teacher',v_studio,'T04 Teacher');
  insert into public.rooms(id,studio_id,name,capacity)
  values ('t04-room',v_studio,'T04 Room',20);
  insert into public.class_definitions(
    id,studio_id,name,subject,level,duration_minutes,weekly_frequency,
    roster_student_ids,eligible_teacher_ids
  ) values (
    't04-class',v_studio,'T04 Canonical Interval','Ballet','T04',60,1,
    '{}','{t04-teacher}'
  );
  insert into public.class_sessions(
    id,studio_id,class_id,ordinal,duration_minutes,locked
  ) values (
    't04-session',v_studio,'t04-class',1,90,false
  );

  -- The deidentified T02 fixture contains OPS-002 as the only current HARD
  -- Rulebook row after V3. Add its reviewed earliest-start mapping to the
  -- disposable current EnforcementVersion so the legacy validator can prove
  -- complete coverage while this harness exercises adoption.
  select * into v_enforcement
  from public.rule_enforcement_versions
  where studio_id=v_studio and status='CURRENT'
  limit 1;
  if v_enforcement.id is null then
    raise exception 'T04 fixture requires a current EnforcementVersion';
  end if;
  if not exists (
    select 1 from jsonb_array_elements(v_enforcement.snapshot) elem
    where elem->>'ruleId'='OPS-002'
  ) then
    select coalesce(max(version),0)+1 into v_new_enforcement
    from public.rule_enforcement_versions
    where studio_id=v_studio;
    update public.rule_enforcement_versions
    set status='HISTORICAL'
    where id=v_enforcement.id;
    insert into public.rule_enforcement_versions(
      studio_id,version,rulebook_version,actor_label,reason,
      changed_rule_ids,snapshot,status
    ) values (
      v_studio,v_new_enforcement,v_enforcement.rulebook_version,
      'T04 disposable fixture','Cover the current OPS-002 HARD rule for adoption integration',
      array['OPS-002']::text[],
      coalesce(v_enforcement.snapshot,'[]'::jsonb) || jsonb_build_array(
        jsonb_build_object(
          'ruleId','OPS-002',
          'type','EARLIEST_START',
          'parameters',jsonb_build_object('time','16:45','days',jsonb_build_array('Monday')),
          'affectedEntityIds','[]'::jsonb,
          'exceptions','[]'::jsonb
        )
      ),
      'CURRENT'
    );
  end if;

  select version into v_rulebook
  from public.rulebook_versions
  where studio_id=v_studio and status='CURRENT'
  limit 1;
  select version into v_constraint
  from public.constraint_model_versions
  where studio_id=v_studio and status='CURRENT' and complete_hard_constraint_compilation=true
  limit 1;
  if v_rulebook is null or v_constraint is null then
    raise exception 'T04 fixture requires current Rulebook and complete Constraint Model versions';
  end if;

  select private.ensure_planning_dataset_version_v25(
    v_studio,null,'T04 disposable fixture','Seed canonical session duration override witness'
  ) into v_planning;

  if exists (select 1 from public.schedule_versions where studio_id=v_studio and is_current) then
    raise exception 'T04 fixture expected no current schedule before adoption';
  end if;

  insert into public.schedule_versions(
    studio_id,version,rulebook_version,enforcement_version,
    planning_dataset_version,constraint_model_version,actor_user_id,
    actor_label,reason,is_current
  ) values (
    v_studio,
    coalesce((select max(version) from public.schedule_versions where studio_id=v_studio),0)+1,
    v_rulebook,
    (select version from public.rule_enforcement_versions where studio_id=v_studio and status='CURRENT'),
    v_planning,
    v_constraint,
    '10000000-0000-4000-8000-000000000001',
    'T04 disposable fixture','Seed current schedule for candidate adoption',true
  );

  insert into public.assignments(
    schedule_version_id,id,studio_id,session_id,day,start_time,end_time,
    teacher_id,room_id,locked,status
  )
  select
    sv.id,'t04-existing-assignment',v_studio,'t04-session','Monday','17:00','18:30',
    't04-teacher','t04-room',false,'NORMAL'
  from public.schedule_versions sv
  where sv.studio_id=v_studio and sv.is_current;
end
$block$;
`;

const planningConfirmationSql = String.raw`
set search_path=public,extensions;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',false);
-- V39 is revoked for application roles by SET-07. This historical T04
-- fixture is seeded as the disposable database owner; SET-07 has a dedicated
-- V60 transaction regression for the application boundary.
set role postgres;
select public.confirm_current_planning_dataset_v39(
  version,
  snapshot_hash,
  'T04 disposable fixture confirms the exact session-duration witness',
  '{
    "peopleInventoryReviewed":true,
    "classSessionCatalogReviewed":true,
    "classRostersReviewed":true,
    "sourceAndCompletenessReviewed":true
  }'::jsonb
)
from public.planning_dataset_versions
where studio_id='11111111-1111-4111-8111-111111111111' and status='CURRENT';
`;

const candidateIntervalAdoptionSql = String.raw`
set search_path=public,extensions;
set role postgres;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',false);
do $block$
declare
  v_studio uuid := '11111111-1111-4111-8111-111111111111';
  v_owner uuid := '10000000-0000-4000-8000-000000000001';
  v_schedule public.schedule_versions%rowtype;
  v_result jsonb;
  v_before_count integer;
  v_after_count integer;
  v_rejected boolean := false;
begin
  select * into v_schedule
  from public.schedule_versions
  where studio_id=v_studio and is_current;
  if v_schedule.id is null then raise exception 'T04 adoption fixture has no current schedule'; end if;

  v_result := public.adopt_solver_candidate_v33(
    v_studio,v_owner,'T04 integration actor','Persist canonical 90-minute interval',
    v_schedule.version,v_schedule.rulebook_version,v_schedule.enforcement_version,
    v_schedule.planning_dataset_version,v_schedule.constraint_model_version,
    jsonb_build_array(jsonb_build_object(
      'sessionId','t04-session','day','Monday','startTime','17:00','endTime','18:30',
      'teacherId','t04-teacher','roomId','t04-room'
    )),
    '{"valid":true,"hardViolations":0}'::jsonb
  );

  if (v_result->>'scheduleVersion')::integer <> v_schedule.version+1 then
    raise exception 'T04 valid adoption did not create the next schedule version';
  end if;
  if not exists (
    select 1
    from public.assignments a
    join public.schedule_versions sv on sv.id=a.schedule_version_id
    where sv.studio_id=v_studio and sv.is_current
      and a.session_id='t04-session'
      and a.start_time='17:00'::time
      and a.end_time='18:30'::time
      and a.teacher_id='t04-teacher'
      and a.room_id='t04-room'
  ) then
    raise exception 'T04 valid adoption did not persist the exact canonical interval';
  end if;

  select count(*) into v_before_count from public.schedule_versions where studio_id=v_studio;
  begin
    perform public.adopt_solver_candidate_v33(
      v_studio,v_owner,'T04 integration actor','Reject shortened canonical interval',
      (v_result->>'scheduleVersion')::integer,
      (v_result->>'rulebookVersion')::integer,
      (v_result->>'enforcementVersion')::integer,
      (v_result->>'planningDatasetVersion')::integer,
      (v_result->>'constraintModelVersion')::integer,
      jsonb_build_array(jsonb_build_object(
        'sessionId','t04-session','day','Monday','startTime','17:00','endTime','17:15',
        'teacherId','t04-teacher','roomId','t04-room'
      )),
      '{"valid":true,"hardViolations":0}'::jsonb
    );
  exception when others then
    if position('CANDIDATE_INVALID_ASSIGNMENTS' in sqlerrm)=0 then raise; end if;
    v_rejected:=true;
  end;
  if not v_rejected then raise exception 'T04 shortened interval was accepted by SQL adoption'; end if;
  select count(*) into v_after_count from public.schedule_versions where studio_id=v_studio;
  if v_after_count<>v_before_count then
    raise exception 'T04 rejected candidate left a schedule version behind';
  end if;
  if not exists (
    select 1 from public.schedule_versions where studio_id=v_studio and is_current
      and version=(v_result->>'scheduleVersion')::integer
  ) then
    raise exception 'T04 rejected candidate changed the current schedule';
  end if;
end
$block$;

select 'T04 PASS: exact duration-derived interval persisted, shortened candidate rejected, and rejected adoption rolled back atomically' as result;
`;

const archiveAwareAdoptionSql = String.raw`
set search_path=public,extensions;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',false);

-- Archive the complete T04 planning unit through the governed editor boundary.
set role authenticated;
select public.set_planning_entity_archive_v40(
  'CLASS','t04-class',true,'T06 archive class lifecycle',
  (select version from public.planning_dataset_versions where studio_id='11111111-1111-4111-8111-111111111111' and status='CURRENT')
);
select public.set_planning_entity_archive_v40(
  'TEACHER','t04-teacher',true,'T06 archive teacher lifecycle',
  (select version from public.planning_dataset_versions where studio_id='11111111-1111-4111-8111-111111111111' and status='CURRENT')
);
select public.set_planning_entity_archive_v40(
  'ROOM','t04-room',true,'T06 archive room lifecycle',
  (select version from public.planning_dataset_versions where studio_id='11111111-1111-4111-8111-111111111111' and status='CURRENT')
);
set role postgres;
select public.confirm_current_planning_dataset_v39(
  version,snapshot_hash,'T06 confirmed archived active inventory',
  '{"peopleInventoryReviewed":true,"classSessionCatalogReviewed":true,"classRostersReviewed":true,"sourceAndCompletenessReviewed":true}'::jsonb
)
from public.planning_dataset_versions
where studio_id='11111111-1111-4111-8111-111111111111' and status='CURRENT';
reset role;

do $block$
begin
  if not exists(select 1 from public.class_definitions where id='t04-class' and archived_at is not null) then
    raise exception 'T06 class archive did not persist';
  end if;
  if not exists(select 1 from public.class_sessions where id='t04-session' and archived_at is not null) then
    raise exception 'T06 class archive did not archive its weekly session';
  end if;
  if not exists(select 1 from public.teachers where id='t04-teacher' and archived_at is not null) then
    raise exception 'T06 teacher archive did not persist';
  end if;
  if not exists(select 1 from public.rooms where id='t04-room' and archived_at is not null) then
    raise exception 'T06 room archive did not persist';
  end if;
  if not exists (
    select 1
    from public.schedule_versions sv
    join public.assignments a on a.schedule_version_id=sv.id and a.session_id='t04-session'
    join public.class_sessions s on s.id=a.session_id
    join public.class_definitions c on c.id=s.class_id
    join public.teachers t on t.id=a.teacher_id
    join public.rooms r on r.id=a.room_id
    where sv.studio_id='11111111-1111-4111-8111-111111111111'
      and s.archived_at is not null
      and c.archived_at is not null
      and t.archived_at is not null
      and r.archived_at is not null
  ) then
    raise exception 'T06 archived identities no longer resolve through historical schedule assignments';
  end if;
end
$block$;

-- With the only class/session archived, an empty candidate is complete. Trying to
-- reintroduce that archived session must reject atomically.
set role postgres;
do $block$
declare
  v_studio uuid := '11111111-1111-4111-8111-111111111111';
  v_owner uuid := '10000000-0000-4000-8000-000000000001';
  v_schedule public.schedule_versions%rowtype;
  v_rulebook integer;
  v_enforcement integer;
  v_planning integer;
  v_constraint integer;
  v_result jsonb;
  v_before_count integer;
  v_after_count integer;
  v_rejected boolean := false;
begin
  select * into v_schedule from public.schedule_versions where studio_id=v_studio and is_current;
  select version into v_rulebook from public.rulebook_versions where studio_id=v_studio and status='CURRENT';
  select version into v_enforcement from public.rule_enforcement_versions where studio_id=v_studio and status='CURRENT';
  select version into v_planning from public.planning_dataset_versions where studio_id=v_studio and status='CURRENT';
  select version into v_constraint from public.constraint_model_versions where studio_id=v_studio and status='CURRENT' and complete_hard_constraint_compilation=true;

  v_result := public.adopt_solver_candidate_v33(
    v_studio,v_owner,'T06 integration actor','Adopt empty active inventory after archive',
    v_schedule.version,v_rulebook,v_enforcement,v_planning,v_constraint,
    '[]'::jsonb,'{"valid":true,"hardViolations":0}'::jsonb
  );
  if (v_result->>'assignmentCount')::integer <> 0 then
    raise exception 'T06 archived session was still counted as active completeness';
  end if;
  if exists (
    select 1 from public.assignments a
    join public.schedule_versions sv on sv.id=a.schedule_version_id
    where sv.studio_id=v_studio and sv.is_current
  ) then
    raise exception 'T06 empty active candidate persisted an archived assignment';
  end if;

  select count(*) into v_before_count from public.schedule_versions where studio_id=v_studio;
  begin
    perform public.adopt_solver_candidate_v33(
      v_studio,v_owner,'T06 integration actor','Reject archived session reintroduction',
      (v_result->>'scheduleVersion')::integer,v_rulebook,v_enforcement,v_planning,v_constraint,
      jsonb_build_array(jsonb_build_object(
        'sessionId','t04-session','day','Monday','startTime','17:00','endTime','18:30',
        'teacherId','t04-teacher','roomId','t04-room'
      )),
      '{"valid":true,"hardViolations":0}'::jsonb
    );
  exception when others then
    if position('CANDIDATE_SESSION_SET_MISMATCH' in sqlerrm)=0 then raise; end if;
    v_rejected:=true;
  end;
  if not v_rejected then raise exception 'T06 archived session candidate was accepted'; end if;
  select count(*) into v_after_count from public.schedule_versions where studio_id=v_studio;
  if v_after_count<>v_before_count then raise exception 'T06 archived-session rejection was not atomic'; end if;
end
$block$;
reset role;

-- Restore the class/session first, leaving teacher and room archived. This makes
-- the session an active completeness obligation while proving archived resources
-- cannot be used to satisfy it.
set role authenticated;
select public.set_planning_entity_archive_v40(
  'CLASS','t04-class',false,'T06 restore class lifecycle',
  (select version from public.planning_dataset_versions where studio_id='11111111-1111-4111-8111-111111111111' and status='CURRENT')
);
set role postgres;
select public.confirm_current_planning_dataset_v39(
  version,snapshot_hash,'T06 confirmed class restore with resources still archived',
  '{"peopleInventoryReviewed":true,"classSessionCatalogReviewed":true,"classRostersReviewed":true,"sourceAndCompletenessReviewed":true}'::jsonb
)
from public.planning_dataset_versions
where studio_id='11111111-1111-4111-8111-111111111111' and status='CURRENT';
reset role;

set role postgres;
do $block$
declare
  v_studio uuid := '11111111-1111-4111-8111-111111111111';
  v_owner uuid := '10000000-0000-4000-8000-000000000001';
  v_schedule public.schedule_versions%rowtype;
  v_rulebook integer;
  v_enforcement integer;
  v_planning integer;
  v_constraint integer;
  v_before_count integer;
  v_after_count integer;
  v_rejected boolean := false;
begin
  select * into v_schedule from public.schedule_versions where studio_id=v_studio and is_current;
  select version into v_rulebook from public.rulebook_versions where studio_id=v_studio and status='CURRENT';
  select version into v_enforcement from public.rule_enforcement_versions where studio_id=v_studio and status='CURRENT';
  select version into v_planning from public.planning_dataset_versions where studio_id=v_studio and status='CURRENT';
  select version into v_constraint from public.constraint_model_versions where studio_id=v_studio and status='CURRENT' and complete_hard_constraint_compilation=true;
  select count(*) into v_before_count from public.schedule_versions where studio_id=v_studio;

  begin
    perform public.adopt_solver_candidate_v33(
      v_studio,v_owner,'T06 integration actor','Reject archived teacher and room',
      v_schedule.version,v_rulebook,v_enforcement,v_planning,v_constraint,
      jsonb_build_array(jsonb_build_object(
        'sessionId','t04-session','day','Monday','startTime','17:00','endTime','18:30',
        'teacherId','t04-teacher','roomId','t04-room'
      )),
      '{"valid":true,"hardViolations":0}'::jsonb
    );
  exception when others then
    if position('CANDIDATE_INVALID_ASSIGNMENTS' in sqlerrm)=0 then raise; end if;
    v_rejected:=true;
  end;
  if not v_rejected then raise exception 'T06 archived teacher/room candidate was accepted'; end if;
  select count(*) into v_after_count from public.schedule_versions where studio_id=v_studio;
  if v_after_count<>v_before_count then raise exception 'T06 archived resource rejection was not atomic'; end if;
end
$block$;
reset role;

-- Complete the restore, reconfirm that exact Planning Dataset, and prove the same
-- session can be adopted exactly once again.
set role authenticated;
select public.set_planning_entity_archive_v40(
  'TEACHER','t04-teacher',false,'T06 restore teacher lifecycle',
  (select version from public.planning_dataset_versions where studio_id='11111111-1111-4111-8111-111111111111' and status='CURRENT')
);
select public.set_planning_entity_archive_v40(
  'ROOM','t04-room',false,'T06 restore room lifecycle',
  (select version from public.planning_dataset_versions where studio_id='11111111-1111-4111-8111-111111111111' and status='CURRENT')
);
set role postgres;
select public.confirm_current_planning_dataset_v39(
  version,snapshot_hash,'T06 reconfirmed fully restored active inventory',
  '{"peopleInventoryReviewed":true,"classSessionCatalogReviewed":true,"classRostersReviewed":true,"sourceAndCompletenessReviewed":true}'::jsonb
)
from public.planning_dataset_versions
where studio_id='11111111-1111-4111-8111-111111111111' and status='CURRENT';
reset role;

set role postgres;
do $block$
declare
  v_studio uuid := '11111111-1111-4111-8111-111111111111';
  v_owner uuid := '10000000-0000-4000-8000-000000000001';
  v_schedule public.schedule_versions%rowtype;
  v_rulebook integer;
  v_enforcement integer;
  v_planning integer;
  v_constraint integer;
  v_result jsonb;
  v_before_count integer;
  v_after_count integer;
  v_rejected boolean := false;
  v_candidate jsonb := jsonb_build_array(jsonb_build_object(
    'sessionId','t04-session','day','Monday','startTime','17:00','endTime','18:30',
    'teacherId','t04-teacher','roomId','t04-room'
  ));
begin
  select * into v_schedule from public.schedule_versions where studio_id=v_studio and is_current;
  select version into v_rulebook from public.rulebook_versions where studio_id=v_studio and status='CURRENT';
  select version into v_enforcement from public.rule_enforcement_versions where studio_id=v_studio and status='CURRENT';
  select version into v_planning from public.planning_dataset_versions where studio_id=v_studio and status='CURRENT';
  select version into v_constraint from public.constraint_model_versions where studio_id=v_studio and status='CURRENT' and complete_hard_constraint_compilation=true;

  v_result := public.adopt_solver_candidate_v33(
    v_studio,v_owner,'T06 integration actor','Adopt restored active inventory',
    v_schedule.version,v_rulebook,v_enforcement,v_planning,v_constraint,
    v_candidate,'{"valid":true,"hardViolations":0}'::jsonb
  );
  if (v_result->>'assignmentCount')::integer <> 1 then
    raise exception 'T06 restored active session was not required exactly once';
  end if;
  if (select count(*) from public.assignments a join public.schedule_versions sv on sv.id=a.schedule_version_id where sv.studio_id=v_studio and sv.is_current and a.session_id='t04-session')<>1 then
    raise exception 'T06 restored active session was not persisted exactly once';
  end if;

  select count(*) into v_before_count from public.schedule_versions where studio_id=v_studio;
  begin
    perform public.adopt_solver_candidate_v33(
      v_studio,v_owner,'T06 integration actor','Reject duplicate active session',
      (v_result->>'scheduleVersion')::integer,v_rulebook,v_enforcement,v_planning,v_constraint,
      v_candidate || v_candidate,'{"valid":true,"hardViolations":0}'::jsonb
    );
  exception when others then
    if position('CANDIDATE_SESSION_SET_MISMATCH' in sqlerrm)=0 then raise; end if;
    v_rejected:=true;
  end;
  if not v_rejected then raise exception 'T06 duplicate session candidate was accepted'; end if;
  select count(*) into v_after_count from public.schedule_versions where studio_id=v_studio;
  if v_after_count<>v_before_count then raise exception 'T06 duplicate rejection was not atomic'; end if;
end
$block$;
reset role;

select 'T06 PASS: archive -> confirm -> adopt excludes archived inventory; archived resources reject; historical identities resolve; restore -> reconfirm -> adopt requires each active session exactly once' as result;
`;

const coherentSolverSnapshotSql = String.raw`
set search_path=public,extensions;
-- Run synthetic concurrent mutations as the disposable database owner.
-- auth.uid() still resolves the deidentified owner claim below, so the
-- member-authorized snapshot RPC exercises its real identity check.
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',false);
do $block$
declare
  v_studio uuid := '11111111-1111-4111-8111-111111111111';
  v_snapshot jsonb;
  v_before jsonb;
  v_after jsonb;
  v_original_description text;
  v_current_schedule uuid;
  v_current_assignment text;
  v_current_count integer;
  v_all_count integer;
begin
  v_snapshot := public.get_solver_snapshot_v43(v_studio);
  v_before := v_snapshot->'contextToken';

  if (v_snapshot->'integrity'->>'planningSnapshotHashValid')::boolean is distinct from true then
    raise exception 'T07 Planning Dataset snapshot hash did not verify';
  end if;
  if (v_snapshot->'integrity'->>'constraintModelSnapshotHashValid')::boolean is distinct from true then
    raise exception 'T07 Constraint Model snapshot hash did not verify';
  end if;
  if (v_snapshot->'planningDatasetVersion'->>'snapshot_hash') is distinct from (v_before->>'planningSnapshotHash') then
    raise exception 'T07 planning row/hash token mismatch';
  end if;
  if v_snapshot ? 'teachers' or v_snapshot ? 'rooms' or v_snapshot ? 'classes' then
    raise exception 'T07 snapshot RPC leaked mutable planning tables instead of the PlanningDatasetVersion snapshot';
  end if;

  select id into v_current_schedule from public.schedule_versions where studio_id=v_studio and is_current;
  select count(*) into v_current_count from public.assignments where studio_id=v_studio and schedule_version_id=v_current_schedule;
  select count(*) into v_all_count from public.assignments where studio_id=v_studio;
  if jsonb_array_length(v_snapshot->'currentAssignments') <> v_current_count then
    raise exception 'T07 current-assignment snapshot count mismatch';
  end if;
  if exists (
    select 1 from jsonb_array_elements(v_snapshot->'currentAssignments') item
    where item->>'schedule_version_id' is distinct from v_current_schedule::text
  ) then
    raise exception 'T07 snapshot included a historical ScheduleVersion assignment';
  end if;
  if v_all_count <= v_current_count then
    raise exception 'T07 fixture did not contain historical assignments needed to prove exclusion';
  end if;

  select description into v_original_description from public.rules where studio_id=v_studio and id='OPS-002';
  update public.rules set description=description||' [T07 transient policy drift]' where studio_id=v_studio and id='OPS-002';
  v_after := public.get_solver_context_token_v43(v_studio);
  if v_after = v_before or v_after->>'rulesHash' = v_before->>'rulesHash' then
    raise exception 'T07 policy mutation did not invalidate the coherent context token';
  end if;
  update public.rules set description=v_original_description where studio_id=v_studio and id='OPS-002';

  select a.id into v_current_assignment
  from public.assignments a where a.studio_id=v_studio and a.schedule_version_id=v_current_schedule
  order by a.id limit 1;
  if v_current_assignment is null then raise exception 'T07 fixture has no current assignment'; end if;
  v_before := public.get_solver_context_token_v43(v_studio);
  update public.assignments set locked=not locked where studio_id=v_studio and id=v_current_assignment;
  v_after := public.get_solver_context_token_v43(v_studio);
  if v_after = v_before or v_after->>'scheduleAssignmentsHash' = v_before->>'scheduleAssignmentsHash' then
    raise exception 'T07 lock/assignment mutation did not invalidate the coherent context token';
  end if;
  update public.assignments set locked=not locked where studio_id=v_studio and id=v_current_assignment;
end
$block$;
reset role;

select 'T07 PASS: one coherent snapshot uses pinned planning facts/current assignments only; policy and lock/schedule drift invalidate the context token' as result;
`;


const candidateStaleBindingSql = String.raw`
set search_path=public,extensions;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',false);
select set_config(
  't08.reviewed_context',
  private.build_solver_candidate_context_v44('11111111-1111-4111-8111-111111111111')::text,
  false
);
set role postgres;
do $block$
declare
  v_studio uuid := '11111111-1111-4111-8111-111111111111';
  v_owner uuid := '10000000-0000-4000-8000-000000000001';
  v_editor uuid := '10000000-0000-4000-8000-000000000002';
  v_reviewed jsonb;
  v_current jsonb;
  v_candidate jsonb := jsonb_build_array(jsonb_build_object(
    'sessionId','t04-session','day','Monday','startTime','17:00','endTime','18:30',
    'teacherId','t04-teacher','roomId','t04-room'
  ));
  v_assignment_id text;
  v_result jsonb;
  v_before_count integer;
  v_after_count integer;
  v_lock_rejected boolean := false;
  v_editor_rejected boolean := false;
  v_double_rejected boolean := false;
begin
  v_reviewed:=current_setting('t08.reviewed_context')::jsonb;
  if v_reviewed->>'schemaVersion'<>'1.0'
     or coalesce(v_reviewed->'solverContextToken'->>'scheduleId','')=''
     or coalesce(v_reviewed->'solverContextToken'->>'scheduleAssignmentsHash','')='' then
    raise exception 'T08 reviewed context did not bind base ScheduleVersion/lock identity';
  end if;

  select a.id into v_assignment_id
  from public.assignments a
  join public.schedule_versions sv on sv.id=a.schedule_version_id
  where sv.studio_id=v_studio and sv.is_current
  order by a.id limit 1;
  if v_assignment_id is null then raise exception 'T08 fixture has no current assignment'; end if;

  -- Same ScheduleVersion, same Rulebook/Planning versions, different lock bit.
  update public.assignments set locked=not locked where studio_id=v_studio and id=v_assignment_id;
  begin
    perform public.adopt_solver_candidate_v44(
      v_studio,v_owner,'T08 owner','Reject stale candidate after lock drift',
      v_reviewed,v_candidate,'{"valid":true,"hardViolations":0}'::jsonb
    );
  exception when others then
    if position('STALE_SOLVER_CANDIDATE_CONTEXT' in sqlerrm)=0 then raise; end if;
    v_lock_rejected:=true;
  end;
  if not v_lock_rejected then raise exception 'T08 lock drift was accepted'; end if;
  update public.assignments set locked=not locked where studio_id=v_studio and id=v_assignment_id;
  v_current:=jsonb_build_object(
    'schemaVersion','1.0',
    'compilerVersion',v_reviewed->>'compilerVersion',
    'solverContextToken',public.get_solver_context_token_v43(v_studio)
  );
  if v_current is distinct from v_reviewed then
    raise exception 'T08 lock drift fixture did not restore the reviewed context';
  end if;

  select count(*) into v_before_count from public.schedule_versions where studio_id=v_studio;
  v_result:=public.adopt_solver_candidate_v44(
    v_studio,v_owner,'T08 owner','Adopt exact reviewed base once',
    v_reviewed,v_candidate,'{"valid":true,"hardViolations":0}'::jsonb
  );
  if (v_result->>'scheduleVersion')::integer<>(v_reviewed->'solverContextToken'->>'scheduleVersion')::integer+1 then
    raise exception 'T08 exact reviewed context did not adopt the next schedule version';
  end if;

  -- A second editor may have reviewed the same candidate concurrently. The first
  -- commit changes only the schedule pointer; Rulebook/Planning can remain equal.
  begin
    perform public.adopt_solver_candidate_v44(
      v_studio,v_editor,'T08 concurrent editor','Reject concurrent editor stale review',
      v_reviewed,v_candidate,'{"valid":true,"hardViolations":0}'::jsonb
    );
  exception when others then
    if position('STALE_SOLVER_CANDIDATE_CONTEXT' in sqlerrm)=0 then raise; end if;
    v_editor_rejected:=true;
  end;
  if not v_editor_rejected then raise exception 'T08 concurrent editor stale review was accepted'; end if;

  -- Repeated/double adoption of the same reviewed artifact must also fail.
  begin
    perform public.adopt_solver_candidate_v44(
      v_studio,v_owner,'T08 owner','Reject double adoption',
      v_reviewed,v_candidate,'{"valid":true,"hardViolations":0}'::jsonb
    );
  exception when others then
    if position('STALE_SOLVER_CANDIDATE_CONTEXT' in sqlerrm)=0 then raise; end if;
    v_double_rejected:=true;
  end;
  if not v_double_rejected then raise exception 'T08 double adoption was accepted'; end if;

  select count(*) into v_after_count from public.schedule_versions where studio_id=v_studio;
  if v_after_count<>v_before_count+1 then
    raise exception 'T08 stale/repeated rejection was not atomic';
  end if;
  v_current:=jsonb_build_object(
    'schemaVersion','1.0',
    'compilerVersion',v_reviewed->>'compilerVersion',
    'solverContextToken',public.get_solver_context_token_v43(v_studio)
  );
  if v_current->'solverContextToken'->>'rulebookVersion' is distinct from v_reviewed->'solverContextToken'->>'rulebookVersion'
     or v_current->'solverContextToken'->>'planningDatasetVersion' is distinct from v_reviewed->'solverContextToken'->>'planningDatasetVersion' then
    raise exception 'T08 fixture unexpectedly changed Rulebook/Planning while testing schedule staleness';
  end if;
  if v_current->'solverContextToken'->>'scheduleVersion' = v_reviewed->'solverContextToken'->>'scheduleVersion' then
    raise exception 'T08 successful adoption did not advance ScheduleVersion';
  end if;
end
$block$;
reset role;

select 'T08 PASS: exact reviewed context adopts once; same-version lock drift, concurrent editor stale review, and double adoption reject atomically without fresh-version substitution' as result;
`;

const sessionSpecificLockAdoptionSql = String.raw`
set search_path=public,extensions;

do $block$
declare
  v_studio uuid := '11111111-1111-4111-8111-111111111111';
  v_owner uuid := '10000000-0000-4000-8000-000000000001';
  v_schedule public.schedule_versions%rowtype;
  v_context jsonb;
  v_candidate jsonb;
  v_moved jsonb;
  v_result jsonb;
  v_before_count integer;
  v_after_count integer;
  v_rejected boolean := false;
begin
  select * into v_schedule from public.schedule_versions where studio_id=v_studio and is_current;
  update public.assignments
  set locked=true
  where schedule_version_id=v_schedule.id and session_id='t04-session';
  if not found then raise exception 'T09 fixture has no current t04 assignment to lock'; end if;
  if exists(select 1 from public.class_sessions where id='t04-session' and locked=true) then
    raise exception 'T09 fixture requires an assignment-only lock to prove OR precedence';
  end if;

  select jsonb_build_array(jsonb_build_object(
    'sessionId',a.session_id,
    'day',a.day,
    'startTime',to_char(a.start_time,'HH24:MI'),
    'endTime',to_char(a.end_time,'HH24:MI'),
    'teacherId',a.teacher_id,
    'roomId',a.room_id
  )) into v_candidate
  from public.assignments a
  where a.schedule_version_id=v_schedule.id and a.session_id='t04-session';

  v_context := private.build_solver_candidate_context_v44(v_studio);
  v_result := public.adopt_solver_candidate_v44(
    v_studio,v_owner,'T09 integration actor','Preserve assignment-only runtime lock',
    v_context,v_candidate,'{"valid":true,"hardViolations":0}'::jsonb
  );

  if v_result->>'runtimeLockPrecedence' is distinct from 'SESSION_OR_ASSIGNMENT' then
    raise exception 'T09 canonical adoption did not report effective lock precedence';
  end if;
  if not exists (
    select 1 from public.assignments a
    join public.schedule_versions sv on sv.id=a.schedule_version_id
    where sv.studio_id=v_studio and sv.is_current and a.session_id='t04-session' and a.locked=true
  ) then
    raise exception 'T09 assignment-only lock was lost during adoption';
  end if;
  if exists(select 1 from public.class_sessions where id='t04-session' and locked=true) then
    raise exception 'T09 adoption incorrectly converted assignment-only lock into planning-session lock';
  end if;

  select * into v_schedule from public.schedule_versions where studio_id=v_studio and is_current;
  v_context := private.build_solver_candidate_context_v44(v_studio);
  select jsonb_build_array(jsonb_build_object(
    'sessionId',a.session_id,
    'day',a.day,
    'startTime',to_char(a.start_time + interval '15 minutes','HH24:MI'),
    'endTime',to_char(a.end_time + interval '15 minutes','HH24:MI'),
    'teacherId',a.teacher_id,
    'roomId',a.room_id
  )) into v_moved
  from public.assignments a
  where a.schedule_version_id=v_schedule.id and a.session_id='t04-session';

  select count(*) into v_before_count from public.schedule_versions where studio_id=v_studio;
  begin
    perform public.adopt_solver_candidate_v44(
      v_studio,v_owner,'T09 integration actor','Reject movement of assignment-only runtime lock',
      v_context,v_moved,'{"valid":true,"hardViolations":0}'::jsonb
    );
  exception when others then
    if position('LOCKED_SESSION_PLACEMENT_CHANGED' in sqlerrm)=0 then raise; end if;
    v_rejected:=true;
  end;
  if not v_rejected then raise exception 'T09 moved assignment-only lock was accepted'; end if;
  select count(*) into v_after_count from public.schedule_versions where studio_id=v_studio;
  if v_after_count<>v_before_count then raise exception 'T09 locked-placement rejection was not atomic'; end if;
end
$block$;

select 'T09 PASS: assignment OR session lock precedence survives reviewed adoption; assignment-only lock persists and movement rejects atomically' as result;
`;

const authoritativeManualMoveSql = String.raw`
set search_path=public,extensions;

-- T09 intentionally leaves the current assignment locked. T10 starts from a
-- legal unlocked current placement so its own transaction can exercise MOVE.
update public.assignments a
set locked=false
from public.schedule_versions sv
where sv.id=a.schedule_version_id
  and sv.studio_id='11111111-1111-4111-8111-111111111111'
  and sv.is_current
  and a.session_id='t04-session';

-- Give the same actor a second lower-priority membership. T10 must reject that
-- selected tenant instead of allowing V2.5 to silently choose the owner's first
-- legacy membership.
insert into public.studios(id,slug,name)
values ('22222222-2222-4222-8222-222222222222','t10-other-studio','T10 Other Studio')
on conflict(id) do nothing;
insert into public.studio_members(studio_id,user_id,role)
values ('22222222-2222-4222-8222-222222222222','10000000-0000-4000-8000-000000000001','EDITOR')
on conflict(studio_id,user_id) do update set role=excluded.role;

create or replace function public.t10_test_solver_context(p_studio_id uuid)
returns jsonb
language sql
security definer
set search_path=''
as $$ select private.build_solver_context_token_v43(p_studio_id) $$;
revoke all on function public.t10_test_solver_context(uuid) from public,anon,authenticated;
grant execute on function public.t10_test_solver_context(uuid) to service_role;

set role service_role;
do $block$
declare
  v_studio uuid := '11111111-1111-4111-8111-111111111111';
  v_other uuid := '22222222-2222-4222-8222-222222222222';
  v_owner uuid := '10000000-0000-4000-8000-000000000001';
  v_assignment_id text;
  v_context jsonb;
  v_result jsonb;
  v_before_count integer;
  v_after_count integer;
  v_stale_rejected boolean := false;
  v_workspace_rejected boolean := false;
  v_locked_rejected boolean := false;
begin
  select a.id into v_assignment_id
  from public.assignments a
  join public.schedule_versions sv on sv.id=a.schedule_version_id
  where sv.studio_id=v_studio and sv.is_current and a.session_id='t04-session';
  if v_assignment_id is null then raise exception 'T10 current assignment for stable session t04-session is missing'; end if;
  v_context:=public.t10_test_solver_context(v_studio);
  select count(*) into v_before_count from public.schedule_versions where studio_id=v_studio;

  v_result:=public.apply_authoritative_move_v46(
    v_studio,v_owner,v_assignment_id,
    '{"day":"Monday","startTime":"17:15","teacherId":"t04-teacher","roomId":"t04-room","status":"NORMAL"}'::jsonb,
    'T10 valid authoritative manual move',v_context,
    '{"valid":true,"hardViolations":0,"unsupportedConstraintIds":[]}'::jsonb,false
  );
  if (v_result->>'scheduleVersion')::integer<>(v_context->>'scheduleVersion')::integer+1 then
    raise exception 'T10 valid move did not advance exactly one ScheduleVersion';
  end if;
  if v_result->>'authority' is distinct from 'SERVER_CONSTRAINT_IR_V46' then
    raise exception 'T10 result did not identify authoritative IR boundary';
  end if;
  if not exists (
    select 1 from public.assignments a
    join public.schedule_versions sv on sv.id=a.schedule_version_id
    where sv.studio_id=v_studio and sv.is_current and a.id=v_assignment_id
      and a.start_time='17:15'::time and a.end_time='18:45'::time
  ) then
    raise exception 'T10 valid move did not derive/persist the canonical 90-minute interval';
  end if;
  if not exists (
    select 1 from public.schedule_versions sv
    where sv.studio_id=v_studio and sv.is_current
      and sv.constraint_model_version=(v_context->>'constraintModelVersion')::integer
  ) then
    raise exception 'T10 move lost the pinned ConstraintModelVersion link';
  end if;
  if not exists (
    select 1 from public.audit_events e
    where e.studio_id=v_studio and e.action='SCHEDULE_COMMAND' and e.entity_id=v_assignment_id
      and e.payload->>'authority'='SERVER_CONSTRAINT_IR_V46'
      and (e.payload->>'authoritativeConstraintIr')::boolean=true
      and e.payload->>'legacyWriteBypassRetirementTask'='T13'
  ) then
    raise exception 'T10 authoritative audit evidence was not recorded';
  end if;

  select count(*) into v_before_count from public.schedule_versions where studio_id=v_studio;
  begin
    perform public.apply_authoritative_move_v46(
      v_studio,v_owner,v_assignment_id,
      '{"day":"Monday","startTime":"17:30","teacherId":"t04-teacher","roomId":"t04-room","status":"NORMAL"}'::jsonb,
      'T10 stale-context rejection',v_context,
      '{"valid":true,"hardViolations":0,"unsupportedConstraintIds":[]}'::jsonb,false
    );
  exception when others then
    if position('STALE_MANUAL_MOVE_CONTEXT' in sqlerrm)=0 then raise; end if;
    v_stale_rejected:=true;
  end;
  if not v_stale_rejected then raise exception 'T10 stale reviewed context was accepted'; end if;
  select count(*) into v_after_count from public.schedule_versions where studio_id=v_studio;
  if v_after_count<>v_before_count then raise exception 'T10 stale-context rejection was not atomic'; end if;

  begin
    perform public.apply_authoritative_move_v46(
      v_other,v_owner,'anything','{}'::jsonb,'T10 wrong selected workspace','{}'::jsonb,'{}'::jsonb,false
    );
  exception when others then
    if position('WORKSPACE_SELECTION_MISMATCH' in sqlerrm)=0 then raise; end if;
    v_workspace_rejected:=true;
  end;
  if not v_workspace_rejected then raise exception 'T10 wrong selected workspace was silently accepted'; end if;

  update public.assignments a set locked=true
  from public.schedule_versions sv
  where sv.id=a.schedule_version_id and sv.studio_id=v_studio and sv.is_current and a.id=v_assignment_id;
  v_context:=public.t10_test_solver_context(v_studio);
  select count(*) into v_before_count from public.schedule_versions where studio_id=v_studio;
  begin
    perform public.apply_authoritative_move_v46(
      v_studio,v_owner,v_assignment_id,
      '{"day":"Monday","startTime":"17:30","teacherId":"t04-teacher","roomId":"t04-room","status":"NORMAL"}'::jsonb,
      'T10 locked rejection',v_context,
      '{"valid":true,"hardViolations":0,"unsupportedConstraintIds":[]}'::jsonb,false
    );
  exception when others then
    if position('LOCKED_ASSIGNMENT' in sqlerrm)=0 then raise; end if;
    v_locked_rejected:=true;
  end;
  if not v_locked_rejected then raise exception 'T10 locked assignment move was accepted'; end if;
  select count(*) into v_after_count from public.schedule_versions where studio_id=v_studio;
  if v_after_count<>v_before_count then raise exception 'T10 locked rejection was not atomic'; end if;
end
$block$;
reset role;
drop function public.t10_test_solver_context(uuid);

select 'T10 PASS: explicit tenant/context guard, duration-derived MOVE, pinned model linkage, audit evidence, and atomic stale/lock rejection' as result;
`;

const authoritativeIncrementalSql = String.raw`
set search_path=public,extensions;

-- T10 leaves the current placement locked as its final rejection witness. T11
-- starts by restoring a movable current placement without changing version data.
update public.assignments a set locked=false
from public.schedule_versions sv
where sv.id=a.schedule_version_id
  and sv.studio_id='11111111-1111-4111-8111-111111111111'
  and sv.is_current
  and a.session_id='t04-session';
update public.class_sessions set locked=false where studio_id='11111111-1111-4111-8111-111111111111' and id='t04-session';
update public.rooms set archived_at=null where studio_id='11111111-1111-4111-8111-111111111111' and id='t04-room';

create or replace function public.t11_test_solver_context(p_studio_id uuid)
returns jsonb
language sql
security definer
set search_path=''
as $$ select private.build_solver_context_token_v43(p_studio_id) $$;
revoke all on function public.t11_test_solver_context(uuid) from public,anon,authenticated;
grant execute on function public.t11_test_solver_context(uuid) to service_role;

set role service_role;
do $block$
declare
  v_studio uuid := '11111111-1111-4111-8111-111111111111';
  v_owner uuid := '10000000-0000-4000-8000-000000000001';
  v_assignment text;
  v_context jsonb;
  v_result jsonb;
  v_before_count integer;
  v_after_count integer;
  v_retry_rejected boolean := false;
begin
  select a.id into v_assignment
  from public.assignments a join public.schedule_versions sv on sv.id=a.schedule_version_id
  where sv.studio_id=v_studio and sv.is_current and a.session_id='t04-session';
  if v_assignment is null then raise exception 'T11 fixture current t04 assignment is missing'; end if;
  v_context:=public.t11_test_solver_context(v_studio);
  select count(*) into v_before_count from public.schedule_versions where studio_id=v_studio;
  v_result:=public.apply_authoritative_incremental_command_v47(
    'UNASSIGN',v_studio,v_owner,v_assignment,'t04-session','{}'::jsonb,
    'T11 valid unassign',v_context,
    '{"valid":true,"hardViolations":0,"violations":[],"unsupportedConstraintIds":[]}'::jsonb,
    '{"mode":"NORMAL","scheduleComplete":false,"publishable":false,"unscheduledSessionIds":["t04-session"],"duplicateSessionIds":[],"unknownAssignmentSessionIds":[],"completenessObligationKeys":[]}'::jsonb,false
  );
  if (v_result->>'scheduleVersion')::integer<>(v_context->>'scheduleVersion')::integer+1 then raise exception 'T11 UNASSIGN did not advance one version'; end if;
  if exists(select 1 from public.assignments a join public.schedule_versions sv on sv.id=a.schedule_version_id where sv.studio_id=v_studio and sv.is_current and a.session_id='t04-session') then
    raise exception 'T11 UNASSIGN did not remove the current placement';
  end if;
  if coalesce((v_result->'validation'->>'scheduleComplete')::boolean,true) then raise exception 'T11 partial schedule was incorrectly marked complete'; end if;
  begin
    perform public.apply_authoritative_incremental_command_v47(
      'UNASSIGN',v_studio,v_owner,v_assignment,'t04-session','{}'::jsonb,
      'T11 stale retry',v_context,'{}'::jsonb,'{}'::jsonb,false
    );
  exception when others then
    if position('STALE_INCREMENTAL_CONTEXT' in sqlerrm)=0 then raise; end if;
    v_retry_rejected:=true;
  end;
  if not v_retry_rejected then raise exception 'T11 stale retry was accepted'; end if;
  select count(*) into v_after_count from public.schedule_versions where studio_id=v_studio;
  if v_after_count<>v_before_count+1 then raise exception 'T11 stale retry was not atomic'; end if;
end
$block$;
reset role;

-- Bypass governed archive bookkeeping only inside this disposable fixture so the
-- exact context stays stable and V4.7's active-row defense is exercised directly.
update public.rooms set archived_at=now() where studio_id='11111111-1111-4111-8111-111111111111' and id='t04-room';
update public.schedule_versions
set planning_dataset_version=(
  select pd.version from public.planning_dataset_versions pd
  where pd.studio_id='11111111-1111-4111-8111-111111111111' and pd.status='CURRENT'
  order by pd.version desc limit 1
)
where studio_id='11111111-1111-4111-8111-111111111111' and is_current;
set role service_role;
do $block$
declare
  v_studio uuid := '11111111-1111-4111-8111-111111111111';
  v_owner uuid := '10000000-0000-4000-8000-000000000001';
  v_context jsonb := public.t11_test_solver_context(v_studio);
  v_before_count integer;
  v_after_count integer;
  v_rejected boolean := false;
begin
  select count(*) into v_before_count from public.schedule_versions where studio_id=v_studio;
  begin
    perform public.apply_authoritative_incremental_command_v47(
      'ASSIGN',v_studio,v_owner,'t11-archived-room','t04-session',
      '{"day":"Monday","startTime":"17:15","teacherId":"t04-teacher","roomId":"t04-room","status":"NORMAL"}'::jsonb,
      'T11 archived room rejection',v_context,'{}'::jsonb,
      '{"mode":"NORMAL","scheduleComplete":true,"publishable":true,"unscheduledSessionIds":[],"duplicateSessionIds":[],"unknownAssignmentSessionIds":[],"completenessObligationKeys":[]}'::jsonb,false
    );
  exception when others then
    if position('ARCHIVED_OR_UNKNOWN_ROOM' in sqlerrm)=0 then raise; end if;
    v_rejected:=true;
  end;
  if not v_rejected then raise exception 'T11 archived room was accepted'; end if;
  select count(*) into v_after_count from public.schedule_versions where studio_id=v_studio;
  if v_after_count<>v_before_count then raise exception 'T11 archived-target rejection was not atomic'; end if;
end
$block$;
reset role;
update public.rooms set archived_at=null where studio_id='11111111-1111-4111-8111-111111111111' and id='t04-room';
update public.schedule_versions
set planning_dataset_version=(
  select pd.version from public.planning_dataset_versions pd
  where pd.studio_id='11111111-1111-4111-8111-111111111111' and pd.status='CURRENT'
  order by pd.version desc limit 1
)
where studio_id='11111111-1111-4111-8111-111111111111' and is_current;

set role service_role;
do $block$
declare
  v_studio uuid := '11111111-1111-4111-8111-111111111111';
  v_owner uuid := '10000000-0000-4000-8000-000000000001';
  v_context jsonb;
  v_result jsonb;
  v_before_count integer;
  v_after_count integer;
  v_duplicate_rejected boolean := false;
  v_unknown_rejected boolean := false;
begin
  v_context:=public.t11_test_solver_context(v_studio);
  v_result:=public.apply_authoritative_incremental_command_v47(
    'ASSIGN',v_studio,v_owner,'t11-assignment','t04-session',
    '{"day":"Monday","startTime":"17:15","teacherId":"t04-teacher","roomId":"t04-room","status":"NORMAL"}'::jsonb,
    'T11 valid assign',v_context,
    '{"valid":true,"hardViolations":0,"violations":[],"unsupportedConstraintIds":[]}'::jsonb,
    '{"mode":"NORMAL","scheduleComplete":true,"publishable":true,"unscheduledSessionIds":[],"duplicateSessionIds":[],"unknownAssignmentSessionIds":[],"completenessObligationKeys":[]}'::jsonb,false
  );
  if not exists(
    select 1 from public.assignments a join public.schedule_versions sv on sv.id=a.schedule_version_id
    where sv.studio_id=v_studio and sv.is_current and a.id='t11-assignment'
      and a.start_time='17:15'::time and a.end_time='18:45'::time
  ) then raise exception 'T11 ASSIGN did not persist canonical 90-minute interval'; end if;
  if not exists(
    select 1 from public.schedule_versions sv where sv.studio_id=v_studio and sv.is_current
      and sv.constraint_model_version=(v_context->>'constraintModelVersion')::integer
  ) then raise exception 'T11 ASSIGN lost pinned ConstraintModelVersion'; end if;
  if not exists(
    select 1 from public.audit_events e where e.studio_id=v_studio and e.action='SCHEDULE_COMMAND' and e.entity_id='t11-assignment'
      and e.payload->>'authority'='SERVER_CONSTRAINT_IR_V47' and (e.payload->>'authoritativeConstraintIr')::boolean=true
  ) then raise exception 'T11 authoritative audit evidence missing'; end if;

  v_context:=public.t11_test_solver_context(v_studio);
  select count(*) into v_before_count from public.schedule_versions where studio_id=v_studio;
  begin
    perform public.apply_authoritative_incremental_command_v47(
      'ASSIGN',v_studio,v_owner,'t11-duplicate','t04-session',
      '{"day":"Monday","startTime":"18:45","teacherId":"t04-teacher","roomId":"t04-room","status":"NORMAL"}'::jsonb,
      'T11 duplicate session rejection',v_context,'{}'::jsonb,'{}'::jsonb,false
    );
  exception when others then
    if position('SESSION_ALREADY_ASSIGNED' in sqlerrm)=0 then raise; end if;
    v_duplicate_rejected:=true;
  end;
  if not v_duplicate_rejected then raise exception 'T11 duplicate session was accepted'; end if;

  begin
    perform public.apply_authoritative_incremental_command_v47(
      'ASSIGN',v_studio,v_owner,'t11-unknown','does-not-exist',
      '{"day":"Monday","startTime":"18:45","teacherId":"t04-teacher","roomId":"t04-room","status":"NORMAL"}'::jsonb,
      'T11 unknown session rejection',v_context,'{}'::jsonb,'{}'::jsonb,false
    );
  exception when others then
    if position('ARCHIVED_OR_UNKNOWN_SESSION' in sqlerrm)=0 then raise; end if;
    v_unknown_rejected:=true;
  end;
  if not v_unknown_rejected then raise exception 'T11 unknown session was accepted'; end if;
  select count(*) into v_after_count from public.schedule_versions where studio_id=v_studio;
  if v_after_count<>v_before_count then raise exception 'T11 duplicate/unknown rejection was not atomic'; end if;
end
$block$;
reset role;

update public.assignments a set locked=true
from public.schedule_versions sv
where sv.id=a.schedule_version_id and sv.studio_id='11111111-1111-4111-8111-111111111111' and sv.is_current and a.id='t11-assignment';
set role service_role;
do $block$
declare
  v_studio uuid := '11111111-1111-4111-8111-111111111111';
  v_owner uuid := '10000000-0000-4000-8000-000000000001';
  v_context jsonb := public.t11_test_solver_context(v_studio);
  v_before_count integer;
  v_after_count integer;
  v_rejected boolean := false;
begin
  select count(*) into v_before_count from public.schedule_versions where studio_id=v_studio;
  begin
    perform public.apply_authoritative_incremental_command_v47(
      'UNASSIGN',v_studio,v_owner,'t11-assignment','t04-session','{}'::jsonb,
      'T11 locked unassign rejection',v_context,'{}'::jsonb,'{}'::jsonb,false
    );
  exception when others then
    if position('LOCKED_ASSIGNMENT' in sqlerrm)=0 then raise; end if;
    v_rejected:=true;
  end;
  if not v_rejected then raise exception 'T11 locked assignment was unassigned'; end if;
  select count(*) into v_after_count from public.schedule_versions where studio_id=v_studio;
  if v_after_count<>v_before_count then raise exception 'T11 locked rejection was not atomic'; end if;
end
$block$;
reset role;
update public.assignments a set locked=false
from public.schedule_versions sv
where sv.id=a.schedule_version_id and sv.studio_id='11111111-1111-4111-8111-111111111111' and sv.is_current and a.id='t11-assignment';

drop function public.t11_test_solver_context(uuid);
select 'T11 PASS: server-authoritative ASSIGN/UNASSIGN persist canonical duration; stale retry, archived/unknown/duplicate targets, and locks reject atomically' as result;
`;

function psqlResult(container, user, sql, database = 'postgres') {
  return runProcess(
    'docker',
    ['exec', '-i', container, 'psql', '-X', '-v', 'ON_ERROR_STOP=1', '-h', '127.0.0.1', '-U', user, '-d', database, '-f', '-'],
    sql,
  );
}

function psql(container, user, sql, label, database = 'postgres') {
  const result = psqlResult(container, user, sql, database);
  if (result.status !== 0) {
    throw new DatabaseHarnessError(`${label} failed:\n${outputFor(result)}`);
  }
  return outputFor(result);
}

function transaction(sql) {
  return `begin;\n${sql}\ncommit;\n`;
}

function applyFile(container, file, kind) {
  const name = path.basename(file);
  const sql = readFileSync(file, 'utf8');
  process.stdout.write(`Applying ${kind} migration ${name}\n`);
  return psql(container, 'postgres', transaction(sql), `${kind} migration ${name}`);
}

const ops01CanonicalSummarySql = String.raw`
select jsonb_build_object(
  'studios', (select jsonb_build_object(
    'count', count(*)::integer,
    'hash', md5(coalesce(string_agg(concat_ws('|',id::text,slug,name), E'\n' order by id),''))
  ) from public.studios),
  'rulebookVersions', (select jsonb_build_object(
    'count', count(*)::integer,
    'hash', md5(coalesce(string_agg(concat_ws('|',studio_id::text,version::text,coalesce(source_hash,'')), E'\n' order by studio_id,version),''))
  ) from public.rulebook_versions),
  'planningDatasetVersions', (select jsonb_build_object(
    'count', count(*)::integer,
    'hash', md5(coalesce(string_agg(concat_ws('|',studio_id::text,version::text,coalesce(snapshot_hash,'')), E'\n' order by studio_id,version),''))
  ) from public.planning_dataset_versions),
  'constraintModelVersions', (select jsonb_build_object(
    'count', count(*)::integer,
    'hash', md5(coalesce(string_agg(concat_ws('|',studio_id::text,version::text,coalesce(snapshot_hash,'')), E'\n' order by studio_id,version),''))
  ) from public.constraint_model_versions),
  'scheduleVersions', (select jsonb_build_object(
    'count', count(*)::integer,
    'hash', md5(coalesce(string_agg(concat_ws('|',studio_id::text,version::text,is_current::text,rulebook_version::text,planning_dataset_version::text,constraint_model_version::text), E'\n' order by studio_id,version),''))
  ) from public.schedule_versions),
  'currentSchedules', (select coalesce(jsonb_agg(jsonb_build_object('studioId',studio_id::text,'id',id::text,'version',version) order by studio_id,version),'[]'::jsonb) from public.schedule_versions where is_current),
  'assignments', (select jsonb_build_object(
    'count', count(*)::integer,
    'hash', md5(coalesce(string_agg(concat_ws('|',a.studio_id::text,a.schedule_version_id::text,a.id,a.session_id,a.day,a.start_time::text,a.end_time::text,a.teacher_id,a.room_id,a.locked::text,a.status), E'\n' order by a.studio_id,a.schedule_version_id,a.id),''))
  ) from public.assignments a)
)::text;
`;

function psqlScalar(container, user, sql, label, database = 'postgres') {
  const output = psql(
    container,
    user,
    `\\pset format unaligned\n\\pset tuples_only on\n${sql}`,
    label,
    database,
  );
  const lines = output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (!lines.length) throw new DatabaseHarnessError(`${label} returned no scalar result.`);
  return lines.at(-1);
}

function dumpDatabase(container, database) {
  const result = runProcess('docker', [
    'exec', container, 'pg_dump',
    '--format=plain',
    '--no-owner',
    '--no-privileges',
    '--no-comments',
    '--host', '127.0.0.1',
    '--username', 'postgres',
    '--dbname', database,
  ]);
  if (result.status !== 0) throw new DatabaseHarnessError(`Disposable backup export failed:\n${outputFor(result)}`);
  return result.stdout;
}

function runOps01RestoreRehearsal(container) {
  const database = `ops01_restore_${process.pid}_${Math.random().toString(36).slice(2, 8)}`;
  let databaseCreated = false;
  try {
    const sourceSummary = psqlScalar(container, 'postgres', ops01CanonicalSummarySql, 'OPS-01 source reconciliation summary');
    process.stdout.write('OPS-01: exporting ephemeral disposable pg_dump\n');
    const dump = dumpDatabase(container, 'postgres');

    psql(container, 'postgres', `drop database if exists ${database};\ncreate database ${database};`, 'OPS-01 isolated restore database');
    databaseCreated = true;
    psql(container, 'postgres', dump, 'OPS-01 restore from ephemeral pg_dump', database);
    const restoredSummary = psqlScalar(container, 'postgres', ops01CanonicalSummarySql, 'OPS-01 restored reconciliation summary', database);
    if (JSON.stringify(JSON.parse(sourceSummary)) !== JSON.stringify(JSON.parse(restoredSummary))) {
      throw new DatabaseHarnessError('OPS-01 restore reconciliation failed: canonical version/hash/assignment summaries differ.');
    }
    process.stdout.write('OPS-01: restored canonical version/hash/assignment summaries match\n');

    const rehearsalSchema = `ops01_rehearsal_${process.pid}`;
    const failedObject = `${rehearsalSchema}.failed_migration_object`;
    psql(container, 'postgres', `
create schema ${rehearsalSchema};
create table ${rehearsalSchema}.migration_history(version text primary key);
insert into ${rehearsalSchema}.migration_history(version) values ('baseline');
`, 'OPS-01 migration rollback fixture', database);
    const failedMigration = psqlResult(container, 'postgres', `
begin;
insert into ${rehearsalSchema}.migration_history(version) values ('intentional-failure');
create table ${failedObject}(id integer primary key);
do $failure$
begin
  raise exception 'OPS01 intentional migration failure';
end
$failure$;
commit;
`, database);
    if (failedMigration.status === 0) {
      throw new DatabaseHarnessError('OPS-01 migration rollback fixture unexpectedly succeeded.');
    }
    const rollbackSummary = JSON.parse(psqlScalar(container, 'postgres', `
select jsonb_build_object(
  'historyCount', (select count(*)::integer from ${rehearsalSchema}.migration_history),
  'baselinePresent', exists(select 1 from ${rehearsalSchema}.migration_history where version='baseline'),
  'failedHistoryPresent', exists(select 1 from ${rehearsalSchema}.migration_history where version='intentional-failure'),
  'failedObjectPresent', to_regclass('${failedObject}') is not null
)::text;
`, 'OPS-01 migration rollback assertion', database));
    if (rollbackSummary.historyCount !== 1
      || rollbackSummary.baselinePresent !== true
      || rollbackSummary.failedHistoryPresent !== false
      || rollbackSummary.failedObjectPresent !== false) {
      throw new DatabaseHarnessError('OPS-01 migration rollback changed history or left a failed object behind.');
    }
    psql(container, 'postgres', `drop schema ${rehearsalSchema} cascade;`, 'OPS-01 migration rollback cleanup', database);
    process.stdout.write('OPS-01: failed migration rolled back without history rewrite or residual object\n');
  } finally {
    if (databaseCreated) {
      const result = psqlResult(container, 'postgres', `drop database if exists ${database};`);
      if (result.status !== 0) process.stderr.write(`Warning: OPS-01 restore database cleanup failed: ${outputFor(result)}\n`);
    }
  }
}

async function waitForDatabase(container) {
  for (let attempt = 1; attempt <= 45; attempt += 1) {
    const result = runProcess('docker', ['exec', container, 'pg_isready', '-h', '127.0.0.1', '-U', 'postgres', '-d', 'postgres']);
    if (result.status === 0) return;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new DatabaseHarnessError('PostgreSQL did not become ready within 45 seconds. Check Docker Desktop and retry.');
}

async function runHarness(onlyPol04 = false, onlyOps01 = false) {
  const archiveDirectory = path.join(repoRoot, 'supabase', 'production-ledger');
  const migrationDirectory = path.join(repoRoot, 'supabase', 'migrations');
  const archiveFiles = sqlFiles(archiveDirectory);
  const migrationFiles = sqlFiles(migrationDirectory);
  validateArchiveManifest(archiveFiles);

  const dockerVersion = runProcess('docker', ['version', '--format', '{{.Server.Version}}']);
  if (dockerVersion.status !== 0) {
    throw new DatabaseHarnessError(
      `Docker is installed but its daemon is unavailable. Start Docker Desktop, then rerun npm run test:db.\n${outputFor(dockerVersion)}`,
    );
  }

  const container = `studio-scheduler-db-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
  let running = false;
  try {
    docker([
      'run', '--detach', '--rm', '--name', container,
      '--env', 'POSTGRES_PASSWORD=t02-disposable-only',
      '--env', 'POSTGRES_HOST_AUTH_METHOD=trust',
      postgresImage,
    ]);
    running = true;
    await waitForDatabase(container);

    psql(container, 'postgres', transaction(authVaultShim), 'Supabase auth/vault compatibility shim');
    psql(container, 'postgres', transaction(prepareBootstrap()), 'bootstrap schema');
    psql(container, 'postgres', transaction(compatibilityBridge), 'bootstrap/archive compatibility bridge');

    for (const file of archiveFiles) applyFile(container, file, 'archived');
    for (const file of migrationFiles) {
      if (path.basename(file) === '20260902130713_rulebook_v3_post_review_confirmations.sql') {
        psql(container, 'postgres', transaction(rulebookMigrationPrereqSql), 'Rulebook V3 migration prerequisite fixture');
      }
      applyFile(container, file, 'forward');
    }

    psql(container, 'postgres', transaction(fixtureSql), 'fixture seed');
    const pol04Output = psql(container, 'postgres', transaction(pol04TypedSqlRegressionSql), 'POL-04 disposable regression');
    process.stdout.write(pol04Output);
    if (onlyPol04) {
      return;
    }
    if (onlyOps01) {
      const constraintModelOutput = psql(container, 'postgres', constraintModelRoundTripSql, 'OPS-01 Constraint Model fixture');
      process.stdout.write(constraintModelOutput);
      psql(container, 'postgres', candidateIntervalFixtureSql, 'OPS-01 canonical schedule fixture');
      psql(container, 'postgres', planningConfirmationSql, 'OPS-01 planning certification fixture');
      runOps01RestoreRehearsal(container);
      return;
    }
    const output = psql(container, 'authenticated', roleTestSql, 'owner/editor/viewer/nonmember integration tests');
    process.stdout.write(output);
    const constraintModelOutput = psql(container, 'postgres', constraintModelRoundTripSql, 'Constraint Model JSONB round-trip integration tests');
    process.stdout.write(constraintModelOutput);
    psql(container, 'postgres', candidateIntervalFixtureSql, 'T04 candidate interval fixture');
    psql(container, 'postgres', planningConfirmationSql, 'T04 planning confirmation bootstrap');
    const candidateIntervalOutput = psql(container, 'postgres', candidateIntervalAdoptionSql, 'T04 candidate interval adoption integration tests');
    process.stdout.write(candidateIntervalOutput);
    const archiveAwareOutput = psql(container, 'postgres', archiveAwareAdoptionSql, 'T06 archive-aware adoption integration tests');
    process.stdout.write(archiveAwareOutput);
    const coherentSnapshotOutput = psql(container, 'postgres', coherentSolverSnapshotSql, 'T07 coherent solver snapshot integration tests');
    process.stdout.write(coherentSnapshotOutput);
    const candidateStaleOutput = psql(container, 'postgres', candidateStaleBindingSql, 'T08 candidate stale-schedule binding integration tests');
    process.stdout.write(candidateStaleOutput);
    const sessionLockOutput = psql(container, 'postgres', sessionSpecificLockAdoptionSql, 'T09 session-specific lock adoption integration tests');
    process.stdout.write(sessionLockOutput);
    const manualMoveOutput = psql(container, 'postgres', authoritativeManualMoveSql, 'T10 authoritative manual MOVE integration tests');
    process.stdout.write(manualMoveOutput);
    const incrementalOutput = psql(container, 'postgres', authoritativeIncrementalSql, 'T11 authoritative incremental ASSIGN/UNASSIGN integration tests');
    process.stdout.write(incrementalOutput);
    const recoveryOutput = psql(container, 'postgres', authoritativeRecoverySql, 'T12 authoritative rebase/undo recovery integration tests');
    process.stdout.write(recoveryOutput);
    const lockCommandOutput = psql(container, 'postgres', authoritativeSessionLockSql, 'LOCK-01 governed session lock integration tests');
    process.stdout.write(lockCommandOutput);
    const bypassClosureOutput = psql(container, 'postgres', legacyWriteBypassClosureSql, 'T13 legacy write bypass closure integration tests');
    process.stdout.write(bypassClosureOutput);
  } finally {
    if (running) {
      const result = runProcess('docker', ['rm', '--force', container]);
      if (result.status !== 0) process.stderr.write(`Warning: disposable container cleanup failed: ${outputFor(result)}\n`);
    }
  }
}


const authoritativeRecoverySql = String.raw`
set search_path=public,extensions;

create or replace function public.t12_test_solver_context(p_studio uuid)
returns jsonb language sql stable security definer set search_path=''
as $function$ select private.build_solver_context_token_v43(p_studio) $function$;
revoke all on function public.t12_test_solver_context(uuid) from public,anon,authenticated;
grant execute on function public.t12_test_solver_context(uuid) to service_role;

-- Archive the class through the governed inventory path. The current ScheduleVersion
-- remains historical evidence with its assignment, while the current Planning Dataset
-- now excludes the class/session and deliberately makes that schedule context stale.
set role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',false);
select public.set_planning_entity_archive_v40(
  'CLASS','t04-class',true,'T12 archive-before-rebase',
  (select version from public.planning_dataset_versions where studio_id='11111111-1111-4111-8111-111111111111' and status='CURRENT')
);
set role postgres;
select public.confirm_current_planning_dataset_v39(
  version,snapshot_hash,'T12 confirmed archive recovery input',
  '{"peopleInventoryReviewed":true,"classSessionCatalogReviewed":true,"classRostersReviewed":true,"sourceAndCompletenessReviewed":true}'::jsonb
)
from public.planning_dataset_versions
where studio_id='11111111-1111-4111-8111-111111111111' and status='CURRENT';
reset role;

set role service_role;
do $block$
declare
  v_studio uuid:='11111111-1111-4111-8111-111111111111';
  v_owner uuid:='10000000-0000-4000-8000-000000000001';
  v_context jsonb;
  v_result jsonb;
  v_source uuid;
  v_before_count integer;
  v_rejected boolean:=false;
begin
  v_context:=public.t12_test_solver_context(v_studio);
  v_source:=(v_context->>'scheduleId')::uuid;
  if (v_context->>'schedulePlanningDatasetVersion')=(v_context->>'planningDatasetVersion') then
    raise exception 'T12 fixture expected archive to make the source schedule planning link stale';
  end if;
  if not exists(select 1 from public.assignments where schedule_version_id=v_source and id='t11-assignment') then
    raise exception 'T12 historical source assignment missing before rebase';
  end if;
  v_result:=public.apply_authoritative_schedule_recovery_v48(
    'REBASE',v_studio,v_owner,v_source,'T12 archive-aware rebase',v_context,'[]'::jsonb,
    '{"valid":true,"hardViolations":0,"violations":[],"unsupportedConstraintIds":[]}'::jsonb,
    '{"mode":"REBASE","scheduleComplete":true,"publishable":true,"unscheduledSessionIds":[],"duplicateSessionIds":[],"unknownAssignmentSessionIds":[],"completenessObligationKeys":[],"retiredAssignmentIds":["t11-assignment"]}'::jsonb
  );
  if exists(select 1 from public.assignments where schedule_version_id=(v_result->>'scheduleId')::uuid) then
    raise exception 'T12 archive-aware rebase reintroduced a retired assignment';
  end if;
  if not exists(select 1 from public.assignments where schedule_version_id=v_source and id='t11-assignment') then
    raise exception 'T12 rebase rewrote historical assignments';
  end if;
  if not exists(
    select 1 from public.schedule_versions sv where sv.id=(v_result->>'scheduleId')::uuid and sv.is_current
      and sv.rulebook_version=(v_context->>'rulebookVersion')::integer
      and sv.enforcement_version=(v_context->>'enforcementVersion')::integer
      and sv.planning_dataset_version=(v_context->>'planningDatasetVersion')::integer
      and sv.constraint_model_version=(v_context->>'constraintModelVersion')::integer
  ) then raise exception 'T12 rebase did not preserve all four current authority links'; end if;
  if not exists(
    select 1 from public.audit_events e where e.studio_id=v_studio and e.action='SCHEDULE_REBASE'
      and e.entity_id=(v_result->>'scheduleId') and e.payload->>'authority'='SERVER_CONSTRAINT_IR_V48'
  ) then raise exception 'T12 rebase audit evidence missing'; end if;

  select count(*) into v_before_count from public.schedule_versions where studio_id=v_studio;
  begin
    perform public.apply_authoritative_schedule_recovery_v48(
      'REBASE',v_studio,v_owner,v_source,'T12 stale rebase replay',v_context,'[]'::jsonb,'{}'::jsonb,'{}'::jsonb
    );
  exception when others then
    if position('STALE_RECOVERY_CONTEXT' in sqlerrm)=0 then raise; end if;
    v_rejected:=true;
  end;
  if not v_rejected then raise exception 'T12 stale rebase replay unexpectedly succeeded'; end if;
  if (select count(*) from public.schedule_versions where studio_id=v_studio)<>v_before_count then
    raise exception 'T12 stale rebase replay persisted a ScheduleVersion';
  end if;
end
$block$;
reset role;

-- Restore the archived class/session, then change the current per-session duration.
-- The old T11 historical assignment remains 90 minutes; T12 UNDO must normalize it
-- to the new 105-minute current planning fact before adoption.
set role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',false);
select public.set_planning_entity_archive_v40(
  'CLASS','t04-class',false,'T12 restore-before-undo',
  (select version from public.planning_dataset_versions where studio_id='11111111-1111-4111-8111-111111111111' and status='CURRENT')
);
reset role;
update public.class_sessions set duration_minutes=105
where studio_id='11111111-1111-4111-8111-111111111111' and id='t04-session';
select private.ensure_planning_dataset_version_v25(
  '11111111-1111-4111-8111-111111111111',null,'T12 duration recovery fixture','Change active session duration to 105 minutes before undo'
);
set role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',false);
set role postgres;
select public.confirm_current_planning_dataset_v39(
  version,snapshot_hash,'T12 confirmed restored 105-minute duration',
  '{"peopleInventoryReviewed":true,"classSessionCatalogReviewed":true,"classRostersReviewed":true,"sourceAndCompletenessReviewed":true}'::jsonb
)
from public.planning_dataset_versions
where studio_id='11111111-1111-4111-8111-111111111111' and status='CURRENT';
reset role;

set role service_role;
do $block$
declare
  v_studio uuid:='11111111-1111-4111-8111-111111111111';
  v_owner uuid:='10000000-0000-4000-8000-000000000001';
  v_context jsonb;
  v_source uuid;
  v_result jsonb;
  v_before_count integer;
  v_rejected boolean:=false;
begin
  v_context:=public.t12_test_solver_context(v_studio);
  select id into v_source from public.schedule_versions
  where studio_id=v_studio and version=(v_context->>'scheduleVersion')::integer-1;
  if v_source is null then raise exception 'T12 immediate previous undo source missing'; end if;
  if not exists(select 1 from public.assignments where schedule_version_id=v_source and id='t11-assignment' and end_time='18:45'::time) then
    raise exception 'T12 expected immutable 90-minute historical source assignment';
  end if;

  v_result:=public.apply_authoritative_schedule_recovery_v48(
    'UNDO',v_studio,v_owner,v_source,'T12 current-policy undo with duration normalization',v_context,
    '[{"assignmentId":"t11-assignment","sessionId":"t04-session","day":"Monday","startTime":"17:15","endTime":"19:00","teacherId":"t04-teacher","roomId":"t04-room","status":"NORMAL"}]'::jsonb,
    '{"valid":true,"hardViolations":0,"violations":[],"unsupportedConstraintIds":[]}'::jsonb,
    '{"mode":"UNDO","scheduleComplete":true,"publishable":true,"unscheduledSessionIds":[],"duplicateSessionIds":[],"unknownAssignmentSessionIds":[],"completenessObligationKeys":[],"retiredAssignmentIds":[]}'::jsonb
  );
  if not exists(
    select 1 from public.assignments a where a.schedule_version_id=(v_result->>'scheduleId')::uuid
      and a.id='t11-assignment' and a.start_time='17:15'::time and a.end_time='19:00'::time
  ) then raise exception 'T12 undo did not persist current 105-minute canonical duration'; end if;
  if not exists(select 1 from public.assignments where schedule_version_id=v_source and id='t11-assignment' and end_time='18:45'::time) then
    raise exception 'T12 undo mutated historical assignment duration';
  end if;
  if not exists(
    select 1 from public.audit_events e where e.studio_id=v_studio and e.action='SCHEDULE_UNDO'
      and e.entity_id=(v_result->>'scheduleId') and e.payload->>'authority'='SERVER_CONSTRAINT_IR_V48'
  ) then raise exception 'T12 undo audit evidence missing'; end if;

  select count(*) into v_before_count from public.schedule_versions where studio_id=v_studio;
  v_rejected:=false;
  begin
    perform public.apply_authoritative_schedule_recovery_v48(
      'UNDO',v_studio,v_owner,v_source,'T12 stale undo replay',v_context,
      '[{"assignmentId":"t11-assignment","sessionId":"t04-session","day":"Monday","startTime":"17:15","endTime":"19:00","teacherId":"t04-teacher","roomId":"t04-room","status":"NORMAL"}]'::jsonb,
      '{}'::jsonb,'{}'::jsonb
    );
  exception when others then
    if position('STALE_RECOVERY_CONTEXT' in sqlerrm)=0 then raise; end if;
    v_rejected:=true;
  end;
  if not v_rejected then raise exception 'T12 stale undo replay unexpectedly succeeded'; end if;
  if (select count(*) from public.schedule_versions where studio_id=v_studio)<>v_before_count then
    raise exception 'T12 stale undo replay persisted a ScheduleVersion';
  end if;
end
$block$;
reset role;

-- A one-step undo may not remove the just-restored effective lock by reaching back
-- to the immediately previous empty version.
update public.assignments a set locked=true
from public.schedule_versions sv
where sv.id=a.schedule_version_id and sv.studio_id='11111111-1111-4111-8111-111111111111' and sv.is_current and a.id='t11-assignment';
set role service_role;
do $block$
declare
  v_studio uuid:='11111111-1111-4111-8111-111111111111';
  v_owner uuid:='10000000-0000-4000-8000-000000000001';
  v_context jsonb:=public.t12_test_solver_context(v_studio);
  v_source uuid;
  v_before_count integer;
  v_rejected boolean:=false;
begin
  select id into v_source from public.schedule_versions where studio_id=v_studio and version=(v_context->>'scheduleVersion')::integer-1;
  select count(*) into v_before_count from public.schedule_versions where studio_id=v_studio;
  begin
    perform public.apply_authoritative_schedule_recovery_v48(
      'UNDO',v_studio,v_owner,v_source,'T12 locked undo rejection',v_context,'[]'::jsonb,
      '{"valid":false,"hardViolations":0,"violations":[],"unsupportedConstraintIds":[]}'::jsonb,
      '{"mode":"UNDO","scheduleComplete":false,"publishable":false,"unscheduledSessionIds":["t04-session"],"duplicateSessionIds":[],"unknownAssignmentSessionIds":[],"completenessObligationKeys":[],"retiredAssignmentIds":[]}'::jsonb
    );
  exception when others then
    if position('LOCKED_SESSION_PLACEMENT_CHANGED' in sqlerrm)=0 then raise; end if;
    v_rejected:=true;
  end;
  if not v_rejected then raise exception 'T12 locked undo unexpectedly succeeded'; end if;
  if (select count(*) from public.schedule_versions where studio_id=v_studio)<>v_before_count then
    raise exception 'T12 locked undo persisted a ScheduleVersion';
  end if;
end
$block$;
reset role;
update public.assignments a set locked=false
from public.schedule_versions sv
where sv.id=a.schedule_version_id and sv.studio_id='11111111-1111-4111-8111-111111111111' and sv.is_current and a.id='t11-assignment';

drop function public.t12_test_solver_context(uuid);
select 'T12 PASS: archive-aware REBASE preserves history; current-policy UNDO normalizes duration; stale replay and effective-lock rollback reject atomically' as result;
`;

const authoritativeSessionLockSql = String.raw`
set search_path=public,extensions;

create or replace function public.t14_test_solver_context(p_studio uuid)
returns jsonb
language sql
security definer
set search_path=''
as $function$ select private.build_solver_context_token_v43(p_studio) $function$;
revoke all on function public.t14_test_solver_context(uuid) from public,anon,authenticated;
grant execute on function public.t14_test_solver_context(uuid) to service_role;

set role postgres;
insert into public.class_sessions(id,studio_id,class_id,ordinal,duration_minutes,locked)
values('t14-session-2','11111111-1111-4111-8111-111111111111','t04-class',2,60,false)
on conflict(id) do nothing;
set role service_role;
do $block$
declare
  v_studio uuid:='11111111-1111-4111-8111-111111111111';
  v_other uuid:='22222222-2222-4222-8222-222222222222';
  v_owner uuid:='10000000-0000-4000-8000-000000000001';
  v_viewer uuid:='10000000-0000-4000-8000-000000000003';
  v_context jsonb;
  v_new_context jsonb;
  v_result jsonb;
  v_old_schedule uuid;
  v_new_schedule uuid;
  v_old_schedule_version integer;
  v_old_planning_version integer;
  v_new_planning_version integer;
  v_before_count integer;
  v_after_count integer;
  v_rejected boolean;
begin
  v_context:=public.t14_test_solver_context(v_studio);
  v_old_schedule:=(v_context->>'scheduleId')::uuid;
  v_old_schedule_version:=(v_context->>'scheduleVersion')::integer;
  v_old_planning_version:=(v_context->>'planningDatasetVersion')::integer;
  if v_old_schedule is null then raise exception 'LOCK-01 fixture has no current schedule'; end if;
  if (select count(*) from public.assignments where schedule_version_id=v_old_schedule and session_id='t04-session')<>1 then
    raise exception 'LOCK-01 fixture requires one current target placement';
  end if;

  v_result:=public.apply_authoritative_session_lock_v61(
    v_studio,v_owner,'T14 owner','t04-session',true,
    'T14 lock the selected session placement',v_context
  );
  v_new_schedule:=(v_result->>'scheduleId')::uuid;
  v_new_planning_version:=(v_result->>'planningDatasetVersion')::integer;
  if v_result->>'status' is distinct from 'LOCKED' or (v_result->>'effectiveLock')::boolean is distinct from true then
    raise exception 'LOCK-01 lock result did not report effective LOCKED state';
  end if;
  if (v_result->>'scheduleVersion')::integer<>v_old_schedule_version+1 then
    raise exception 'LOCK-01 lock did not create exactly one next ScheduleVersion';
  end if;
  if v_new_planning_version<=v_old_planning_version then
    raise exception 'LOCK-01 lock did not create a new PlanningDatasetVersion';
  end if;
  if (select count(*) from public.schedule_versions where studio_id=v_studio)<>((select count(*) from public.schedule_versions where studio_id=v_studio and version<=v_old_schedule_version)+1) then
    raise exception 'LOCK-01 lock changed an unexpected number of ScheduleVersions';
  end if;
  if not exists(
    select 1 from public.class_sessions
    where studio_id=v_studio and id='t04-session' and locked=true
  ) then raise exception 'LOCK-01 session lock flag was not persisted'; end if;
  if not exists(
    select 1 from public.assignments
    where schedule_version_id=v_new_schedule and session_id='t04-session' and locked=true
  ) then raise exception 'LOCK-01 target assignment lock was not mirrored'; end if;
  if exists(
    select 1 from public.class_sessions
    where studio_id=v_studio and id='t14-session-2' and locked=true
  ) then raise exception 'LOCK-01 lock incorrectly affected a sibling session'; end if;
  if not exists(
    select 1 from public.planning_dataset_versions pd
    where pd.studio_id=v_studio and pd.version=v_new_planning_version and pd.status='CURRENT'
      and pd.confirmed_for_scheduling_at is null
      and exists(select 1 from jsonb_array_elements(pd.snapshot->'sessions') item where item->>'id'='t04-session' and (item->>'locked')::boolean=true)
  ) then raise exception 'LOCK-01 did not make the changed planning snapshot current and uncertified'; end if;
  if (v_result->>'certificationStale')::boolean is distinct from true or (v_result->>'candidateStale')::boolean is distinct from true then
    raise exception 'LOCK-01 did not identify certification/candidate staleness';
  end if;
  if not exists(
    select 1 from public.assignments
    where schedule_version_id=v_old_schedule and id='t11-assignment' and locked=false
  ) then raise exception 'LOCK-01 rewrote the historical assignment'; end if;
  if not exists(
    select 1 from public.planning_dataset_versions pd
    where pd.studio_id=v_studio and pd.version=v_old_planning_version
      and exists(select 1 from jsonb_array_elements(pd.snapshot->'sessions') item where item->>'id'='t04-session' and (item->>'locked')::boolean=false)
  ) then raise exception 'LOCK-01 rewrote the historical planning snapshot'; end if;
  if not exists(
    select 1 from public.audit_events e
    where e.studio_id=v_studio and e.action='SCHEDULE_SESSION_LOCK_CHANGED'
      and e.entity_id='t04-session' and e.payload->>'authority'='SERVER_SESSION_LOCK_V61'
  ) then raise exception 'LOCK-01 authoritative audit evidence is missing'; end if;

  -- Replaying the old context must fail before any new version or flag change.
  select count(*) into v_before_count from public.schedule_versions where studio_id=v_studio;
  v_rejected:=false;
  begin
    perform public.apply_authoritative_session_lock_v61(
      v_studio,v_owner,'T14 owner','t04-session',false,
      'T14 stale unlock rejection',v_context
    );
  exception when others then
    if position('STALE_SESSION_LOCK_CONTEXT' in sqlerrm)=0 then raise; end if;
    v_rejected:=true;
  end;
  if not v_rejected then raise exception 'LOCK-01 stale lock replay was accepted'; end if;
  select count(*) into v_after_count from public.schedule_versions where studio_id=v_studio;
  if v_after_count<>v_before_count then raise exception 'LOCK-01 stale rejection persisted a ScheduleVersion'; end if;
  if not exists(select 1 from public.class_sessions where studio_id=v_studio and id='t04-session' and locked=true) then
    raise exception 'LOCK-01 stale rejection changed the session lock';
  end if;

  -- An unassigned session, viewer, and wrong-tenant context are all rejected
  -- without touching the current canonical state.
  v_new_context:=public.t14_test_solver_context(v_studio);
  select count(*) into v_before_count from public.schedule_versions where studio_id=v_studio;
  v_rejected:=false;
  begin
    perform public.apply_authoritative_session_lock_v61(
      v_studio,v_owner,'T14 owner','t14-session-2',true,
      'T14 unassigned rejection',v_new_context
    );
  exception when others then
    if position('SESSION_LOCK_PLACEMENT_REQUIRED' in sqlerrm)=0 then raise; end if;
    v_rejected:=true;
  end;
  if not v_rejected then raise exception 'LOCK-01 unassigned session was accepted'; end if;
  begin
    perform public.apply_authoritative_session_lock_v61(
      v_studio,v_viewer,'T14 viewer','t04-session',false,
      'T14 viewer rejection',v_new_context
    );
  exception when others then
    if position('Editor membership required' in sqlerrm)=0 then raise; end if;
    v_rejected:=true;
  end;
  if not v_rejected then raise exception 'LOCK-01 viewer lock change was accepted'; end if;
  begin
    perform public.apply_authoritative_session_lock_v61(
      v_other,v_owner,'T14 wrong tenant','t04-session',false,
      'T14 wrong tenant rejection',v_new_context
    );
  exception when others then
    if position('SESSION_LOCK_CONTEXT_INVALID' in sqlerrm)=0 then raise; end if;
  end;
  select count(*) into v_after_count from public.schedule_versions where studio_id=v_studio;
  if v_after_count<>v_before_count then raise exception 'LOCK-01 rejection cases were not atomic'; end if;

  -- Unlock clears both the planning-session and current-assignment flags in
  -- one command, while retaining the lock-change version history.
  v_result:=public.apply_authoritative_session_lock_v61(
    v_studio,v_owner,'T14 owner','t04-session',false,
    'T14 unlock the selected session placement',v_new_context
  );
  v_new_schedule:=(v_result->>'scheduleId')::uuid;
  if v_result->>'status' is distinct from 'UNLOCKED' then raise exception 'LOCK-01 unlock result was not UNLOCKED'; end if;
  if exists(select 1 from public.class_sessions where studio_id=v_studio and id='t04-session' and locked=true) then
    raise exception 'LOCK-01 unlock did not clear session lock';
  end if;
  if exists(select 1 from public.assignments where schedule_version_id=v_new_schedule and session_id='t04-session' and locked=true) then
    raise exception 'LOCK-01 unlock did not clear assignment lock';
  end if;
  if (v_result->>'scheduleVersion')::integer<>(v_new_context->>'scheduleVersion')::integer+1 then
    raise exception 'LOCK-01 unlock did not advance one ScheduleVersion';
  end if;

  -- Assignment-only legacy lock state is also cleared by the same governed
  -- action; there is no second writable user control.
  update public.assignments
  set locked=true
  where schedule_version_id=v_new_schedule and session_id='t04-session';
  v_new_context:=public.t14_test_solver_context(v_studio);
  v_result:=public.apply_authoritative_session_lock_v61(
    v_studio,v_owner,'T14 owner','t04-session',false,
    'T14 clear legacy assignment-only lock',v_new_context
  );
  v_new_schedule:=(v_result->>'scheduleId')::uuid;
  if exists(select 1 from public.assignments where schedule_version_id=v_new_schedule and session_id='t04-session' and locked=true) then
    raise exception 'LOCK-01 assignment-only unlock left an effective assignment lock';
  end if;
  if exists(select 1 from public.class_sessions where studio_id=v_studio and id='t04-session' and locked=true) then
    raise exception 'LOCK-01 assignment-only unlock left a session lock';
  end if;

  -- A repeated request for the already-effective state is a conflicting
  -- command, not a reason to create another ScheduleVersion.
  v_new_context:=public.t14_test_solver_context(v_studio);
  select count(*) into v_before_count from public.schedule_versions where studio_id=v_studio;
  v_rejected:=false;
  begin
    perform public.apply_authoritative_session_lock_v61(
      v_studio,v_owner,'T14 owner','t04-session',false,
      'T14 unchanged lock rejection',v_new_context
    );
  exception when others then
    if position('SESSION_LOCK_STATE_UNCHANGED' in sqlerrm)=0 then raise; end if;
    v_rejected:=true;
  end;
  if not v_rejected then raise exception 'LOCK-01 unchanged lock request was accepted'; end if;
  select count(*) into v_after_count from public.schedule_versions where studio_id=v_studio;
  if v_after_count<>v_before_count then raise exception 'LOCK-01 duplicate rejection persisted a ScheduleVersion'; end if;
end
$block$;
reset role;
drop function public.t14_test_solver_context(uuid);

select 'LOCK-01 PASS: exact tenant/role/context lock transition, one-placement requirement, session/assignment precedence, immutable history, stale/no-write rejection, and certification/candidate staleness' as result;
`;

const legacyWriteBypassClosureSql = String.raw`
set search_path=public,extensions;

-- Enumerate every known superseded writer after all migrations. Historical
-- functions may remain for owner-level internal delegation, but neither an
-- authenticated browser nor a service-role application caller may invoke them.
do $block$
declare
  v_sig text;
  v_legacy text[]:=array[
    'public.apply_schedule_patch_v21(text,jsonb,text,integer,integer,boolean)',
    'public.rebase_current_schedule_v21(integer,integer,text)',
    'public.apply_schedule_patch_v22(text,jsonb,text,integer,integer,integer,boolean)',
    'public.rebase_current_schedule_v22(integer,integer,integer,text)',
    'public.apply_schedule_builder_patch_v23(text,text,text,jsonb,text,integer,integer,integer,boolean)',
    'public.undo_last_schedule_change_v23(integer,integer,integer,text)',
    'public.apply_schedule_command_v25(text,text,text,jsonb,text,integer,integer,integer,integer,boolean)',
    'public.undo_last_schedule_change_v25(integer,integer,integer,integer,text)',
    'public.rebase_current_schedule_v25(integer,integer,integer,integer,text)',
    'public.publish_constraint_model_v30(jsonb,text,integer)',
    'public.adopt_solver_candidate_v33(uuid,uuid,text,text,integer,integer,integer,integer,integer,jsonb,jsonb)',
    'public.adopt_solver_candidate_v44(uuid,uuid,text,text,jsonb,jsonb,jsonb)'
  ];
begin
  foreach v_sig in array v_legacy loop
    if to_regprocedure(v_sig) is null then raise exception 'T13 expected historical function is missing: %',v_sig; end if;
    if has_function_privilege('authenticated',v_sig,'execute')
       or has_function_privilege('service_role',v_sig,'execute') then
      raise exception 'T13 legacy function remains executable: %',v_sig;
    end if;
  end loop;

  foreach v_sig in array array[
    'public.apply_authoritative_move_v46(uuid,uuid,text,jsonb,text,jsonb,jsonb,boolean)',
    'public.apply_authoritative_incremental_command_v47(text,uuid,uuid,text,text,jsonb,text,jsonb,jsonb,jsonb,boolean)',
    'public.apply_authoritative_schedule_recovery_v48(text,uuid,uuid,uuid,text,jsonb,jsonb,jsonb,jsonb)',
    'public.publish_server_constraint_model_v49(uuid,uuid,jsonb,text,integer)',
    'public.adopt_solver_candidate_v49(uuid,uuid,text,text,jsonb,jsonb,jsonb)'
  ] loop
    if not has_function_privilege('service_role',v_sig,'execute') then
      raise exception 'T13 canonical service boundary is not executable: %',v_sig;
    end if;
    if has_function_privilege('authenticated',v_sig,'execute') then
      raise exception 'T13 canonical service boundary leaked to authenticated: %',v_sig;
    end if;
  end loop;
end
$block$;

-- A browser-authenticated caller cannot execute the legacy schedule or model
-- publication surfaces even with a valid owner JWT claim.
set role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',false);
do $block$
declare
  v_rejected boolean:=false;
  v_before integer;
begin
  select count(*) into v_before from public.schedule_versions where studio_id='11111111-1111-4111-8111-111111111111';
  begin
    perform public.apply_schedule_command_v25(
      'MOVE','t11-assignment',null,'{"day":"Tuesday"}'::jsonb,'T13 must deny direct V2.5',
      0,0,0,0,false
    );
  exception when insufficient_privilege then
    v_rejected:=true;
  end;
  if not v_rejected then raise exception 'T13 authenticated legacy schedule RPC unexpectedly executed'; end if;
  if (select count(*) from public.schedule_versions where studio_id='11111111-1111-4111-8111-111111111111')<>v_before then
    raise exception 'T13 denied legacy schedule RPC changed history';
  end if;

  v_rejected:=false;
  begin
    perform public.publish_constraint_model_v30('{}'::jsonb,'T13 must deny direct V3.0',0);
  exception when insufficient_privilege then
    v_rejected:=true;
  end;
  if not v_rejected then raise exception 'T13 direct V3.0 model publication unexpectedly executed'; end if;
end
$block$;
reset role;

-- The privileged publication and adoption boundaries recheck the human actor's
-- current membership inside the transaction. A user authorized earlier in the
-- request cannot commit after being downgraded to VIEWER.
update public.studio_members
set role='VIEWER'
where studio_id='11111111-1111-4111-8111-111111111111'
  and user_id='10000000-0000-4000-8000-000000000002';
set role service_role;
do $block$
declare
  v_rejected boolean:=false;
begin
  begin
    perform public.publish_server_constraint_model_v49(
      '11111111-1111-4111-8111-111111111111',
      '10000000-0000-4000-8000-000000000002',
      '{}'::jsonb,'T13 downgraded model publisher',0
    );
  exception when others then
    if position('Editor membership required for selected workspace' in sqlerrm)=0 then raise; end if;
    v_rejected:=true;
  end;
  if not v_rejected then raise exception 'T13 actor role recheck did not reject downgraded editor'; end if;

  v_rejected:=false;
  begin
    perform public.adopt_solver_candidate_v49(
      '11111111-1111-4111-8111-111111111111',
      '10000000-0000-4000-8000-000000000002',
      'T13 downgraded editor','T13 must reject downgraded adoption',
      '{}'::jsonb,'[]'::jsonb,'{}'::jsonb
    );
  exception when others then
    if position('Editor membership required for selected workspace' in sqlerrm)=0 then raise; end if;
    v_rejected:=true;
  end;
  if not v_rejected then raise exception 'T13 adoption actor role recheck did not reject downgraded editor'; end if;
end
$block$;
reset role;
update public.studio_members
set role='EDITOR'
where studio_id='11111111-1111-4111-8111-111111111111'
  and user_id='10000000-0000-4000-8000-000000000002';

-- Retained readers are intentional: coherent snapshot/context and historical
-- version rows remain readable under membership/RLS. T13 only closes mutation
-- surfaces and does not erase audit/history inspection.
do $block$
begin
  if not has_function_privilege('authenticated','public.get_solver_context_token_v43(uuid)','execute')
     or not has_function_privilege('authenticated','public.get_solver_snapshot_v43(uuid)','execute') then
    raise exception 'T13 accidentally revoked governed coherent readers';
  end if;
end
$block$;

select 'T13 PASS: privilege enumeration leaves only current service authority; authenticated legacy schedule/model RPCs deny; downgraded actors fail publication/adoption; governed readers remain' as result;
`;

const pol04TypedSqlRegressionSql = String.raw`
set search_path=public,extensions;
set role postgres;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',false);
savepoint pol04_regression;

do $fixture$
declare
  v_studio uuid := '11111111-1111-4111-8111-111111111111';
  v_rulebook integer;
  v_enforcement integer;
  v_planning integer;
  v_model jsonb;
  v_model_version integer;
  v_model_id uuid;
  v_schedule_id uuid;
  v_enforcement_row public.rule_enforcement_versions%rowtype;
  v_enforcement_version integer;
begin
  if exists(select 1 from public.schedule_versions where studio_id=v_studio and is_current) then
    raise exception 'POL04 fixture requires a studio without a current ScheduleVersion';
  end if;

  insert into public.teachers(id,studio_id,name)
  values('pol04-teacher',v_studio,'POL04 Teacher'),
        ('pol04-other-teacher',v_studio,'POL04 Other Teacher')
  on conflict(id) do nothing;
  insert into public.rooms(id,studio_id,name,capacity,features)
  values('pol04-room',v_studio,'POL04 Room',2,'{mirrors,sprung-floor}'),
        ('pol04-alt-room',v_studio,'POL04 Alternate Room',20,'{mirrors,sprung-floor}')
  on conflict(id) do nothing;
  insert into public.students(id,studio_id,name,level,cohort_ids)
  values('pol04-student-a',v_studio,'POL04 Participant A','POL04','{}'),
        ('pol04-student-b',v_studio,'POL04 Participant B','POL04','{}')
  on conflict(id) do nothing;
  insert into public.class_definitions(
    id,studio_id,name,subject,level,duration_minutes,weekly_frequency,
    roster_student_ids,eligible_teacher_ids
  ) values
    ('pol04-class',v_studio,'POL04 Canonical Interval','Ballet','POL04',90,1,
      '{pol04-student-a,pol04-student-b}','{pol04-teacher}'),
    ('pol04-other-class',v_studio,'POL04 Qualification Probe','Ballet','POL04',90,1,
      '{pol04-student-a,pol04-student-b}','{pol04-other-teacher}')
  on conflict(id) do nothing;
  insert into public.class_sessions(id,studio_id,class_id,ordinal,duration_minutes,locked)
  values('pol04-session',v_studio,'pol04-class',1,90,false),
        ('pol04-other-session',v_studio,'pol04-other-class',1,90,false)
  on conflict(id) do nothing;

  select version into v_rulebook from public.rulebook_versions
  where studio_id=v_studio and status='CURRENT';
  select * into v_enforcement_row
  from public.rule_enforcement_versions
  where studio_id=v_studio and status='CURRENT'
  limit 1;
  if v_rulebook is null or v_enforcement_row.id is null then
    raise exception 'POL04 fixture requires current Rulebook and Enforcement versions';
  end if;

  -- Keep only the two fixture HARD mappings so the legacy validator is fully
  -- covered while the typed SQL assertions isolate POL-04 semantics.
  update public.rule_enforcement_versions
  set status='HISTORICAL'
  where id=v_enforcement_row.id;
  select coalesce(max(version),0)+1 into v_enforcement_version
  from public.rule_enforcement_versions where studio_id=v_studio;
  insert into public.rule_enforcement_versions(
    studio_id,version,rulebook_version,actor_label,reason,changed_rule_ids,snapshot,status
  ) values(
    v_studio,v_enforcement_version,v_rulebook,'POL-04 disposable fixture',
    'Seed complete legacy HARD coverage for typed SQL regression',
    array['ADV-004','OPS-002']::text[],
    jsonb_build_array(
      jsonb_build_object(
        'ruleId','OPS-002','type','EARLIEST_START',
        'parameters',jsonb_build_object('time','16:45','days',jsonb_build_array('Monday','Tuesday')),
        'affectedEntityIds','[]'::jsonb,'exceptions','[]'::jsonb
      ),
      jsonb_build_object(
        'ruleId','ADV-004','type','CLASS_DURATION',
        'parameters','{}'::jsonb,'affectedEntityIds','[]'::jsonb,'exceptions','[]'::jsonb
      )
    ),'CURRENT'
  );
  v_enforcement:=v_enforcement_version;

  select private.ensure_planning_dataset_version_v25(
    v_studio,null,'POL-04 disposable fixture','Seed POL-04 typed SQL facts'
  ) into v_planning;
  v_model:=jsonb_build_object(
    'schemaVersion','1.0','compilerVersion','dwde-ir-0.5',
    'rulebookVersion',v_rulebook,'planningDatasetVersion',v_planning,'activeRuleCount',178,
    'hardConstraints',jsonb_build_array(jsonb_build_object(
      'id','pol04-operating-windows','kind','STUDIO_OPERATING_WINDOWS',
      'ruleIds',jsonb_build_array('OPS-002'),'selector','{}'::jsonb,
      'parameters',jsonb_build_object(
        'windows',jsonb_build_array(
          jsonb_build_object('day','Monday','start','17:00','end','18:30'),
          jsonb_build_object('day','Tuesday','start','17:00','end','18:30'),
          jsonb_build_object('day','Saturday','start','17:00','end','18:30')
        ),'closedDays',jsonb_build_array('Saturday')
      ),'explanation','POL04 operating window boundary'
    ),jsonb_build_object(
      'id','pol04-room-unavailable','kind','ROOM_UNAVAILABLE_WINDOWS',
      'ruleIds',jsonb_build_array('POL04-ROOM-UNAVAILABLE'),
      'selector',jsonb_build_object('roomIds',jsonb_build_array('pol04-room')),
      'parameters',jsonb_build_object('windows',jsonb_build_array(
        jsonb_build_object('day','Monday','start','18:30','end','19:00'),
        jsonb_build_object('day','Tuesday','start','18:30','end','19:00')
      )), 'explanation','POL04 half-open room-unavailable boundary'
    ),jsonb_build_object(
      'id','pol04-teacher-domain','kind','TEACHER_CLASS_DOMAIN',
      'ruleIds',jsonb_build_array('POL04-TEACHER-DOMAIN'),
      'selector',jsonb_build_object('teacherIds',jsonb_build_array('pol04-teacher')),
      'parameters',jsonb_build_object('classIds',jsonb_build_array('pol04-class')),
      'explanation','POL04 explicit qualification domain'
    ),jsonb_build_object(
      'id','pol04-required-teacher','kind','REQUIRED_TEACHER',
      'ruleIds',jsonb_build_array('POL04-REQUIRED-TEACHER'),
      'selector',jsonb_build_object(
        'classIds',jsonb_build_array('pol04-class'),
        'teacherIds',jsonb_build_array('pol04-teacher')
      ),'parameters',jsonb_build_object('teacherId','pol04-teacher'),
      'explanation','POL04 required teacher'
    ),jsonb_build_object(
      'id','pol04-required-room','kind','REQUIRED_ROOM',
      'ruleIds',jsonb_build_array('POL04-REQUIRED-ROOM'),
      'selector',jsonb_build_object(
        'classIds',jsonb_build_array('pol04-class'),
        'roomIds',jsonb_build_array('pol04-room')
      ),'parameters',jsonb_build_object('roomId','pol04-room'),
      'explanation','POL04 required room'
    ),jsonb_build_object(
      'id','pol04-room-capacity','kind','ROOM_CAPACITY',
      'ruleIds',jsonb_build_array('ADV-004'),
      'selector',jsonb_build_object('roomIds',jsonb_build_array('pol04-room')),
      'parameters',jsonb_build_object('capacitySource','PLANNING_DATASET','exemptClassIds','[]'::jsonb),
      'explanation','POL04 PlanningDataset capacity'
    ),jsonb_build_object(
      'id','pol04-room-features','kind','ROOM_REQUIRED_FEATURES',
      'ruleIds',jsonb_build_array('POL04-ROOM-FEATURES'),
      'selector',jsonb_build_object('classIds',jsonb_build_array('pol04-class')),
      'parameters',jsonb_build_object('requiredFeatures',jsonb_build_array('mirrors','sprung-floor')),
      'explanation','POL04 room feature set inclusion'
    )),
    'objectivePrioritySpine','[]'::jsonb,'readinessRuleIds','[]'::jsonb,
    'governanceAssertions','[]'::jsonb,'uncompiledConstraintRuleIds','[]'::jsonb,
    'completeHardConstraintCompilation',true
  );
  update public.constraint_model_versions
  set status='HISTORICAL'
  where studio_id=v_studio and status='CURRENT';
  select coalesce(max(version),0)+1 into v_model_version
  from public.constraint_model_versions where studio_id=v_studio;
  insert into public.constraint_model_versions(
    studio_id,version,rulebook_version,compiler_version,actor_user_id,actor_label,reason,
    snapshot,snapshot_hash,complete_hard_constraint_compilation,status
  ) values(
    v_studio,v_model_version,v_rulebook,'dwde-ir-0.5',
    '10000000-0000-4000-8000-000000000001','POL-04 disposable fixture',
    'Seed POL-04 typed SQL model',v_model,private.constraint_model_hash_v27(v_model),true,'CURRENT'
  ) returning id into v_model_id;
  insert into public.schedule_versions(
    studio_id,version,rulebook_version,enforcement_version,planning_dataset_version,
    constraint_model_version,actor_user_id,actor_label,reason,is_current
  ) values(
    v_studio,coalesce((select max(version)+1 from public.schedule_versions where studio_id=v_studio),1),
    v_rulebook,v_enforcement,v_planning,v_model_version,
    '10000000-0000-4000-8000-000000000001','POL-04 disposable fixture',
    'Seed POL-04 typed SQL schedule',true
  ) returning id into v_schedule_id;
  insert into public.assignments(
    schedule_version_id,id,studio_id,session_id,day,start_time,end_time,teacher_id,room_id,locked,status
  ) values
    (v_schedule_id,'pol04-assignment',v_studio,'pol04-session','Monday','17:00','18:30',
      'pol04-teacher','pol04-room',false,'NORMAL'),
    (v_schedule_id,'pol04-other-assignment',v_studio,'pol04-other-session','Tuesday','17:00','18:30',
      'pol04-other-teacher','pol04-room',false,'NORMAL');
  update public.planning_dataset_versions
  set confirmed_for_scheduling_at=now(),
      confirmed_for_scheduling_by='10000000-0000-4000-8000-000000000001',
      confirmed_for_scheduling_by_label='POL-04 disposable fixture',
      scheduling_confirmation_note='POL-04 typed SQL regression fixture'
  where studio_id=v_studio and version=v_planning;
end
$fixture$;

-- POL-03 V58 executes every new family against the pinned PlanningDataset and
-- proves a rejected canonical write cannot create version or audit success rows.
do $block$
declare
  v_studio uuid:='11111111-1111-4111-8111-111111111111'; v_schedule_id uuid; v_model_id uuid;
  v_original jsonb; v_node jsonb; v_result jsonb; v_context jsonb; v_rejected boolean:=false;
  v_schedules bigint; v_assignments bigint; v_audits bigint;
begin
  select sv.id,cm.id,cm.snapshot into v_schedule_id,v_model_id,v_original
  from public.schedule_versions sv join public.constraint_model_versions cm on cm.studio_id=sv.studio_id and cm.version=sv.constraint_model_version
  where sv.studio_id=v_studio and sv.is_current;

  v_node:=jsonb_build_object('id','pol03-group','kind','PARTICIPANT_NO_OVERLAP','ruleIds',jsonb_build_array('STU-003'),'selector',jsonb_build_object('participantIds',jsonb_build_array('pol04-student-a','pol04-student-b')),'parameters','{}'::jsonb,'explanation','POL03 group');
  update public.constraint_model_versions set snapshot=jsonb_set(v_original,'{hardConstraints}',(v_original->'hardConstraints')||jsonb_build_array(v_node)),snapshot_hash=private.constraint_model_hash_v27(jsonb_set(v_original,'{hardConstraints}',(v_original->'hardConstraints')||jsonb_build_array(v_node))) where id=v_model_id;
  update public.assignments set day='Monday',start_time='17:30',end_time='19:00' where id='pol04-other-assignment';
  select private.validate_typed_schedule_v54(v_schedule_id) into v_result;
  if not exists(select 1 from jsonb_array_elements(v_result->'violations') item where item->>'constraintId'='pol03-group') then raise exception 'POL03 participant group overlap was accepted: %',v_result; end if;
  update public.assignments set day='Tuesday',start_time='17:00',end_time='18:30' where id='pol04-other-assignment';

  v_node:=jsonb_build_object('id','pol03-max','kind','MAX_ATTENDANCE_DAYS','ruleIds',jsonb_build_array('STU-013'),'selector',jsonb_build_object('participantIds',jsonb_build_array('pol04-student-a')),'parameters',jsonb_build_object('maxDays',1),'explanation','POL03 max');
  update public.constraint_model_versions set snapshot=jsonb_set(v_original,'{hardConstraints}',(v_original->'hardConstraints')||jsonb_build_array(v_node)),snapshot_hash=private.constraint_model_hash_v27(jsonb_set(v_original,'{hardConstraints}',(v_original->'hardConstraints')||jsonb_build_array(v_node))) where id=v_model_id;
  select private.validate_typed_schedule_v54(v_schedule_id) into v_result;
  if not exists(select 1 from jsonb_array_elements(v_result->'violations') item where item->>'constraintId'='pol03-max') then raise exception 'POL03 maximum attendance days was accepted: %',v_result; end if;

  v_node:=jsonb_build_object('id','pol03-direct','kind','DIRECTLY_AFTER','ruleIds',jsonb_build_array('SEQ-005'),'selector',jsonb_build_object('sessionIds',jsonb_build_array('pol04-session','pol04-other-session')),'parameters',jsonb_build_object('predecessorSessionId','pol04-session','successorSessionId','pol04-other-session'),'explanation','POL03 direct');
  update public.constraint_model_versions set snapshot=jsonb_set(v_original,'{hardConstraints}',(v_original->'hardConstraints')||jsonb_build_array(v_node)),snapshot_hash=private.constraint_model_hash_v27(jsonb_set(v_original,'{hardConstraints}',(v_original->'hardConstraints')||jsonb_build_array(v_node))) where id=v_model_id;
  update public.assignments set day='Monday',start_time='18:30',end_time='20:00' where id='pol04-other-assignment';
  select private.validate_typed_schedule_v54(v_schedule_id) into v_result;
  if exists(select 1 from jsonb_array_elements(v_result->'violations') item where item->>'constraintId'='pol03-direct') then raise exception 'POL03 direct equality boundary was rejected: %',v_result; end if;
  update public.assignments set start_time='18:45',end_time='20:15' where id='pol04-other-assignment';
  select private.validate_typed_schedule_v54(v_schedule_id) into v_result;
  if not exists(select 1 from jsonb_array_elements(v_result->'violations') item where item->>'constraintId'='pol03-direct') then raise exception 'POL03 direct gap was accepted: %',v_result; end if;

  v_node:=jsonb_build_object('id','pol03-arrival','kind','LINKED_ARRIVAL','ruleIds',jsonb_build_array('KAR-009'),'selector',jsonb_build_object('teacherIds',jsonb_build_array('pol04-teacher'),'participantIds',jsonb_build_array('pol04-student-b')),'parameters',jsonb_build_object('teacherId','pol04-teacher','participantId','pol04-student-b','minOffsetMinutes',-15,'maxOffsetMinutes',30),'explanation','POL03 arrival');
  update public.constraint_model_versions set snapshot=jsonb_set(v_original,'{hardConstraints}',(v_original->'hardConstraints')||jsonb_build_array(v_node)),snapshot_hash=private.constraint_model_hash_v27(jsonb_set(v_original,'{hardConstraints}',(v_original->'hardConstraints')||jsonb_build_array(v_node))) where id=v_model_id;
  update public.assignments set day='Monday',start_time='16:30',end_time='18:00' where id='pol04-other-assignment';
  select private.validate_typed_schedule_v54(v_schedule_id) into v_result;
  if exists(select 1 from jsonb_array_elements(v_result->'violations') item where item->>'constraintId'='pol03-arrival') then raise exception 'POL03 inclusive arrival boundary was rejected: %',v_result; end if;
  update public.assignments set start_time='16:15',end_time='17:45' where id='pol04-other-assignment';
  select private.validate_typed_schedule_v54(v_schedule_id) into v_result;
  if not exists(select 1 from jsonb_array_elements(v_result->'violations') item where item->>'constraintId'='pol03-arrival') then raise exception 'POL03 out-of-range arrival was accepted: %',v_result; end if;

  select private.build_solver_context_token_v43(v_studio) into v_context;
  select count(*) into v_schedules from public.schedule_versions where studio_id=v_studio;
  select count(*) into v_assignments from public.assignments where studio_id=v_studio;
  select count(*) into v_audits from public.audit_events where studio_id=v_studio;
  begin
    perform public.apply_authoritative_move_v46(v_studio,'10000000-0000-4000-8000-000000000001','pol04-assignment','{"startTime":"18:00"}'::jsonb,'POL03 no-write',v_context,'{"valid":true,"hardViolations":0,"fullyValidated":true}'::jsonb,false);
  exception when others then
    if position('HARD_VALIDATION_' in sqlerrm)=0 then raise; end if; v_rejected:=true;
  end;
  if not v_rejected then raise exception 'POL03 invalid canonical move was accepted'; end if;
  if (select count(*) from public.schedule_versions where studio_id=v_studio)<>v_schedules or (select count(*) from public.assignments where studio_id=v_studio)<>v_assignments or (select count(*) from public.audit_events where studio_id=v_studio)<>v_audits then raise exception 'POL03 rejected move wrote canonical/version/audit state'; end if;

  update public.assignments set day='Tuesday',start_time='17:00',end_time='18:30' where id='pol04-other-assignment';
  update public.constraint_model_versions set snapshot=v_original,snapshot_hash=private.constraint_model_hash_v27(v_original) where id=v_model_id;
end
$block$;

select 'POL-03 PASS: typed SQL participant, attendance, direct-after, linked-arrival, boundary and no-write evidence' as result;

do $block$
declare
  v_studio uuid := '11111111-1111-4111-8111-111111111111';
  v_schedule public.schedule_versions%rowtype;
  v_result jsonb;
begin
  select * into v_schedule
  from public.schedule_versions
  where studio_id=v_studio and is_current;
  if v_schedule.id is null then
    raise exception 'POL04 fixture requires current ScheduleVersion and ConstraintModelVersion';
  end if;

  select public.validate_schedule_hard_v25(v_schedule.id) into v_result;
  if coalesce((v_result->>'valid')::boolean,false) is not true
     or coalesce((v_result->>'fullyValidated')::boolean,false) is not true
     or jsonb_array_length(coalesce(v_result->'violations','[]'::jsonb))<>0 then
    raise exception 'POL04 legal boundary unexpectedly failed: %',v_result;
  end if;
end
$block$;

-- Stable-ID binding survives presentation-only renames; the PlanningDataset
-- snapshot remains the authority for scheduling facts.
do $block$
declare v_result jsonb; v_schedule_id uuid;
begin
  select id into v_schedule_id from public.schedule_versions
  where studio_id='11111111-1111-4111-8111-111111111111' and is_current;
  update public.rooms set name='Renamed POL04 Room' where id='pol04-room';
  update public.class_definitions set name='Renamed POL04 Class' where id='pol04-class';
  select public.validate_schedule_hard_v25(v_schedule_id) into v_result;
  if coalesce((v_result->>'valid')::boolean,false) is not true
     or jsonb_array_length(coalesce(v_result->'violations','[]'::jsonb))<>0 then
    raise exception 'POL04 stable-ID rename boundary failed: %',v_result;
  end if;
end
$block$;

-- Closed days are rejected, while the exact end of an allowed operating window
-- and the exact start of a room-unavailable window remain legal [start,end).
do $block$
declare v_result jsonb; v_schedule_id uuid;
begin
  select id into v_schedule_id from public.schedule_versions
  where studio_id='11111111-1111-4111-8111-111111111111' and is_current;
  update public.assignments set day='Saturday' where id='pol04-assignment';
  select public.validate_schedule_hard_v25(v_schedule_id) into v_result;
  if not exists(select 1 from jsonb_array_elements(v_result->'violations') item where item->>'constraintId'='pol04-operating-windows') then
    raise exception 'POL04 closed-day violation was not rejected: %',v_result;
  end if;
  update public.assignments set day='Monday' where id='pol04-assignment';
end
$block$;

do $block$
declare v_result jsonb; v_schedule_id uuid;
begin
  select id into v_schedule_id from public.schedule_versions
  where studio_id='11111111-1111-4111-8111-111111111111' and is_current;
  select public.validate_schedule_hard_v25(v_schedule_id) into v_result;
  if exists(select 1 from jsonb_array_elements(v_result->'violations') item where item->>'constraintId'='pol04-room-unavailable') then
    raise exception 'POL04 half-open endpoint was incorrectly rejected: %',v_result;
  end if;
  update public.assignments
  set start_time='17:30',end_time='19:00'
  where id='pol04-assignment';
  select public.validate_schedule_hard_v25(v_schedule_id) into v_result;
  if not exists(select 1 from jsonb_array_elements(v_result->'violations') item where item->>'constraintId'='pol04-room-unavailable') then
    raise exception 'POL04 overlapping unavailable window was accepted: %',v_result;
  end if;
  update public.assignments
  set start_time='17:00',end_time='18:30'
  where id='pol04-assignment';
end
$block$;

-- Explicit qualification domains include an empty domain: the selected
-- teacher may be present but no class is qualified by an empty list.
do $block$
declare v_result jsonb; v_schedule_id uuid;
begin
  select id into v_schedule_id from public.schedule_versions
  where studio_id='11111111-1111-4111-8111-111111111111' and is_current;
  update public.assignments set teacher_id='pol04-teacher' where id='pol04-other-assignment';
  select public.validate_schedule_hard_v25(v_schedule_id) into v_result;
  if not exists(select 1 from jsonb_array_elements(v_result->'violations') item where item->>'constraintId'='pol04-teacher-domain') then
    raise exception 'POL04 qualification-domain violation was not rejected: %',v_result;
  end if;
  update public.assignments set teacher_id='pol04-other-teacher' where id='pol04-other-assignment';

  update public.constraint_model_versions cm
  set snapshot=jsonb_set(cm.snapshot,'{hardConstraints,2,parameters,classIds}','[]'::jsonb),
      snapshot_hash=private.constraint_model_hash_v27(jsonb_set(cm.snapshot,'{hardConstraints,2,parameters,classIds}','[]'::jsonb))
  where cm.version=(select constraint_model_version from public.schedule_versions where id=v_schedule_id)
    and cm.studio_id='11111111-1111-4111-8111-111111111111';
  select public.validate_schedule_hard_v25(v_schedule_id) into v_result;
  if not exists(select 1 from jsonb_array_elements(v_result->'violations') item where item->>'constraintId'='pol04-teacher-domain') then
    raise exception 'POL04 empty qualification domain was accepted: %',v_result;
  end if;
  update public.constraint_model_versions cm
  set snapshot=jsonb_set(cm.snapshot,'{hardConstraints,2,parameters,classIds}',jsonb_build_array('pol04-class')),
      snapshot_hash=private.constraint_model_hash_v27(jsonb_set(cm.snapshot,'{hardConstraints,2,parameters,classIds}',jsonb_build_array('pol04-class')))
  where cm.version=(select constraint_model_version from public.schedule_versions where id=v_schedule_id)
    and cm.studio_id='11111111-1111-4111-8111-111111111111';
end
$block$;

do $block$
declare v_result jsonb; v_schedule_id uuid;
begin
  select id into v_schedule_id from public.schedule_versions
  where studio_id='11111111-1111-4111-8111-111111111111' and is_current;
  update public.assignments set teacher_id='pol04-other-teacher' where id='pol04-assignment';
  select public.validate_schedule_hard_v25(v_schedule_id) into v_result;
  if not exists(select 1 from jsonb_array_elements(v_result->'violations') item where item->>'constraintId'='pol04-required-teacher') then
    raise exception 'POL04 required-teacher violation was not rejected: %',v_result;
  end if;
  update public.assignments set teacher_id='pol04-teacher' where id='pol04-assignment';

  update public.assignments set room_id='pol04-alt-room' where id='pol04-assignment';
  select public.validate_schedule_hard_v25(v_schedule_id) into v_result;
  if not exists(select 1 from jsonb_array_elements(v_result->'violations') item where item->>'constraintId'='pol04-required-room') then
    raise exception 'POL04 required-room violation was not rejected: %',v_result;
  end if;
  update public.assignments set room_id='pol04-room' where id='pol04-assignment';
end
$block$;

-- Required feature set semantics are subset inclusion. Refresh the pinned
-- PlanningDatasetVersion after changing a scheduling fact; never read the
-- mutable room row as a substitute for the pinned snapshot.
do $block$
declare v_result jsonb; v_schedule_id uuid; v_planning integer;
begin
  select id into v_schedule_id from public.schedule_versions
  where studio_id='11111111-1111-4111-8111-111111111111' and is_current;
  update public.rooms set features='{}' where id='pol04-room';
  select private.ensure_planning_dataset_version_v25(
    '11111111-1111-4111-8111-111111111111',null,'POL-04 disposable fixture','Test required feature inclusion'
  ) into v_planning;
  update public.schedule_versions set planning_dataset_version=v_planning where id=v_schedule_id;
  update public.planning_dataset_versions set confirmed_for_scheduling_at=now()
  where studio_id='11111111-1111-4111-8111-111111111111' and version=v_planning;
  select public.validate_schedule_hard_v25(v_schedule_id) into v_result;
  if not exists(select 1 from jsonb_array_elements(v_result->'violations') item where item->>'constraintId'='pol04-room-features') then
    raise exception 'POL04 required-feature inclusion violation was not rejected: %',v_result;
  end if;
  update public.rooms set features='{mirrors,sprung-floor}' where id='pol04-room';
  select private.ensure_planning_dataset_version_v25(
    '11111111-1111-4111-8111-111111111111',null,'POL-04 disposable fixture','Restore required feature inclusion fixture'
  ) into v_planning;
  update public.schedule_versions set planning_dataset_version=v_planning where id=v_schedule_id;
  update public.planning_dataset_versions set confirmed_for_scheduling_at=now()
  where studio_id='11111111-1111-4111-8111-111111111111' and version=v_planning;
end
$block$;

do $block$
declare v_result jsonb; v_schedule_id uuid; v_planning integer;
begin
  select id into v_schedule_id from public.schedule_versions
  where studio_id='11111111-1111-4111-8111-111111111111' and is_current;
  update public.rooms set capacity=1 where id='pol04-room';
  select private.ensure_planning_dataset_version_v25(
    '11111111-1111-4111-8111-111111111111',null,'POL-04 disposable fixture','Test PlanningDataset capacity'
  ) into v_planning;
  update public.schedule_versions set planning_dataset_version=v_planning where id=v_schedule_id;
  update public.planning_dataset_versions set confirmed_for_scheduling_at=now()
  where studio_id='11111111-1111-4111-8111-111111111111' and version=v_planning;
  select public.validate_schedule_hard_v25(v_schedule_id) into v_result;
  if not exists(select 1 from jsonb_array_elements(v_result->'violations') item where item->>'constraintId'='pol04-room-capacity') then
    raise exception 'POL04 room-capacity violation was not rejected: %',v_result;
  end if;

  update public.rooms set capacity=null where id='pol04-room';
  select private.ensure_planning_dataset_version_v25(
    '11111111-1111-4111-8111-111111111111',null,'POL-04 disposable fixture','Test missing PlanningDataset capacity'
  ) into v_planning;
  update public.schedule_versions set planning_dataset_version=v_planning where id=v_schedule_id;
  update public.planning_dataset_versions set confirmed_for_scheduling_at=now()
  where studio_id='11111111-1111-4111-8111-111111111111' and version=v_planning;
  select public.validate_schedule_hard_v25(v_schedule_id) into v_result;
  if not exists(select 1 from jsonb_array_elements(v_result->'violations') item where item->>'constraintId'='pol04-room-capacity') then
    raise exception 'POL04 missing capacity was accepted: %',v_result;
  end if;

  update public.rooms set capacity=2 where id='pol04-room';
  select private.ensure_planning_dataset_version_v25(
    '11111111-1111-4111-8111-111111111111',null,'POL-04 disposable fixture','Restore PlanningDataset capacity'
  ) into v_planning;
  update public.schedule_versions set planning_dataset_version=v_planning where id=v_schedule_id;
  update public.planning_dataset_versions set confirmed_for_scheduling_at=now()
  where studio_id='11111111-1111-4111-8111-111111111111' and version=v_planning;
  select public.validate_schedule_hard_v25(v_schedule_id) into v_result;
  if coalesce((v_result->>'valid')::boolean,false) is not true
     or jsonb_array_length(coalesce(v_result->'violations','[]'::jsonb))<>0 then
    raise exception 'POL04 restored legal capacity fixture failed: %',v_result;
  end if;
end
$block$;

-- Missing and duplicate stable references fail closed as model errors.
do $block$
declare v_result jsonb; v_schedule_id uuid; v_model_id uuid; v_original jsonb; v_bad jsonb;
begin
  select sv.id,cm.id into v_schedule_id,v_model_id
  from public.schedule_versions sv
  join public.constraint_model_versions cm
    on cm.studio_id=sv.studio_id and cm.version=sv.constraint_model_version
  where sv.studio_id='11111111-1111-4111-8111-111111111111' and sv.is_current;
  select snapshot into v_original from public.constraint_model_versions where id=v_model_id;
  v_bad:=jsonb_set(v_original,'{hardConstraints,4,selector,roomIds}',jsonb_build_array('pol04-missing-room'));
  update public.constraint_model_versions
  set snapshot=v_bad,snapshot_hash=private.constraint_model_hash_v27(v_bad) where id=v_model_id;
  select public.validate_schedule_hard_v25(v_schedule_id) into v_result;
  if coalesce((v_result->>'valid')::boolean,true)
     or not exists(select 1 from jsonb_array_elements(v_result->'typedSqlSafeguard'->'modelErrors') item where item #>> '{}' like '%missing PlanningDataset room%') then
    raise exception 'POL04 missing model reference did not fail closed: %',v_result;
  end if;
  update public.constraint_model_versions
  set snapshot=v_original,snapshot_hash=private.constraint_model_hash_v27(v_original) where id=v_model_id;

  v_bad:=jsonb_set(v_original,'{hardConstraints,4,selector,classIds}',jsonb_build_array('pol04-class','pol04-class'));
  update public.constraint_model_versions
  set snapshot=v_bad,snapshot_hash=private.constraint_model_hash_v27(v_bad) where id=v_model_id;
  select public.validate_schedule_hard_v25(v_schedule_id) into v_result;
  if coalesce((v_result->>'valid')::boolean,true)
     or not exists(select 1 from jsonb_array_elements(v_result->'typedSqlSafeguard'->'modelErrors') item where item #>> '{}' like '%repeats a stable class reference%') then
    raise exception 'POL04 duplicate model reference did not fail closed: %',v_result;
  end if;
  update public.constraint_model_versions
  set snapshot=v_original,snapshot_hash=private.constraint_model_hash_v27(v_original) where id=v_model_id;
end
$block$;

-- Canonical candidate adoption, MOVE and REBASE all reject an illegal
-- placement even when the caller claims valid:true, and each rejection leaves
-- canonical/version/model/audit rows unchanged.
do $block$
declare
  v_studio uuid := '11111111-1111-4111-8111-111111111111';
  v_schedule public.schedule_versions%rowtype;
  v_context jsonb;
  v_candidate jsonb;
  v_result jsonb;
  v_rejected boolean:=false;
  v_schedules bigint; v_assignments bigint; v_models bigint; v_planning bigint; v_audits bigint;
begin
  select * into v_schedule from public.schedule_versions where studio_id=v_studio and is_current;
  select private.build_solver_candidate_context_v44(v_studio) into v_context;
  v_candidate:=jsonb_build_array(
    jsonb_build_object('sessionId','pol04-session','day','Monday','startTime','16:00','endTime','17:30','teacherId','pol04-teacher','roomId','pol04-room'),
    jsonb_build_object('sessionId','pol04-other-session','day','Tuesday','startTime','17:00','endTime','18:30','teacherId','pol04-other-teacher','roomId','pol04-room')
  );
  select count(*) into v_schedules from public.schedule_versions where studio_id=v_studio;
  select count(*) into v_assignments from public.assignments where studio_id=v_studio;
  select count(*) into v_models from public.constraint_model_versions where studio_id=v_studio;
  select count(*) into v_planning from public.planning_dataset_versions where studio_id=v_studio;
  select count(*) into v_audits from public.audit_events where studio_id=v_studio;
  begin
    select public.adopt_solver_candidate_v49(
      v_studio,'10000000-0000-4000-8000-000000000001','POL04 owner','POL04 candidate SQL safeguard',
      v_context,v_candidate,'{"valid":true,"hardViolations":0,"fullyValidated":true}'::jsonb
    ) into v_result;
  exception when others then
    -- SET-07 adds the transaction-level certification gate before the
    -- historical HARD validator. Accept either rejection here; the focused
    -- SET-07 regression proves the new gate and this legacy fixture continues
    -- to prove no canonical rows are written.
    if position('LEGACY_HARD_VALIDATION_FAILED' in sqlerrm)=0
       and position('PLANNING_DATASET_NOT_CERTIFIED' in sqlerrm)=0
       and position('PLANNING_CERTIFICATION_STALE' in sqlerrm)=0 then raise; end if;
    v_rejected:=true;
  end;
  if not v_rejected then raise exception 'POL04 candidate adoption accepted caller-claimed valid:true'; end if;
  if (select count(*) from public.schedule_versions where studio_id=v_studio)<>v_schedules
     or (select count(*) from public.assignments where studio_id=v_studio)<>v_assignments
     or (select count(*) from public.constraint_model_versions where studio_id=v_studio)<>v_models
     or (select count(*) from public.planning_dataset_versions where studio_id=v_studio)<>v_planning
     or (select count(*) from public.audit_events where studio_id=v_studio)<>v_audits then
    raise exception 'POL04 candidate rejection changed canonical/version/audit rows';
  end if;

  v_rejected:=false;
  select private.build_solver_context_token_v43(v_studio) into v_context;
  select count(*) into v_schedules from public.schedule_versions where studio_id=v_studio;
  select count(*) into v_assignments from public.assignments where studio_id=v_studio;
  select count(*) into v_models from public.constraint_model_versions where studio_id=v_studio;
  select count(*) into v_planning from public.planning_dataset_versions where studio_id=v_studio;
  select count(*) into v_audits from public.audit_events where studio_id=v_studio;
  begin
    select public.apply_authoritative_move_v46(
      v_studio,'10000000-0000-4000-8000-000000000001','pol04-assignment',
      '{"startTime":"16:00"}'::jsonb,'POL04 MOVE SQL safeguard',v_context,
      '{"valid":true,"hardViolations":0,"fullyValidated":true}'::jsonb,false
    ) into v_result;
  exception when others then
    if position('HARD_VALIDATION_FAILED' in sqlerrm)=0 then raise; end if;
    v_rejected:=true;
  end;
  if not v_rejected then raise exception 'POL04 MOVE accepted caller-claimed valid:true'; end if;
  if (select count(*) from public.schedule_versions where studio_id=v_studio)<>v_schedules
     or (select count(*) from public.assignments where studio_id=v_studio)<>v_assignments
     or (select count(*) from public.constraint_model_versions where studio_id=v_studio)<>v_models
     or (select count(*) from public.planning_dataset_versions where studio_id=v_studio)<>v_planning
     or (select count(*) from public.audit_events where studio_id=v_studio)<>v_audits then
    raise exception 'POL04 MOVE rejection changed canonical/version/audit rows';
  end if;

  v_rejected:=false;
  update public.assignments
  set start_time='16:00',end_time='17:30'
  where id='pol04-assignment';
  select private.build_solver_context_token_v43(v_studio) into v_context;
  v_candidate:=jsonb_build_array(
    jsonb_build_object('assignmentId','pol04-assignment','sessionId','pol04-session','day','Monday','startTime','16:00','endTime','17:30','teacherId','pol04-teacher','roomId','pol04-room','status','NORMAL'),
    jsonb_build_object('assignmentId','pol04-other-assignment','sessionId','pol04-other-session','day','Tuesday','startTime','17:00','endTime','18:30','teacherId','pol04-other-teacher','roomId','pol04-room','status','NORMAL')
  );
  select count(*) into v_schedules from public.schedule_versions where studio_id=v_studio;
  select count(*) into v_assignments from public.assignments where studio_id=v_studio;
  select count(*) into v_models from public.constraint_model_versions where studio_id=v_studio;
  select count(*) into v_planning from public.planning_dataset_versions where studio_id=v_studio;
  select count(*) into v_audits from public.audit_events where studio_id=v_studio;
  begin
    select public.apply_authoritative_schedule_recovery_v48(
      'REBASE',v_studio,'10000000-0000-4000-8000-000000000001',v_schedule.id,
      'POL04 REBASE SQL safeguard',v_context,v_candidate,
      '{"valid":true,"hardViolations":0,"fullyValidated":true}'::jsonb,
      '{"scheduleComplete":true,"publishable":true,"unscheduledSessionIds":[],"duplicateSessionIds":[],"unknownAssignmentSessionIds":[],"completenessObligationKeys":[],"retiredAssignmentIds":[]}'::jsonb
    ) into v_result;
  exception when others then
    if position('RECOVERY_PUBLISHABILITY_MISMATCH' in sqlerrm)=0 then raise; end if;
    v_rejected:=true;
  end;
  if not v_rejected then raise exception 'POL04 REBASE accepted caller-claimed valid:true'; end if;
  if (select count(*) from public.schedule_versions where studio_id=v_studio)<>v_schedules
     or (select count(*) from public.assignments where studio_id=v_studio)<>v_assignments
     or (select count(*) from public.constraint_model_versions where studio_id=v_studio)<>v_models
     or (select count(*) from public.planning_dataset_versions where studio_id=v_studio)<>v_planning
     or (select count(*) from public.audit_events where studio_id=v_studio)<>v_audits then
    raise exception 'POL04 REBASE rejection changed canonical/version/audit rows';
  end if;
  update public.assignments
  set start_time='17:00',end_time='18:30'
  where id='pol04-assignment';
end
$block$;

-- Publication still rejects incomplete models before any model/version/audit
-- row is written.
do $block$
declare v_before bigint; v_rejected boolean:=false; v_result jsonb;
begin
  select count(*) into v_before from public.constraint_model_versions where studio_id='11111111-1111-4111-8111-111111111111';
  begin
    select public.publish_server_constraint_model_v49(
      '11111111-1111-4111-8111-111111111111',
      '10000000-0000-4000-8000-000000000001',
      '{"schemaVersion":"1.0","compilerVersion":"pol04-invalid","hardConstraints":[],"uncompiledConstraintRuleIds":[],"completeHardConstraintCompilation":false}'::jsonb,
      'POL04 incomplete publication rejection',
      (select version from public.rulebook_versions where studio_id='11111111-1111-4111-8111-111111111111' and status='CURRENT')
    ) into v_result;
  exception when others then
    if position('Only complete HARD Constraint IR models may be published' in sqlerrm)=0
       and position('Constraint model Rulebook version does not match row' in sqlerrm)=0 then raise; end if;
    v_rejected:=true;
  end;
  if not v_rejected then raise exception 'POL04 incomplete model publication was accepted'; end if;
  if (select count(*) from public.constraint_model_versions where studio_id='11111111-1111-4111-8111-111111111111')<>v_before then
    raise exception 'POL04 rejected publication changed model/version rows';
  end if;
end
$block$;

rollback to savepoint pol04_regression;
release savepoint pol04_regression;
reset role;
select 'POL-04 PASS: typed SQL families, pinned facts, boundaries, model references, canonical rejection and no-write evidence' as result;
`;

export async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const targetEnvironment = { ...process.env };
  if (args.target !== null) targetEnvironment.STUDIO_SCHEDULER_TEST_DB_TARGET = args.target;
  assertDisposableTarget(targetEnvironment);
  if (args.checkTarget) {
    process.stdout.write('Disposable target check passed; no database connection was opened.\n');
    return;
  }
  if (!args.allowDisposable) {
    throw new DatabaseHarnessError(
      'Refusing to run without an explicit disposable opt-in. Use npm run test:db or pass --allow-disposable.',
    );
  }
  await runHarness(args.onlyPol04, args.onlyOps01);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  main().catch((error) => {
    process.stderr.write(`Actionable setup failure: ${error.message}\n`);
    process.exitCode = 1;
  });
}
