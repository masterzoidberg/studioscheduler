import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import { assertDisposableTarget, DatabaseHarnessError } from './test-db.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const postgresImage = 'postgres@sha256:ef257d85f76e48da1c64832459b59fcaba1a4dac97bf5d7450c77753542eee94';
const migrationPath = path.join(
  repoRoot,
  'supabase',
  'migrations',
  '20260908010000_safe01_commit_membership_authorization_v50.sql',
);

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
  if (result.status !== 0) {
    throw new DatabaseHarnessError(`docker ${args[0] ?? 'command'} failed:\n${outputFor(result)}`);
  }
  return result;
}

function psql(container, sql, label, extraArgs = []) {
  try {
    const result = docker([
      'exec', '-i', container,
      'psql', '-X', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', 'postgres',
      ...extraArgs,
    ], sql);
    return result.stdout;
  } catch (error) {
    throw new DatabaseHarnessError(`${label}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function psqlScalar(container, sql) {
  const output = psql(container, sql, 'scalar query', ['-A', '-t', '-q']);
  const values = output.split(/\r?\n/).map((value) => value.trim()).filter(Boolean);
  return values.at(-1) ?? '';
}

function startPsql(container, sql) {
  const child = spawn('docker', [
    'exec', '-i', container,
    'psql', '-X', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', 'postgres',
  ], {
    cwd: repoRoot,
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  let settled = false;
  const markerWaiters = [];

  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    stdout += chunk;
    for (const waiter of markerWaiters) {
      if (!waiter.done && stdout.includes(waiter.marker)) {
        waiter.done = true;
        clearTimeout(waiter.timer);
        waiter.resolve();
      }
    }
  });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  child.stdin.end(sql);

  const completion = new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('close', (status) => {
      settled = true;
      resolve({ status, stdout, stderr, output: [stdout, stderr].filter(Boolean).join('\n').trim() });
    });
  });

  function waitFor(marker, timeoutMs = 5000) {
    if (stdout.includes(marker)) return Promise.resolve();
    if (settled) return Promise.reject(new DatabaseHarnessError(`psql exited before marker ${marker}:\n${stdout}\n${stderr}`));
    return new Promise((resolve, reject) => {
      const waiter = { marker, resolve, done: false, timer: null };
      waiter.timer = setTimeout(() => {
        waiter.done = true;
        reject(new DatabaseHarnessError(`Timed out waiting for psql marker ${marker}:\n${stdout}\n${stderr}`));
      }, timeoutMs);
      markerWaiters.push(waiter);
    });
  }

  return { completion, waitFor };
}

async function waitForPostgres(container) {
  for (let attempt = 0; attempt < 45; attempt += 1) {
    const result = runProcess('docker', ['exec', container, 'pg_isready', '-U', 'postgres', '-d', 'postgres']);
    if (result.status === 0) return;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new DatabaseHarnessError('SAFE-01 PostgreSQL did not become ready within 45 seconds.');
}

const setupSql = String.raw`
create role anon nologin;
create role authenticated nologin;
create role service_role nologin;
create schema auth;
create schema private;
create table auth.users(id uuid primary key,email text not null unique);
create table public.profiles(id uuid primary key references auth.users(id),display_name text);
create table public.studios(id uuid primary key,name text not null);
create table public.studio_members(
  studio_id uuid not null references public.studios(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check(role in ('OWNER','EDITOR','VIEWER')),
  primary key(studio_id,user_id)
);
create table public.safe01_downstream_writes(
  id bigserial primary key,
  studio_id uuid not null,
  actor_user_id uuid not null,
  created_at timestamptz not null default now()
);
create table public.schedule_versions(id bigserial primary key,studio_id uuid not null);
create table public.constraint_model_versions(id bigserial primary key,studio_id uuid not null);
create table public.audit_events(id bigserial primary key,studio_id uuid not null);

create or replace function auth.uid()
returns uuid language sql stable security definer set search_path=''
as $function$
  select nullif(pg_catalog.current_setting('request.jwt.claim.sub',true),'')::uuid
$function$;

create or replace function private.dwde_actor_context()
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $function$
declare
  v_uid uuid:=auth.uid();
  v_studio uuid;
  v_role text;
  v_actor text;
begin
  if v_uid is null then raise exception 'Authentication required'; end if;
  select m.studio_id,m.role into v_studio,v_role
  from public.studio_members m
  where m.user_id=v_uid
  order by case m.role when 'OWNER' then 0 when 'EDITOR' then 1 else 2 end
  limit 1;
  if v_studio is null then raise exception 'Studio membership required'; end if;
  select coalesce(p.display_name,u.email,'Studio user') into v_actor
  from auth.users u left join public.profiles p on p.id=u.id where u.id=v_uid;
  return jsonb_build_object('user_id',v_uid,'studio_id',v_studio,'role',v_role,'actor',v_actor);
end
$function$;

create or replace function public.adopt_solver_candidate_v44(
  p_studio_id uuid,p_actor_user_id uuid,p_actor_label text,p_reason text,
  p_expected_context jsonb,p_candidate jsonb,p_application_validation jsonb
)
returns jsonb language plpgsql security definer set search_path=''
as $function$
begin
  insert into public.safe01_downstream_writes(studio_id,actor_user_id)
  values(p_studio_id,p_actor_user_id);
  return jsonb_build_object('adopted',true);
end
$function$;

insert into public.studios(id,name) values
  ('11111111-1111-4111-8111-111111111111','SAFE-01 Studio'),
  ('22222222-2222-4222-8222-222222222222','Other Studio');
insert into auth.users(id,email) values
  ('10000000-0000-4000-8000-000000000001','owner@example.test'),
  ('10000000-0000-4000-8000-000000000002','editor@example.test'),
  ('10000000-0000-4000-8000-000000000003','viewer@example.test'),
  ('10000000-0000-4000-8000-000000000004','nonmember@example.test');
insert into public.profiles(id,display_name)
select id,split_part(email,'@',1) from auth.users;
insert into public.studio_members(studio_id,user_id,role) values
  ('11111111-1111-4111-8111-111111111111','10000000-0000-4000-8000-000000000001','OWNER'),
  ('11111111-1111-4111-8111-111111111111','10000000-0000-4000-8000-000000000002','EDITOR'),
  ('11111111-1111-4111-8111-111111111111','10000000-0000-4000-8000-000000000003','VIEWER');
insert into public.schedule_versions(studio_id) values('11111111-1111-4111-8111-111111111111');
insert into public.constraint_model_versions(studio_id) values('11111111-1111-4111-8111-111111111111');
insert into public.audit_events(studio_id) values('11111111-1111-4111-8111-111111111111');
`;

const authorizationRegressionSql = String.raw`
do $block$
declare
  v_before_writes integer;
  v_before_schedule integer;
  v_before_model integer;
  v_before_audit integer;
  v_rejected boolean;
  v_result jsonb;
begin
  if not has_function_privilege('service_role','public.adopt_solver_candidate_v49(uuid,uuid,text,text,jsonb,jsonb,jsonb)','execute') then
    raise exception 'SAFE-01 service role cannot execute V4.9 adoption';
  end if;
  if has_function_privilege('authenticated','public.adopt_solver_candidate_v49(uuid,uuid,text,text,jsonb,jsonb,jsonb)','execute') then
    raise exception 'SAFE-01 V4.9 adoption leaked to authenticated';
  end if;

  select count(*) into v_before_writes from public.safe01_downstream_writes;
  select count(*) into v_before_schedule from public.schedule_versions;
  select count(*) into v_before_model from public.constraint_model_versions;
  select count(*) into v_before_audit from public.audit_events;

  v_rejected:=false;
  begin
    perform public.adopt_solver_candidate_v49(
      '11111111-1111-4111-8111-111111111111',
      '10000000-0000-4000-8000-000000000004',
      'nonmember','must reject before downstream parsing',
      '{"malformed":true}'::jsonb,'{"malformed":true}'::jsonb,'{"malformed":true}'::jsonb
    );
  exception when insufficient_privilege then
    if position('Editor membership required for selected workspace' in sqlerrm)=0 then raise; end if;
    v_rejected:=true;
  end;
  if not v_rejected then raise exception 'SAFE-01 never-member actor was accepted'; end if;

  v_rejected:=false;
  begin
    perform public.adopt_solver_candidate_v49(
      '11111111-1111-4111-8111-111111111111',
      '10000000-0000-4000-8000-000000000003',
      'viewer','must reject viewer',
      '{}'::jsonb,'[]'::jsonb,'{}'::jsonb
    );
  exception when insufficient_privilege then
    v_rejected:=true;
  end;
  if not v_rejected then raise exception 'SAFE-01 VIEWER actor was accepted'; end if;

  v_rejected:=false;
  begin
    perform public.adopt_solver_candidate_v49(
      '22222222-2222-4222-8222-222222222222',
      '10000000-0000-4000-8000-000000000001',
      'wrong tenant','must reject wrong tenant',
      '{}'::jsonb,'[]'::jsonb,'{}'::jsonb
    );
  exception when insufficient_privilege then
    v_rejected:=true;
  end;
  if not v_rejected then raise exception 'SAFE-01 wrong selected studio was accepted'; end if;

  if (select count(*) from public.safe01_downstream_writes)<>v_before_writes
     or (select count(*) from public.schedule_versions)<>v_before_schedule
     or (select count(*) from public.constraint_model_versions)<>v_before_model
     or (select count(*) from public.audit_events)<>v_before_audit then
    raise exception 'SAFE-01 rejected authorization changed downstream/version/audit state';
  end if;

  v_result:=public.adopt_solver_candidate_v49(
    '11111111-1111-4111-8111-111111111111',
    '10000000-0000-4000-8000-000000000001',
    'owner','valid owner', '{}'::jsonb,'[]'::jsonb,'{}'::jsonb
  );
  if coalesce((v_result->>'adopted')::boolean,false) is not true then raise exception 'SAFE-01 OWNER did not reach downstream adoption'; end if;

  v_result:=public.adopt_solver_candidate_v49(
    '11111111-1111-4111-8111-111111111111',
    '10000000-0000-4000-8000-000000000002',
    'editor','valid editor', '{}'::jsonb,'[]'::jsonb,'{}'::jsonb
  );
  if coalesce((v_result->>'adopted')::boolean,false) is not true then raise exception 'SAFE-01 EDITOR did not reach downstream adoption'; end if;
end
$block$;
select 'SAFE-01 AUTH PASS' as result;
`;

function adoptionSql(actorId, label) {
  return `select public.adopt_solver_candidate_v49(
    '11111111-1111-4111-8111-111111111111',
    '${actorId}',
    '${label}','SAFE-01 concurrency witness','{}'::jsonb,'[]'::jsonb,'{}'::jsonb
  );`;
}

async function main() {
  const args = process.argv.slice(2);
  const allowDisposable = args.includes('--allow-disposable') || process.env.STUDIO_SCHEDULER_TEST_DB_ALLOW_DISPOSABLE === '1';
  const targetArg = args.find((argument) => argument.startsWith('--target='));
  const targetEnvironment = { ...process.env };
  if (targetArg) targetEnvironment.STUDIO_SCHEDULER_TEST_DB_TARGET = targetArg.slice('--target='.length);
  assertDisposableTarget(targetEnvironment);
  if (!allowDisposable) {
    throw new DatabaseHarnessError('SAFE-01 refuses to run without --allow-disposable.');
  }

  const dockerVersion = runProcess('docker', ['version', '--format', '{{.Server.Version}}']);
  if (dockerVersion.status !== 0) {
    throw new DatabaseHarnessError(`Docker daemon unavailable for SAFE-01 regression. Start Docker Desktop and retry.\n${outputFor(dockerVersion)}`);
  }

  const container = `studio-scheduler-safe01-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
  let running = false;
  try {
    docker([
      'run','--detach','--rm','--name',container,
      '--env','POSTGRES_PASSWORD=safe01-disposable-only',
      postgresImage,
    ]);
    running = true;
    await waitForPostgres(container);
    psql(container, setupSql, 'SAFE-01 minimal fixture');
    psql(container, readFileSync(migrationPath, 'utf8'), 'SAFE-01 migration under test');
    process.stdout.write(psql(container, authorizationRegressionSql, 'SAFE-01 authorization regression'));

    // Ordering A: command locks the membership first. Revocation must wait until
    // the command transaction commits, then it may downgrade the actor.
    psql(container, `update public.studio_members set role='OWNER' where studio_id='11111111-1111-4111-8111-111111111111' and user_id='10000000-0000-4000-8000-000000000001';`, 'reset owner');
    const commandFirstBefore = Number(psqlScalar(container, 'select count(*) from public.safe01_downstream_writes;'));
    const commandFirst = startPsql(container, `begin;\n${adoptionSql('10000000-0000-4000-8000-000000000001','command-first')}\nselect 'SAFE01_COMMAND_LOCKED';\nselect pg_sleep(2);\ncommit;`);
    await commandFirst.waitFor('SAFE01_COMMAND_LOCKED');
    const revokeStarted = Date.now();
    const revokeAfterCommand = startPsql(container, `update public.studio_members set role='VIEWER' where studio_id='11111111-1111-4111-8111-111111111111' and user_id='10000000-0000-4000-8000-000000000001';`);
    const revokeResult = await revokeAfterCommand.completion;
    const revokeElapsed = Date.now() - revokeStarted;
    const commandResult = await commandFirst.completion;
    if (commandResult.status !== 0) throw new DatabaseHarnessError(`SAFE-01 command-first transaction failed:\n${commandResult.output}`);
    if (revokeResult.status !== 0) throw new DatabaseHarnessError(`SAFE-01 queued revocation failed:\n${revokeResult.output}`);
    if (revokeElapsed < 1200) throw new DatabaseHarnessError(`SAFE-01 revocation did not block behind command membership lock (${revokeElapsed}ms).`);
    if (Number(psqlScalar(container, 'select count(*) from public.safe01_downstream_writes;')) !== commandFirstBefore + 1) {
      throw new DatabaseHarnessError('SAFE-01 command-first ordering did not produce exactly one downstream write.');
    }

    // Ordering B: revocation owns the row first. Adoption must wait, then see the
    // committed VIEWER role and fail without reaching downstream code.
    psql(container, `update public.studio_members set role='OWNER' where studio_id='11111111-1111-4111-8111-111111111111' and user_id='10000000-0000-4000-8000-000000000001';`, 'reset owner');
    const revokeFirstBefore = Number(psqlScalar(container, 'select count(*) from public.safe01_downstream_writes;'));
    const revokeFirst = startPsql(container, `begin;\nupdate public.studio_members set role='VIEWER' where studio_id='11111111-1111-4111-8111-111111111111' and user_id='10000000-0000-4000-8000-000000000001';\nselect 'SAFE01_REVOKE_LOCKED';\nselect pg_sleep(2);\ncommit;`);
    await revokeFirst.waitFor('SAFE01_REVOKE_LOCKED');
    const deniedStarted = Date.now();
    const deniedCommand = startPsql(container, adoptionSql('10000000-0000-4000-8000-000000000001','revoke-first'));
    const deniedResult = await deniedCommand.completion;
    const deniedElapsed = Date.now() - deniedStarted;
    const revokeFirstResult = await revokeFirst.completion;
    if (revokeFirstResult.status !== 0) throw new DatabaseHarnessError(`SAFE-01 revoke-first transaction failed:\n${revokeFirstResult.output}`);
    if (deniedResult.status === 0 || !deniedResult.output.includes('Editor membership required for selected workspace')) {
      throw new DatabaseHarnessError(`SAFE-01 revoke-first adoption was not denied after waiting:\n${deniedResult.output}`);
    }
    if (deniedElapsed < 1200) throw new DatabaseHarnessError(`SAFE-01 adoption did not wait behind revocation row lock (${deniedElapsed}ms).`);
    if (Number(psqlScalar(container, 'select count(*) from public.safe01_downstream_writes;')) !== revokeFirstBefore) {
      throw new DatabaseHarnessError('SAFE-01 revoke-first denial reached downstream adoption.');
    }

    // Deleted membership is a separate null-safety witness, after the race tests.
    psql(container, `delete from public.studio_members where studio_id='11111111-1111-4111-8111-111111111111' and user_id='10000000-0000-4000-8000-000000000002';`, 'delete editor membership');
    const deletedBefore = Number(psqlScalar(container, 'select count(*) from public.safe01_downstream_writes;'));
    const deleted = runProcess('docker', [
      'exec','-i',container,'psql','-X','-v','ON_ERROR_STOP=1','-U','postgres','-d','postgres',
    ], adoptionSql('10000000-0000-4000-8000-000000000002','deleted-editor'));
    if (deleted.status === 0 || !outputFor(deleted).includes('Editor membership required for selected workspace')) {
      throw new DatabaseHarnessError(`SAFE-01 deleted membership was not denied:\n${outputFor(deleted)}`);
    }
    if (Number(psqlScalar(container, 'select count(*) from public.safe01_downstream_writes;')) !== deletedBefore) {
      throw new DatabaseHarnessError('SAFE-01 deleted membership denial reached downstream adoption.');
    }

    process.stdout.write('SAFE-01 PASS: missing/viewer/wrong-tenant actors deny before downstream work; OWNER/EDITOR succeed; command-first and revoke-first row-lock ordering serialize; deleted membership denies atomically.\n');
  } finally {
    if (running) {
      const result = runProcess('docker', ['rm','--force',container]);
      if (result.status !== 0) process.stderr.write(`Warning: SAFE-01 disposable cleanup failed: ${outputFor(result)}\n`);
    }
  }
}

main().catch((error) => {
  process.stderr.write(`SAFE-01 database regression failed: ${error.message}\n`);
  process.exitCode = 1;
});
