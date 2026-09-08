import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdtempSync,
  openSync,
  closeSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const studioId = '11111111-1111-4111-8111-111111111111';
const ownerEmail = 'verify01-owner@example.test';
const requiredSupabaseCliVersion = '2.117.0';
const playwrightVersion = '1.62.1';
const productionProjectHost = 'kbgzrefivxqoiwumfyui.supabase.co';

class E2EHarnessError extends Error {}

function executable(name) {
  return process.platform === 'win32' ? `${name}.cmd` : name;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? repoRoot,
    env: options.env ?? process.env,
    encoding: 'utf8',
    input: options.input,
    maxBuffer: 64 * 1024 * 1024,
    timeout: options.timeout ?? 10 * 60 * 1000,
    windowsHide: true,
  });
  if (result.error) throw new E2EHarnessError(`${command} could not be started: ${result.error.message}`);
  if (result.status !== 0) {
    const output = [result.stdout, result.stderr].filter(Boolean).join('\n').trim();
    throw new E2EHarnessError(`${command} ${args[0] ?? ''} failed with exit ${result.status}.\n${output}`);
  }
  return result;
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function isLoopbackHost(host) {
  return host === 'localhost' || host === '127.0.0.1' || host === '::1';
}

export function assertLoopbackUrl(name, value) {
  if (!value?.trim()) return;
  let parsed;
  try {
    parsed = new URL(value.trim());
  } catch {
    throw new E2EHarnessError(`${name} is not a valid URL.`);
  }
  const host = parsed.hostname.toLowerCase();
  if (host === productionProjectHost || value.includes(productionProjectHost)) {
    throw new E2EHarnessError(`Refusing production target from ${name}. VERIFY-01 is disposable-only.`);
  }
  if (!isLoopbackHost(host)) {
    throw new E2EHarnessError(`Refusing external target from ${name}: ${host}. VERIFY-01 accepts loopback URLs only.`);
  }
}

function assertExistingEnvironmentIsSafe(env = process.env) {
  for (const name of ['NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_URL', 'STUDIO_SCHEDULER_TEST_DB_URL']) {
    assertLoopbackUrl(name, env[name]);
  }
}

function ensureSupabaseCli() {
  const result = run('supabase', ['--version']);
  const version = result.stdout.trim().replace(/^v/, '');
  if (version !== requiredSupabaseCliVersion) {
    throw new E2EHarnessError(
      `VERIFY-01 requires Supabase CLI ${requiredSupabaseCliVersion}; found ${version || 'unknown'}. `
      + 'CI pins the required version with supabase/setup-cli.',
    );
  }
}

function ensurePlaywright() {
  const packagePath = path.join(repoRoot, 'node_modules', '@playwright', 'test', 'package.json');
  const installed = existsSync(packagePath) ? JSON.parse(readFileSync(packagePath, 'utf8')).version : null;
  if (installed !== playwrightVersion) {
    run(executable('npm'), [
      'install', '--no-save', '--package-lock=false', '--ignore-scripts', '--no-audit', '--no-fund',
      `@playwright/test@${playwrightVersion}`,
    ]);
  }

  const cli = path.join(repoRoot, 'node_modules', '@playwright', 'test', 'cli.js');
  if (!existsSync(cli)) throw new E2EHarnessError('Pinned Playwright CLI was not installed.');
  const installArgs = [cli, 'install'];
  if (process.platform === 'linux') installArgs.push('--with-deps');
  installArgs.push('chromium');
  run(process.execPath, installArgs, { timeout: 10 * 60 * 1000 });
  return cli;
}

function setTomlValue(text, section, key, rawValue, required = true) {
  const lines = text.split(/\r?\n/);
  let currentSection = null;
  let replaced = false;
  for (let index = 0; index < lines.length; index += 1) {
    const sectionMatch = lines[index].match(/^\s*\[([^\]]+)\]\s*$/);
    if (sectionMatch) {
      currentSection = sectionMatch[1];
      continue;
    }
    if (currentSection !== section) continue;
    const keyMatch = lines[index].match(new RegExp(`^(\\s*)${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*=`));
    if (!keyMatch) continue;
    lines[index] = `${keyMatch[1]}${key} = ${rawValue}`;
    replaced = true;
    break;
  }
  if (required && !replaced) throw new E2EHarnessError(`Generated Supabase config is missing [${section}] ${key}.`);
  return lines.join('\n');
}

