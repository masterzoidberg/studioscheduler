import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { assertDisposableTarget, DatabaseHarnessError } from './test-db.mjs';
import { setupSql } from './test-set03-db.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const image = 'postgres@sha256:ef257d85f76e48da1c64832459b59fcaba1a4dac97bf5d7450c77753542eee94';
const set05 = path.join(repoRoot, 'supabase', 'migrations', '20260910233000_set05_class_setup_reviews_v57.sql');
const migration = path.join(repoRoot, 'supabase', 'migrations', '20260911020000_set06_student_relationship_setup_v59.sql');
const studio = '11111111-1111-4111-8111-111111111111';

function run(command, args, input) { const result = spawnSync(command, args, { cwd: repoRoot, input, encoding: 'utf8', windowsHide: true, maxBuffer: 32 * 1024 * 1024 }); if (result.error) throw new DatabaseHarnessError(result.error.message); return result; }
function output(result) { return [result.stdout, result.stderr].filter(Boolean).join('\n').trim(); }
function docker(args, input) { const result = run('docker', args, input); if (result.status !== 0) throw new DatabaseHarnessError(output(result)); return result; }
function psql(container, sql, label) { const result = run('docker', ['exec','-i',container,'psql','-X','-v','ON_ERROR_STOP=1','-U','postgres','-d','postgres'], sql); if (result.status !== 0) throw new DatabaseHarnessError(`${label}:\n${output(result)}`); return result.stdout; }

const prerequisites = String.raw`
create table public.rooms(id text not null,studio_id uuid not null,name text not null,archived_at timestamptz,primary key(studio_id,id));
create table public.students(id text not null,studio_id uuid not null,name text not null,level text not null,archived_at timestamptz,primary key(studio_id,id));
create table public.class_definitions(id text not null,studio_id uuid not null,name text not null,roster_student_ids text[] not null default '{}',eligible_teacher_ids text[] not null default '{}',company_only boolean not null default false,archived_at timestamptz,primary key(studio_id,id));
create table public.class_sessions(id text not null,studio_id uuid not null,class_id text not null,ordinal integer not null,duration_minutes integer,archived_at timestamptz,primary key(studio_id,id));
create table public.schedule_versions(id uuid primary key default extensions.gen_random_uuid(),studio_id uuid not null,version integer not null,rulebook_version integer not null,enforcement_version integer not null,planning_dataset_version integer not null,constraint_model_version integer not null,is_current boolean not null default false);
create table public.assignments(schedule_version_id uuid not null,id text not null,studio_id uuid not null,session_id text not null,day text not null,start_time time not null,end_time time not null,teacher_id text not null,room_id text not null,primary key(schedule_version_id,id));
insert into public.rooms values ('room-a','${studio}','Room A',null);
insert into public.students values ('student-a','${studio}','Student A','Level 1',null),('student-b','${studio}','Student B','Level 1',null);
insert into public.class_definitions values ('class-a','${studio}','Class A',array['student-a'],'{}',false,null),('class-b','${studio}','Class B',array['student-b'],'{}',false,null);
insert into public.class_sessions values ('session-a','${studio}','class-a',1,45,null),('session-b','${studio}','class-b',1,60,null);
update public.planning_dataset_versions set snapshot='{"schemaVersion":"1.3","studioId":"${studio}","teacherIds":["teacher-a"],"teachers":[{"id":"teacher-a","name":"Teacher A"}],"rooms":[{"id":"room-a","name":"Room A","capacity":20,"features":[]}],"students":[{"id":"student-a","name":"Student A","level":"Level 1","cohortIds":["family"]},{"id":"student-b","name":"Student B","level":"Level 1","cohortIds":["family"]}],"cohorts":[{"id":"family","name":"Household","studentIds":["student-a","student-b"]}],"classes":[{"id":"class-a","name":"Class A","subject":"A","level":"1","durationMinutes":45,"weeklyFrequency":1,"rosterStudentIds":["student-a"],"companyOnly":false},{"id":"class-b","name":"Class B","subject":"B","level":"1","durationMinutes":60,"weeklyFrequency":1,"rosterStudentIds":["student-b"],"companyOnly":false}],"sessions":[{"id":"session-a","classId":"class-a","ordinal":1,"durationMinutes":45,"locked":false},{"id":"session-b","classId":"class-b","ordinal":1,"durationMinutes":60,"locked":false}]}'::jsonb;
create or replace function private.rulebook_required_roster_v38(uuid,text) returns jsonb language sql stable security definer set search_path='' as $f$ select '{"supported":false,"requiredStudentIds":[],"ruleIds":[]}'::jsonb $f$;
create or replace function private.validate_typed_schedule_v54(uuid) returns jsonb language sql stable security definer set search_path='' as $f$ select '{"modelPresent":true,"typedRuleIds":[],"violations":[],"modelErrors":[]}'::jsonb $f$;
`;

