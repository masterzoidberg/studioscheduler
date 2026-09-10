import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { assertDisposableTarget, DatabaseHarnessError } from './test-db.mjs';
import { setupSql } from './test-set03-db.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const image = 'postgres@sha256:ef257d85f76e48da1c64832459b59fcaba1a4dac97bf5d7450c77753542eee94';
const v55 = path.join(repoRoot, 'supabase', 'migrations', '20260909100000_set03_typed_setup_policies_v55.sql');
const v56 = path.join(repoRoot, 'supabase', 'migrations', '20260910020236_set04_teacher_policy_reviews_v56.sql');
const studio = '11111111-1111-4111-8111-111111111111';

function run(command, args, input) {
  const result = spawnSync(command, args, { cwd: repoRoot, input, encoding: 'utf8', windowsHide: true, maxBuffer: 32 * 1024 * 1024 });
  if (result.error) throw new DatabaseHarnessError(`${command} could not be started: ${result.error.message}`);
  return result;
}
function output(result) { return [result.stdout, result.stderr].filter(Boolean).join('\n').trim(); }
function docker(args, input) {
  const result = run('docker', args, input);
  if (result.status !== 0) throw new DatabaseHarnessError(`docker ${args[0] ?? 'command'} failed:\n${output(result)}`);
  return result;
}
function psql(container, sql, label) {
  const result = run('docker', ['exec', '-i', container, 'psql', '-X', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', 'postgres'], sql);
  if (result.status !== 0) throw new DatabaseHarnessError(`${label}:\n${output(result)}`);
  return result.stdout;
}

const safeguardPrereqSql = String.raw`
create table public.schedule_versions(id uuid primary key,studio_id uuid not null,constraint_model_version integer,planning_dataset_version integer);
create table public.assignments(id text primary key,schedule_version_id uuid not null,day text not null,start_time time not null,end_time time not null,teacher_id text not null,session_id text not null);
`;

const regressionSql = String.raw`
set search_path=public,extensions;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',false);
begin;
update public.planning_dataset_versions
set snapshot=jsonb_set(snapshot,'{teacherIds}',snapshot->'teacherIds'||'"teacher-b"'::jsonb)
where studio_id='${studio}' and status='CURRENT';

do $block$
declare v jsonb; v_old_rulebook integer; v_old_enforcement integer; v_old_planning integer; v_fp text; v_b_fp text; v_result jsonb;
begin
  v:=public.list_teacher_setup_review_status_v56('${studio}');
  if (select x->>'qualificationState' from jsonb_array_elements(v) x where x->>'teacherId'='teacher-a')<>'BLOCKED' then raise exception 'teacher-a without explicit qualification was not blocked: %',v; end if;
  if (select x->>'availabilityState' from jsonb_array_elements(v) x where x->>'teacherId'='teacher-a')<>'NEEDS_REVIEW' then raise exception 'teacher-a initial availability status incorrect: %',v; end if;
  select version into v_old_rulebook from public.rulebook_versions where studio_id='${studio}' and status='CURRENT';
  select version into v_old_enforcement from public.rule_enforcement_versions where studio_id='${studio}' and status='CURRENT';
  select version into v_old_planning from public.planning_dataset_versions where studio_id='${studio}' and status='CURRENT';
  v_result:=public.apply_setup_typed_policies_v55('[
    {"ruleId":"AIM-003","policy":{"schemaVersion":"1.0","kind":"TEACHER_DAY_WINDOW","teacherId":"teacher-a","windows":[{"day":"Monday","start":"17:00","end":"18:00"}],"unavailableDays":["Tuesday"]}},
    {"ruleId":"SET04-TEACHER-QUALIFICATION-teacher-a","policy":{"schemaVersion":"1.0","kind":"TEACHER_QUALIFICATION","teacherId":"teacher-a","classIds":["class-a"]}},
    {"ruleId":"SET04-TEACHER-AVAILABILITY-teacher-b","policy":null},
    {"ruleId":"SET04-TEACHER-QUALIFICATION-teacher-b","policy":{"schemaVersion":"1.0","kind":"TEACHER_QUALIFICATION","teacherId":"teacher-b","classIds":[]}}
  ]'::jsonb,'SET-04 teacher policy fixture',v_old_rulebook,v_old_enforcement,v_old_planning);
  if (v_result->>'rulebookVersion')<> (v_old_rulebook+1)::text then raise exception 'SET-04 Rulebook successor missing: %',v_result; end if;
  v:=public.list_teacher_setup_review_status_v56('${studio}');
  if (select x->>'qualificationState' from jsonb_array_elements(v) x where x->>'teacherId'='teacher-b')<>'NEEDS_REVIEW' then raise exception 'empty qualification domain did not remain reviewable: %',v; end if;
  if (select x->>'availabilityState' from jsonb_array_elements(v) x where x->>'teacherId'='teacher-b')<>'NEEDS_REVIEW' then raise exception 'explicit unrestricted availability did not remain reviewable: %',v; end if;
  select x->>'availabilityFingerprint' into v_fp from jsonb_array_elements(v) x where x->>'teacherId'='teacher-a';
  select x->>'qualificationFingerprint' into v_b_fp from jsonb_array_elements(v) x where x->>'teacherId'='teacher-a';
  perform public.attest_teacher_setup_review_v56('${studio}','teacher-a','availability',v_old_rulebook+1,v_old_planning,v_fp,'REVIEWED_VALUE','checked window');
  perform public.attest_teacher_setup_review_v56('${studio}','teacher-a','qualification',v_old_rulebook+1,v_old_planning,v_b_fp,'REVIEWED_VALUE','checked class domain');
  v:=public.list_teacher_setup_review_status_v56('${studio}');
  if (select x->>'availabilityState' from jsonb_array_elements(v) x where x->>'teacherId'='teacher-a')<>'REVIEWED_VALUE' then raise exception 'availability review did not persist: %',v; end if;
  if (select x->>'qualificationState' from jsonb_array_elements(v) x where x->>'teacherId'='teacher-a')<>'REVIEWED_VALUE' then raise exception 'qualification review did not persist: %',v; end if;
  if private.teacher_setup_review_fingerprint_v56((select snapshot from public.rulebook_versions where studio_id='${studio}' and status='CURRENT'),jsonb_set((select snapshot from public.planning_dataset_versions where studio_id='${studio}' and status='CURRENT'),'{rooms}',jsonb_build_array(jsonb_build_object('id','unrelated-room','features',jsonb_build_array('mirrors')))),'teacher-a','availability',1)<>v_fp then raise exception 'unrelated room data changed teacher fingerprint'; end if;
end $block$;

do $block$
declare v jsonb; v_fp text; v_before integer; v_rejected boolean:=false;
begin
  v:=public.list_teacher_setup_review_status_v56('${studio}');
  select x->>'availabilityFingerprint' into v_fp from jsonb_array_elements(v) x where x->>'teacherId'='teacher-a';
  select count(*) into v_before from public.setup_review_attestations;
  begin perform public.attest_teacher_setup_review_v56('${studio}','teacher-a','availability',5,1,'bad','REVIEWED_VALUE','stale'); exception when others then if position('STALE_TEACHER_SETUP_REVIEW_FINGERPRINT' in sqlerrm)=0 and position('STALE_TEACHER_SETUP_REVIEW_RULEBOOK' in sqlerrm)=0 then raise; end if; v_rejected:=true; end;
  if not v_rejected or (select count(*) from public.setup_review_attestations)<>v_before then raise exception 'stale teacher review was accepted or wrote evidence'; end if;
  v_rejected:=false;
  begin perform public.apply_setup_typed_policies_v55('[{"ruleId":"AIM-003","policy":{"schemaVersion":"1.0","kind":"TEACHER_DAY_WINDOW","teacherId":"teacher-a","windows":[{"day":"Monday","start":"16:50","end":"18:00"}]}}]'::jsonb,'bad window',5,5,1); exception when others then if position('SETUP_TYPED_POLICY_WINDOWS_INVALID' in sqlerrm)=0 and position('15-minute' in sqlerrm)=0 then raise; end if; v_rejected:=true; end;
  if not v_rejected then raise exception 'non-grid teacher window accepted'; end if;
end $block$;

select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000003',false);
do $block$
declare v_rejected boolean:=false;
begin
  begin perform public.attest_teacher_setup_review_v56('${studio}','teacher-b','availability',5,1,'0000000000000000000000000000000000000000000000000000000000000000','REVIEWED_NO_ADDITIONAL_RESTRICTION','viewer'); exception when others then if position('Editor membership required' in sqlerrm)=0 then raise; end if; v_rejected:=true; end;
  if not v_rejected then raise exception 'viewer teacher review was accepted'; end if;
end $block$;
rollback;
reset role;
select 'SET-04 DB PASS: teacher policy persistence, explicit default-deny, review fingerprints, stale/no-write and authorization' as result;
`;

export async function main(argv = process.argv.slice(2)) {
  const target = argv.find((arg) => arg.startsWith('--target='))?.slice('--target='.length);
  if (target) process.env.STUDIO_SCHEDULER_TEST_DB_TARGET = target;
  assertDisposableTarget(process.env);
  if (!argv.includes('--allow-disposable') && process.env.STUDIO_SCHEDULER_TEST_DB_ALLOW_DISPOSABLE !== '1') throw new DatabaseHarnessError('Refusing to run without disposable opt-in.');
  const container = `studio-scheduler-set04-${process.pid}`;
  let running = false;
  try {
    docker(['run','--detach','--rm','--name',container,'-e','POSTGRES_HOST_AUTH_METHOD=trust',image,'postgres']);
    running = true;
    for (let attempt = 0; attempt < 45; attempt += 1) {
      const ready = run('docker',['exec',container,'pg_isready','-U','postgres','-d','postgres']);
      if (ready.status === 0) break;
      if (attempt === 44) throw new DatabaseHarnessError('SET-04 PostgreSQL did not become ready.');
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    psql(container, setupSql, 'SET-04 minimal fixture');
    psql(container, readFileSync(v55,'utf8'), 'SET-03 prerequisite migration');
    psql(container, safeguardPrereqSql, 'SET-04 safeguard fixture tables');
    psql(container, readFileSync(v56,'utf8'), 'SET-04 migration under test');
    process.stdout.write(psql(container, regressionSql, 'SET-04 teacher policy regression'));
  } finally {
    if (running) run('docker',['rm','--force',container]);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) main().catch((error) => { process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`); process.exitCode = 1; });