function ensureInbucketSection(text, ports) {
  if (/^\s*\[inbucket\]\s*$/m.test(text)) return text;
  return `${text.trimEnd()}\n\n[inbucket]\nenabled = true\nport = ${ports.mailpit}\nsmtp_port = ${ports.smtp}\npop3_port = ${ports.pop3}\n`;
}

function configureSupabaseProject(tempRoot, ports, projectId) {
  const configPath = path.join(tempRoot, 'supabase', 'config.toml');
  let config = readFileSync(configPath, 'utf8');
  config = ensureInbucketSection(config, ports);
  config = config.replace(/^project_id\s*=.*$/m, `project_id = "${projectId}"`);
  config = setTomlValue(config, 'api', 'port', String(ports.api));
  config = setTomlValue(config, 'db', 'port', String(ports.db));
  config = setTomlValue(config, 'db', 'shadow_port', String(ports.shadow));
  config = setTomlValue(config, 'studio', 'port', String(ports.studio), false);
  config = setTomlValue(config, 'inbucket', 'port', String(ports.mailpit));
  config = setTomlValue(config, 'inbucket', 'smtp_port', String(ports.smtp));
  config = setTomlValue(config, 'inbucket', 'pop3_port', String(ports.pop3));
  config = setTomlValue(config, 'analytics', 'port', String(ports.analytics), false);
  config = setTomlValue(config, 'db.pooler', 'port', String(ports.pooler), false);
  config = setTomlValue(config, 'edge_runtime', 'inspector_port', String(ports.inspector), false);
  config = setTomlValue(config, 'auth', 'site_url', `"${ports.appUrl}"`);
  config = setTomlValue(config, 'auth', 'additional_redirect_urls', `["${ports.appUrl}"]`);
  writeFileSync(configPath, config, 'utf8');
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
  const names = archiveFiles.map((file) => path.basename(file));
  if (JSON.stringify(names) !== JSON.stringify(manifest.entries.map((entry) => entry.file))) {
    throw new E2EHarnessError('Production-ledger archive does not match manifest.json.');
  }
  for (const entry of manifest.entries) {
    const bytes = readFileSync(path.join(repoRoot, 'supabase', 'production-ledger', entry.file));
    const blobHeader = Buffer.from(`blob ${bytes.length}\0`, 'utf8');
    const sha = createHash('sha1').update(Buffer.concat([blobHeader, bytes])).digest('hex');
    if (bytes.length !== entry.bytes || sha !== entry.git_blob_sha1) {
      throw new E2EHarnessError(`Production-ledger integrity check failed for ${entry.file}.`);
    }
  }
}

function preparedBootstrap() {
  const file = path.join(repoRoot, 'supabase', 'bootstrap', '2026-08-31-production-schema-baseline.sql');
  const bootstrap = readFileSync(file, 'utf8');
  const vaultExtension = /^create extension if not exists supabase_vault;\r?\n?/im;
  if (!vaultExtension.test(bootstrap)) throw new E2EHarnessError('Bootstrap Vault extension boundary changed unexpectedly.');
  return bootstrap.replace(vaultExtension, '');
}

const compatibilityBridge = String.raw`
alter table public.entity_versions add column if not exists version integer;
alter table public.entity_versions add column if not exists before_entity jsonb;
alter table public.entity_versions add column if not exists after_entity jsonb;
update public.entity_versions
set version=coalesce(version,1), before_entity=coalesce(before_entity,before_data), after_entity=coalesce(after_entity,after_data,'{}'::jsonb)
where version is null or before_entity is null or after_entity is null;
alter table public.entity_versions alter column version set not null;
alter table public.entity_versions alter column after_entity set not null;
create unique index if not exists entity_versions_studio_entity_version_uq on public.entity_versions(studio_id,entity_type,entity_id,version);
create or replace function public.apply_rule_patch(text,text,jsonb,text,boolean) returns jsonb language plpgsql security definer set search_path='' as $function$ begin raise exception 'Legacy rule mutation RPC is unavailable'; end $function$;
create or replace function public.apply_schedule_patch(text,jsonb,text,jsonb,boolean) returns jsonb language plpgsql security definer set search_path='' as $function$ begin raise exception 'Legacy schedule mutation RPC is unavailable'; end $function$;
create or replace function public.import_canonical_rulebook(jsonb,text) returns jsonb language plpgsql security definer set search_path='' as $function$ begin raise exception 'Legacy canonical import RPC is unavailable'; end $function$;
create or replace function public.import_reviewed_rulebook(jsonb,text,text) returns jsonb language plpgsql security definer set search_path='' as $function$ begin raise exception 'Legacy reviewed import RPC is unavailable'; end $function$;
`;