const regression = String.raw`
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',false);
do $block$
declare v jsonb; result jsonb; student_fp text; relation_fp text; non_set06_rule text; before_rules integer; before_versions integer; before_audits integer; before_reviews integer; rejected boolean:=false;
begin
  v:=public.list_set06_review_status_v59('${studio}');
  if (select x->>'state' from jsonb_array_elements(v) x where x->>'scopeKind'='STUDENT' and x->>'entityId'='student-a')<>'NEEDS_REVIEW' then raise exception 'initial student restriction review state incorrect: %',v; end if;
  if exists(select 1 from public.rules where studio_id='${studio}' and id like 'SET06-%') then raise exception 'family/cohort fact created an implicit policy'; end if;

  result:=public.apply_set06_policies_v59('${studio}','[
    {"ruleId":"SET06-STUDENT-LATEST-FINISH-student-a","policy":{"schemaVersion":"1.0","kind":"PARTICIPANT_LATEST_FINISH","participantIds":["student-a"],"latestFinish":"20:15"}},
    {"ruleId":"SET06-STUDENT-MAX-DAYS-student-a","policy":{"schemaVersion":"1.0","kind":"MAX_ATTENDANCE_DAYS","participantIds":["student-a"],"maxDays":3}},
    {"ruleId":"SET06-PARTICIPANT-NO-OVERLAP","policy":{"schemaVersion":"1.0","kind":"PARTICIPANT_NO_OVERLAP","participantIds":["student-a","student-b"]}},
    {"ruleId":"SET06-DIRECT-AFTER","policy":{"schemaVersion":"1.0","kind":"DIRECT_AFTER","predecessorSessionId":"session-a","successorSessionId":"session-b"}},
    {"ruleId":"SET06-LINKED-ARRIVAL","policy":{"schemaVersion":"1.0","kind":"LINKED_ARRIVAL","teacherId":"teacher-a","participantId":"student-a","minOffsetMinutes":-15,"maxOffsetMinutes":30}}
  ]'::jsonb,'SET-06 fixture',4,4,1);
  if result->>'rulebookVersion'<>'5' then raise exception 'Rulebook successor missing: %',result; end if;
  if (select parameters#>>'{policy,latestFinish}' from public.rules where studio_id='${studio}' and id='SET06-STUDENT-LATEST-FINISH-student-a')<>'20:15' then raise exception 'latest finish policy missing'; end if;
  if (select affected_entity_ids from public.rules where studio_id='${studio}' and id='SET06-DIRECT-AFTER')<>array['session-a','session-b'] then raise exception 'direct-after direction was not persisted'; end if;

  v:=public.list_set06_review_status_v59('${studio}');
  select x->>'currentFingerprint' into student_fp from jsonb_array_elements(v) x where x->>'scopeKind'='STUDENT' and x->>'entityId'='student-a';
  select x->>'currentFingerprint' into relation_fp from jsonb_array_elements(v) x where x->>'scopeKind'='RULE' and x->>'entityId'='SET06-DIRECT-AFTER';
  perform public.attest_set06_review_v59('${studio}','STUDENT','student-a','restrictions',5,1,student_fp,'REVIEWED_VALUE','reviewed restrictions');
  perform public.attest_set06_review_v59('${studio}','RULE','SET06-DIRECT-AFTER','interpretation',5,1,relation_fp,'REVIEWED_VALUE','reviewed direction');
  v:=public.list_set06_review_status_v59('${studio}');
  if (select x->>'state' from jsonb_array_elements(v) x where x->>'scopeKind'='STUDENT' and x->>'entityId'='student-a')<>'REVIEWED_VALUE' or (select x->>'state' from jsonb_array_elements(v) x where x->>'scopeKind'='RULE' and x->>'entityId'='SET06-DIRECT-AFTER')<>'REVIEWED_VALUE' then raise exception 'persisted reviews missing: %',v; end if;

  before_rules:=(select count(*) from public.rules); before_versions:=(select count(*) from public.rulebook_versions); before_audits:=(select count(*) from public.audit_events); rejected:=false;
  select id into non_set06_rule from public.rules where studio_id='${studio}' and id not like 'SET06-%' limit 1;
  if non_set06_rule is not null then
    begin perform public.apply_set06_policies_v59('${studio}',jsonb_build_array(jsonb_build_object('ruleId',non_set06_rule,'policy',null)),'invalid owner',5,5,1); exception when others then if position('SET06_POLICY_RULE_UNSUPPORTED' in sqlerrm)=0 then raise; end if; rejected:=true; end;
    if not rejected or (select count(*) from public.rules)<>before_rules or (select count(*) from public.rulebook_versions)<>before_versions or (select count(*) from public.audit_events)<>before_audits then raise exception 'non-SET06 owner was accepted or wrote canonical state'; end if;
  end if;
  rejected:=false;
  begin perform public.apply_set06_policies_v59('${studio}','[{"ruleId":"SET06-STUDENT-LATEST-FINISH-missing","policy":{"schemaVersion":"1.0","kind":"PARTICIPANT_LATEST_FINISH","participantIds":["missing"],"latestFinish":"20:00"}}]'::jsonb,'invalid missing participant',5,5,1); exception when others then if position('SET06_PARTICIPANT_NOT_ACTIVE' in sqlerrm)=0 then raise; end if; rejected:=true; end;
  if not rejected or (select count(*) from public.rules)<>before_rules or (select count(*) from public.rulebook_versions)<>before_versions or (select count(*) from public.audit_events)<>before_audits then raise exception 'missing reference rejection wrote canonical state'; end if;
  rejected:=false;
  begin perform public.apply_set06_policies_v59('${studio}','[]','stale',4,4,1); exception when others then if position('STALE_RULEBOOK' in sqlerrm)=0 then raise; end if; rejected:=true; end;
  if not rejected or (select count(*) from public.rulebook_versions)<>before_versions or (select count(*) from public.audit_events)<>before_audits then raise exception 'stale write changed canonical state'; end if;

  update public.planning_dataset_versions set status='HISTORICAL' where studio_id='${studio}';
  insert into public.planning_dataset_versions(studio_id,version,snapshot,status) select studio_id,2,jsonb_set(snapshot,'{classes,1,rosterStudentIds}','["student-a","student-b"]'), 'CURRENT' from public.planning_dataset_versions where studio_id='${studio}' and version=1;
  v:=public.list_set06_review_status_v59('${studio}');
  if (select x->>'state' from jsonb_array_elements(v) x where x->>'scopeKind'='STUDENT' and x->>'entityId'='student-a')<>'CHANGED_SINCE_REVIEW' then raise exception 'roster change did not invalidate student restrictions review: %',v; end if;
  if (select x->>'state' from jsonb_array_elements(v) x where x->>'scopeKind'='RULE' and x->>'entityId'='SET06-DIRECT-AFTER')<>'REVIEWED_VALUE' then raise exception 'unrelated roster change invalidated relationship review: %',v; end if;
  before_reviews:=(select count(*) from public.setup_review_attestations); rejected:=false;
  begin perform public.attest_set06_review_v59('${studio}','STUDENT','missing','restrictions',5,2,repeat('0',64),'REVIEWED_VALUE','missing review target'); exception when others then if position('SET06_REVIEW_REFERENCE_MISSING' in sqlerrm)=0 then raise; end if; rejected:=true; end;
  if not rejected or (select count(*) from public.setup_review_attestations)<>before_reviews then raise exception 'missing student review target wrote evidence'; end if;
  rejected:=false;
  begin perform public.attest_set06_review_v59('${studio}','STUDENT','student-a','restrictions',5,1,student_fp,'REVIEWED_VALUE','stale review'); exception when others then if position('STALE_PLANNING_DATASET' in sqlerrm)=0 then raise; end if; rejected:=true; end;
  if not rejected or (select count(*) from public.setup_review_attestations)<>before_reviews then raise exception 'stale review wrote evidence'; end if;
end $block$;

select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000003',false);
do $block$ declare rejected boolean:=false; before_rules integer:=(select count(*) from public.rules); before_reviews integer:=(select count(*) from public.setup_review_attestations); begin begin perform public.apply_set06_policies_v59('${studio}','[]','viewer',5,5,2); exception when others then if position('Editor membership required' in sqlerrm)=0 then raise; end if; rejected:=true; end; if not rejected or (select count(*) from public.rules)<>before_rules then raise exception 'viewer policy write was accepted'; end if; rejected:=false; begin perform public.attest_set06_review_v59('${studio}','STUDENT','student-a','restrictions',5,2,repeat('0',64),'REVIEWED_VALUE','viewer'); exception when others then if position('Editor membership required' in sqlerrm)=0 then raise; end if; rejected:=true; end; if not rejected or (select count(*) from public.setup_review_attestations)<>before_reviews then raise exception 'viewer review was accepted'; end if; end $block$;
select 'SET-06 DB PASS: explicit policy, direction/timing, review stability, stale/missing/unauthorized no-write' as result;
`;

