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

  v_first:=public.publish_constraint_model_v30(v_submitted,'T03 JSONB publication',v_rulebook);
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

  v_republished:=public.publish_constraint_model_v30(v_reordered,'T03 JSONB reordered read-back',v_rulebook);
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
set role service_role;
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
set role service_role;
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
select public.confirm_current_planning_dataset_v39(
  version,snapshot_hash,'T06 confirmed class restore with resources still archived',
  '{"peopleInventoryReviewed":true,"classSessionCatalogReviewed":true,"classRostersReviewed":true,"sourceAndCompletenessReviewed":true}'::jsonb
)
from public.planning_dataset_versions
where studio_id='11111111-1111-4111-8111-111111111111' and status='CURRENT';
reset role;

set role service_role;
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
select public.confirm_current_planning_dataset_v39(
  version,snapshot_hash,'T06 reconfirmed fully restored active inventory',
  '{"peopleInventoryReviewed":true,"classSessionCatalogReviewed":true,"classRostersReviewed":true,"sourceAndCompletenessReviewed":true}'::jsonb
)
from public.planning_dataset_versions
where studio_id='11111111-1111-4111-8111-111111111111' and status='CURRENT';
reset role;

set role service_role;
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

function psql(container, user, sql, label) {
  const result = runProcess(
    'docker',
    ['exec', '-i', container, 'psql', '-X', '-v', 'ON_ERROR_STOP=1', '-h', '127.0.0.1', '-U', user, '-d', 'postgres', '-f', '-'],
    sql,
  );
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

async function waitForDatabase(container) {
  for (let attempt = 1; attempt <= 45; attempt += 1) {
    const result = runProcess('docker', ['exec', container, 'pg_isready', '-h', '127.0.0.1', '-U', 'postgres', '-d', 'postgres']);
    if (result.status === 0) return;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new DatabaseHarnessError('PostgreSQL did not become ready within 45 seconds. Check Docker Desktop and retry.');
}

async function runHarness() {
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
    const output = psql(container, 'authenticated', roleTestSql, 'owner/editor/viewer/nonmember integration tests');
    process.stdout.write(output);
    const constraintModelOutput = psql(container, 'authenticated', constraintModelRoundTripSql, 'Constraint Model JSONB round-trip integration tests');
    process.stdout.write(constraintModelOutput);
    psql(container, 'postgres', candidateIntervalFixtureSql, 'T04 candidate interval fixture');
    psql(container, 'authenticated', planningConfirmationSql, 'T04 planning confirmation');
    const candidateIntervalOutput = psql(container, 'postgres', candidateIntervalAdoptionSql, 'T04 candidate interval adoption integration tests');
    process.stdout.write(candidateIntervalOutput);
    const archiveAwareOutput = psql(container, 'postgres', archiveAwareAdoptionSql, 'T06 archive-aware adoption integration tests');
    process.stdout.write(archiveAwareOutput);
    const coherentSnapshotOutput = psql(container, 'postgres', coherentSolverSnapshotSql, 'T07 coherent solver snapshot integration tests');
    process.stdout.write(coherentSnapshotOutput);
  } finally {
    if (running) {
      const result = runProcess('docker', ['rm', '--force', container]);
      if (result.status !== 0) process.stderr.write(`Warning: disposable container cleanup failed: ${outputFor(result)}\n`);
    }
  }
}

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
  await runHarness();
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  main().catch((error) => {
    process.stderr.write(`Actionable setup failure: ${error.message}\n`);
    process.exitCode = 1;
  });
}