const rulebookMigrationPrereqSql = String.raw`
insert into public.rules(
  id,studio_id,category,type,title,description,strength,status,verification_status,affected_entity_ids,parameters,exceptions,source,version_introduced,classification_raw,review_status,review,source_raw,enforcement_status
) values
('OPS-002','${studioId}','OPS','TEST_FIXTURE','Weekday 4:30 start exceptions','Only Elementary 1, Elementary 2, Level 4B, and 4B/5 levels may start at 4:30 PM. 4:45 PM remains the preferred normal weekday start time.','HARD','ACTIVE','VERIFIED','{}','{}','[]','{}',2,'HARD','VERIFIED','{}','{}','NOT_IMPLEMENTED'),
('ADV-004','${studioId}','ADV','TEST_FIXTURE','Kiran Landis lower-level exception','Kiran Landis has more flexibility than the normal lower-level rule; pursue lower-level placement, but do not treat it with the same hard rigidity as the general requirement.','HARD','ACTIVE','VERIFIED','{}','{}','[]','{}',2,'HARD','VERIFIED','{}','{}','NOT_IMPLEMENTED');
insert into public.rules(
  id,studio_id,category,type,title,description,strength,status,verification_status,affected_entity_ids,parameters,exceptions,source,version_introduced,classification_raw,review_status,review,source_raw,enforcement_status
)
select 'VERIFY01-MIGRATION-'||lpad(n::text,3,'0'),'${studioId}','TEST','TEST_FIXTURE','Migration fixture '||n,'Deidentified migration prerequisite only.','LIGHT','ACTIVE','VERIFIED','{}','{}','[]','{}',2,'LIGHT','VERIFIED','{}','{}','NOT_IMPLEMENTED'
from generate_series(1,176) as s(n);
insert into public.rulebook_versions(
  studio_id,version,name,actor_label,reason,changed_rule_ids,snapshot,rulebook_id,status,source_hash,rule_count,parent_version,format_version,document_type,source_metadata
)
select '${studioId}',2,'VERIFY-01 migration prerequisite','VERIFY-01 fixture','Schema replay prerequisite','{}',coalesce(jsonb_agg(to_jsonb(r) order by r.id),'[]'::jsonb),
  'dwde-2026-2027-master-rulebook','CURRENT',encode(extensions.digest(pg_catalog.convert_to(coalesce(jsonb_agg(to_jsonb(r) order by r.id),'[]'::jsonb)::text,'UTF8'),'sha256'),'hex'),
  count(*)::integer,null,'2.0','DWDE_SITE_RULEBOOK','{"fixture":"VERIFY-01-migration-prerequisite"}'::jsonb
from public.rules r where r.studio_id='${studioId}';
`;

function applySql(dbContainer, sql, label) {
  process.stdout.write(`Applying ${label}\n`);
  run('docker', [
    'exec', '-i', dbContainer, 'psql', '-X', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', 'postgres',
  ], { input: `begin;\n${sql}\ncommit;\n` });
}

function findDatabaseContainer(projectId) {
  const names = run('docker', ['ps', '--format', '{{.Names}}']).stdout.split(/\r?\n/).filter(Boolean);
  const exact = `supabase_db_${projectId}`;
  const match = names.find((name) => name === exact) ?? names.find((name) => name.startsWith('supabase_db_') && name.includes(projectId));
  if (!match) throw new E2EHarnessError(`Could not find disposable Supabase database container for ${projectId}.`);
  return match;
}