export async function main(argv = process.argv.slice(2)) {
  const target = argv.find((arg) => arg.startsWith('--target='))?.slice('--target='.length); if (target) process.env.STUDIO_SCHEDULER_TEST_DB_TARGET = target; assertDisposableTarget(process.env);
  if (!argv.includes('--allow-disposable') && process.env.STUDIO_SCHEDULER_TEST_DB_ALLOW_DISPOSABLE !== '1') throw new DatabaseHarnessError('Refusing to run without disposable opt-in.');
  const container = `studio-scheduler-set06-${process.pid}`; let running=false;
  try { docker(['run','--detach','--rm','--name',container,'-e','POSTGRES_HOST_AUTH_METHOD=trust',image,'postgres']); running=true; for(let attempt=0;attempt<45;attempt+=1){if(run('docker',['exec',container,'pg_isready','-U','postgres','-d','postgres']).status===0) break; await new Promise((resolve)=>setTimeout(resolve,1000));}
    psql(container,setupSql,'SET-06 base fixture'); psql(container,prerequisites,'SET-06 prerequisites'); psql(container,readFileSync(set05,'utf8'),'SET-05 predecessor'); psql(container,readFileSync(migration,'utf8'),'SET-06 migration'); process.stdout.write(psql(container,regression,'SET-06 regression'));
  } finally { if(running) run('docker',['rm','--force',container]); }
}
if(process.argv[1]&&path.resolve(process.argv[1])===path.resolve(fileURLToPath(import.meta.url))) main().catch((error)=>{process.stderr.write(`${error.stack||error.message}\n`);process.exitCode=1;});