function replayRepositorySchema(dbContainer) {
  const archiveFiles = sqlFiles(path.join(repoRoot, 'supabase', 'production-ledger'));
  const migrationFiles = sqlFiles(path.join(repoRoot, 'supabase', 'migrations'));
  validateArchiveManifest(archiveFiles);
  applySql(dbContainer, preparedBootstrap(), 'bootstrap schema');
  applySql(dbContainer, compatibilityBridge, 'bootstrap/archive compatibility bridge');
  for (const file of archiveFiles) applySql(dbContainer, readFileSync(file, 'utf8'), `archived migration ${path.basename(file)}`);
  for (const file of migrationFiles) {
    if (path.basename(file) === '20260902130713_rulebook_v3_post_review_confirmations.sql') {
      applySql(dbContainer, rulebookMigrationPrereqSql, 'deidentified Rulebook V3 migration prerequisite');
    }
    applySql(dbContainer, readFileSync(file, 'utf8'), `forward migration ${path.basename(file)}`);
  }
}

function syntheticFixtureSql(ownerUserId) {
  const model = JSON.stringify({
    schemaVersion: '1.0',
    compilerVersion: 'dwde-ir-0.3',
    rulebookVersion: 1,
    activeRuleCount: 0,
    hardConstraints: [],
    objectivePrioritySpine: [],
    readinessRuleIds: [],
    governanceAssertions: [],
    uncompiledConstraintRuleIds: [],
    completeHardConstraintCompilation: true,
  });
  return String.raw`
set search_path=public,extensions;
delete from public.assignments where studio_id='${studioId}';
delete from public.schedule_versions where studio_id='${studioId}';
delete from public.scenarios where studio_id='${studioId}';
delete from public.constraint_model_versions where studio_id='${studioId}';
delete from public.rule_enforcement_proposals where studio_id='${studioId}';
delete from public.rule_enforcement_versions where studio_id='${studioId}';
delete from public.rule_history where studio_id='${studioId}';
delete from public.audit_events where studio_id='${studioId}';
delete from public.entity_versions where studio_id='${studioId}';
delete from public.planning_dataset_versions where studio_id='${studioId}';
delete from public.rules where studio_id='${studioId}';
delete from public.rulebook_versions where studio_id='${studioId}';
delete from public.class_sessions where studio_id='${studioId}';
delete from public.class_definitions where studio_id='${studioId}';
delete from public.students where studio_id='${studioId}';
delete from public.cohorts where studio_id='${studioId}';
delete from public.teachers where studio_id='${studioId}';
delete from public.rooms where studio_id='${studioId}';
delete from public.studio_invites where studio_id='${studioId}';
delete from public.studio_members where studio_id='${studioId}';
do $block$ begin
  if to_regclass('public.planning_source_manifest_versions') is not null then
    delete from public.planning_source_manifest_versions where studio_id='${studioId}';
  end if;
end $block$;

update public.studios set name='VERIFY-01 Synthetic Studio', slug='verify01-synthetic' where id='${studioId}';
insert into public.studio_members(studio_id,user_id,role) values('${studioId}','${ownerUserId}','OWNER');
insert into public.teachers(id,studio_id,name,subjects,notes) values('verify01-teacher','${studioId}','Verify Teacher','{}','Synthetic browser fixture');
insert into public.rooms(id,studio_id,name,capacity,features) values('verify01-room','${studioId}','Verify Room',20,'{}');
insert into public.class_definitions(id,studio_id,name,subject,level,duration_minutes,weekly_frequency,roster_student_ids,eligible_teacher_ids,company_only)
values('verify01-class','${studioId}','Verify Class','Ballet','Test Level',60,1,'{}','{}',false);
insert into public.class_sessions(id,studio_id,class_id,ordinal,locked) values('verify01-session','${studioId}','verify01-class',1,false);
insert into public.rulebook_versions(studio_id,version,name,actor_user_id,actor_label,reason,changed_rule_ids,snapshot,rulebook_id,status,rule_count,format_version,document_type,source_metadata)
values('${studioId}',1,'VERIFY-01 Generic Rulebook','${ownerUserId}','Verify Owner','Synthetic non-DWDE browser fixture','{}','[]'::jsonb,'verify01-generic-rulebook','CURRENT',0,'1.0','VERIFY01_TEST_RULEBOOK','{"fixture":"VERIFY-01","privateData":false}'::jsonb);
insert into public.rule_enforcement_versions(studio_id,version,rulebook_version,actor_user_id,actor_label,reason,changed_rule_ids,snapshot,status)
values('${studioId}',1,1,'${ownerUserId}','Verify Owner','Synthetic empty enforcement fixture','{}','[]'::jsonb,'CURRENT');
select private.ensure_planning_dataset_version_v25('${studioId}','${ownerUserId}','Verify Owner','VERIFY-01 synthetic planning fixture');
insert into public.constraint_model_versions(studio_id,version,rulebook_version,compiler_version,actor_user_id,actor_label,reason,snapshot,snapshot_hash,complete_hard_constraint_compilation,status)
select '${studioId}',1,1,'dwde-ir-0.3','${ownerUserId}','Verify Owner','Synthetic generic Constraint IR','${model}'::jsonb,
  private.constraint_model_hash_v27('${model}'::jsonb),true,'CURRENT';
insert into public.schedule_versions(studio_id,version,rulebook_version,enforcement_version,planning_dataset_version,constraint_model_version,actor_user_id,actor_label,reason,is_current,validation_result)
select '${studioId}',1,1,1,p.version,1,'${ownerUserId}','Verify Owner','VERIFY-01 synthetic current schedule',true,
  '{"valid":true,"fullyValidated":true,"hardViolations":0,"warnings":0,"violations":[],"coverage":{"applicableHardRules":0,"implementedHardRules":0,"partialHardRules":0,"notImplementedHardRules":0,"notApplicableHardRules":0,"uncoveredHardRuleIds":[]}}'::jsonb
from public.planning_dataset_versions p where p.studio_id='${studioId}' and p.status='CURRENT';
insert into public.assignments(schedule_version_id,id,studio_id,session_id,day,start_time,end_time,teacher_id,room_id,locked,status)
select s.id,'verify01-assignment','${studioId}','verify01-session','Monday','17:00','18:00','verify01-teacher','verify01-room',false,'NORMAL'
from public.schedule_versions s where s.studio_id='${studioId}' and s.is_current;
select pg_notify('pgrst','reload schema');
`;
}

function parseStatusJson(text) {
  const value = JSON.parse(text);
  const normalized = new Map(Object.entries(value).map(([key, item]) => [key.toUpperCase(), item]));
  const pick = (...keys) => keys.map((key) => normalized.get(key)).find((item) => typeof item === 'string' && item.length > 0);
  return {
    apiUrl: pick('API_URL', 'SUPABASE_URL'),
    anonKey: pick('ANON_KEY', 'PUBLISHABLE_KEY'),
    serviceRoleKey: pick('SERVICE_ROLE_KEY', 'SECRET_KEY'),
  };
}

async function waitForHttp(url, child, logPath) {
  for (let attempt = 0; attempt < 90; attempt += 1) {
    if (child.exitCode !== null) {
      throw new E2EHarnessError(`Next.js exited before becoming ready.\n${readFileSync(logPath, 'utf8')}`);
    }
    try {
      const response = await fetch(url, { redirect: 'manual' });
      if (response.status < 500) return;
    } catch {
      // Retry until the local process accepts connections.
    }
    await delay(1000);
  }
  throw new E2EHarnessError(`Next.js did not become ready at ${url}.\n${readFileSync(logPath, 'utf8')}`);
}

async function stopChild(child) {
  if (!child || child.exitCode !== null) return;
  child.kill('SIGTERM');
  await delay(500);
  if (child.exitCode === null) child.kill('SIGKILL');
}

async function runHarness() {
  assertExistingEnvironmentIsSafe();
  ensureSupabaseCli();
  const playwrightCli = ensurePlaywright();

  const base = 55000 + (process.pid % 650) * 10;
  const ports = {
    shadow: base,
    api: base + 1,
    db: base + 2,
    studio: base + 3,
    mailpit: base + 4,
    smtp: base + 5,
    pop3: base + 6,
    analytics: base + 7,
    pooler: base + 8,
    inspector: base + 9,
    app: base + 10,
  };
  ports.appUrl = `http://127.0.0.1:${ports.app}`;
  const projectId = `studioscheduler-verify01-${process.pid}`;
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'studioscheduler-verify01-'));
  const nextLogPath = path.join(tempRoot, 'next.log');
  let nextProcess = null;
  let nextLogFd = null;
  let supabaseStarted = false;

  try {
    run('supabase', ['init'], { cwd: tempRoot });
    configureSupabaseProject(tempRoot, ports, projectId);
    run('supabase', ['start'], { cwd: tempRoot, timeout: 10 * 60 * 1000 });
    supabaseStarted = true;

    const status = parseStatusJson(run('supabase', ['status', '--output', 'json'], { cwd: tempRoot }).stdout);
    if (!status.apiUrl || !status.anonKey || !status.serviceRoleKey) {
      throw new E2EHarnessError('Supabase status did not expose the local API, anon and service-role credentials.');
    }
    assertLoopbackUrl('local Supabase API', status.apiUrl);
    const mailpitUrl = `http://127.0.0.1:${ports.mailpit}`;
    assertLoopbackUrl('local Mailpit', mailpitUrl);
    assertLoopbackUrl('local Next.js', ports.appUrl);

    const dbContainer = findDatabaseContainer(projectId);
    replayRepositorySchema(dbContainer);

    const admin = createClient(status.apiUrl, status.serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const created = await admin.auth.admin.createUser({
      email: ownerEmail,
      email_confirm: true,
      user_metadata: { full_name: 'Verify Owner' },
    });
    if (created.error || !created.data.user) {
      throw new E2EHarnessError(`Could not create synthetic local Auth user: ${created.error?.message || 'missing user'}`);
    }
    applySql(dbContainer, syntheticFixtureSql(created.data.user.id), 'VERIFY-01 synthetic browser fixture');
    await delay(1000);

    const appEnv = {
      ...process.env,
      NEXT_PUBLIC_SUPABASE_URL: status.apiUrl,
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: status.anonKey,
      SUPABASE_URL: status.apiUrl,
      SUPABASE_SERVICE_ROLE_KEY: status.serviceRoleKey,
    };
    nextLogFd = openSync(nextLogPath, 'w');
    nextProcess = spawn(executable('npm'), ['run', 'dev', '--', '--hostname', '127.0.0.1', '--port', String(ports.app)], {
      cwd: repoRoot,
      env: appEnv,
      stdio: ['ignore', nextLogFd, nextLogFd],
      windowsHide: true,
    });
    await waitForHttp(ports.appUrl, nextProcess, nextLogPath);

    const e2eEnv = {
      ...appEnv,
      E2E_APP_URL: ports.appUrl,
      E2E_SUPABASE_URL: status.apiUrl,
      E2E_SUPABASE_SERVICE_ROLE_KEY: status.serviceRoleKey,
      E2E_MAILPIT_URL: mailpitUrl,
      E2E_DB_CONTAINER: dbContainer,
      E2E_OWNER_EMAIL: ownerEmail,
      E2E_STUDIO_ID: studioId,
    };
    const testRun = run(process.execPath, [
      playwrightCli,
      'test',
      'tests/e2e/verify01-authenticated.spec.mjs',
      '--workers=1',
      '--reporter=line',
    ], { env: e2eEnv, timeout: 4 * 60 * 1000 });
    process.stdout.write(testRun.stdout);
    process.stderr.write(testRun.stderr);
  } finally {
    await stopChild(nextProcess);
    if (nextLogFd !== null) closeSync(nextLogPath);
    if (supabaseStarted) {
      const stopped = spawnSync('supabase', ['stop', '--no-backup'], {
        cwd: tempRoot,
        encoding: 'utf8',
        windowsHide: true,
        timeout: 2 * 60 * 1000,
      });
      if (stopped.status !== 0) process.stderr.write(`Warning: Supabase cleanup failed.\n${stopped.stderr || stopped.stdout}\n`);
    }
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

async function main() {
  const args = new Set(process.argv.slice(2));
  assertExistingEnvironmentIsSafe();
  if (args.has('--check-target')) {
    process.stdout.write('VERIFY-01 loopback target guard passed; no service was started.\n');
    return;
  }
  if (!args.has('--allow-disposable') && process.env.STUDIO_SCHEDULER_E2E_ALLOW_DISPOSABLE !== '1') {
    throw new E2EHarnessError('Refusing to run without explicit disposable opt-in. Use npm run test:e2e.');
  }
  await runHarness();
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  main().catch((error) => {
    process.stderr.write(`Actionable VERIFY-01 setup/test failure: ${error.message}\n`);
    process.exitCode = 1;
  });
}
