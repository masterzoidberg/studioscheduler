import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { assertDisposableTarget, DatabaseHarnessError } from './test-db.mjs';
import { setupSql } from './test-set03-db.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const image = 'postgres@sha256:ef257d85f76e48da1c64832459b59fcaba1a4dac97bf5d7450c77753542eee94';
const migration = path.join(repoRoot, 'supabase', 'migrations', '20260910233000_set05_class_setup_reviews_v57.sql');
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
insert into public.rooms values ('room-a','${studio}','Room A',null),('room-b','${studio}','Room B',null);
insert into public.students values ('student-required','${studio}','Required Student','Level 5',null);
insert into public.class_definitions values ('class-a','${studio}','Ballet','{}','{}',false,null),('class-required','${studio}','Ballet 5',array[]::text[],'{}',true,null);
insert into public.class_sessions values ('session-a-1','${studio}','class-a',1,null,null),('session-required-1','${studio}','class-required',1,null,null);
insert into public.rules(studio_id,id,title,description,classification_raw,parameters,affected_entity_ids) values ('${studio}','AIM-001','Teacher qualification','Teacher A qualification domain','HARD','{"policy":{"schemaVersion":"1.0","kind":"TEACHER_QUALIFICATION","teacherId":"teacher-a","classIds":["class-a"]}}'::jsonb,array['teacher-a','class-a']);
update public.planning_dataset_versions set snapshot='{"schemaVersion":"1.3","studioId":"${studio}","teacherIds":["teacher-a"],"rooms":[{"id":"room-a","name":"Room A","capacity":20,"features":[]},{"id":"room-b","name":"Room B","capacity":20,"features":[]}],"students":[{"id":"student-required","name":"Required Student","level":"Level 5","cohortIds":[]}],"cohorts":[],"classes":[{"id":"class-a","name":"Ballet","subject":"Ballet","level":"3","durationMinutes":60,"weeklyFrequency":1,"rosterStudentIds":[],"companyOnly":false},{"id":"class-required","name":"Ballet 5","subject":"Ballet","level":"5","durationMinutes":60,"weeklyFrequency":1,"rosterStudentIds":[],"companyOnly":true}],"sessions":[{"id":"session-a-1","classId":"class-a","ordinal":1,"durationMinutes":null,"locked":false},{"id":"session-required-1","classId":"class-required","ordinal":1,"durationMinutes":null,"locked":false}]}'::jsonb;
create or replace function private.rulebook_required_roster_v38(p_studio uuid,p_class_name text) returns jsonb language sql stable security definer set search_path='' as $function$
select case when p_class_name='Ballet 5' then jsonb_build_object('supported',true,'requiredStudentIds',jsonb_build_array('student-required'),'ruleIds',jsonb_build_array('TEST-REQUIRED')) else jsonb_build_object('supported',false,'requiredStudentIds','[]'::jsonb,'ruleIds','[]'::jsonb) end
$function$;
`;

const regression = String.raw`
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',false);
do $block$
declare v jsonb; structure_fp text; roster_fp text; before_reviews integer; before_rules integer; before_versions integer; before_audits integer; rejected boolean:=false; result jsonb;
begin
  v:=public.list_class_setup_review_status_v57('${studio}');
  if (select x#>>'{structure,state}' from jsonb_array_elements(v) x where x->>'classId'='class-a')<>'NEEDS_REVIEW' then raise exception 'initial structure state incorrect: %',v; end if;
  if (select x#>>'{roster,state}' from jsonb_array_elements(v) x where x->>'classId'='class-required')<>'BLOCKED' then raise exception 'missing required participant did not block roster review: %',v; end if;
  select x#>>'{structure,currentFingerprint}',x#>>'{roster,currentFingerprint}' into structure_fp,roster_fp from jsonb_array_elements(v) x where x->>'classId'='class-a';
  perform public.attest_class_setup_review_v57('${studio}','class-a','structure',1,structure_fp,false,'checked structure');
  before_reviews:=(select count(*) from public.setup_review_attestations);
  begin perform public.attest_class_setup_review_v57('${studio}','class-a','roster',1,roster_fp,false,'empty without confirmation'); exception when others then if position('CLASS_EMPTY_ROSTER_CONFIRMATION_REQUIRED' in sqlerrm)=0 then raise; end if; rejected:=true; end;
  if not rejected or (select count(*) from public.setup_review_attestations)<>before_reviews then raise exception 'empty roster rejection wrote review state'; end if;
  perform public.attest_class_setup_review_v57('${studio}','class-a','roster',1,roster_fp,true,'explicit empty standard roster');
  v:=public.list_class_setup_review_status_v57('${studio}');
  if (select x#>>'{structure,state}' from jsonb_array_elements(v) x where x->>'classId'='class-a')<>'REVIEWED' or (select x#>>'{roster,state}' from jsonb_array_elements(v) x where x->>'classId'='class-a')<>'REVIEWED' then raise exception 'persisted class reviews missing: %',v; end if;

  result:=public.apply_class_assignment_policies_v57('${studio}','class-a','teacher-a',null,'room-a','room-b','class policy fixture',4,4,1);
  if result->>'rulebookVersion'<>'5' then raise exception 'class policy Rulebook successor missing: %',result; end if;
  if (select parameters#>>'{policy,kind}' from public.rules where studio_id='${studio}' and id='SET05-CLASS-REQUIRED-TEACHER-class-a')<>'REQUIRED_TEACHER' then raise exception 'required teacher policy missing'; end if;
  if (select parameters#>>'{policy,kind}' from public.rules where studio_id='${studio}' and id='SET05-CLASS-PREFERRED-ROOM-class-a')<>'PREFERRED_ROOM' then raise exception 'preferred room policy missing'; end if;
  if (select eligible_teacher_ids from public.class_definitions where studio_id='${studio}' and id='class-a')<>'{}'::text[] then raise exception 'legacy eligibleTeacherIds became writable authority'; end if;

  before_rules:=(select count(*) from public.rules); before_versions:=(select count(*) from public.rulebook_versions); before_audits:=(select count(*) from public.audit_events); rejected:=false;
  begin perform public.apply_class_assignment_policies_v57('${studio}','class-a','teacher-missing',null,null,null,'stale fixture',4,4,1); exception when others then if position('STALE_RULEBOOK' in sqlerrm)=0 then raise; end if; rejected:=true; end;
  if not rejected or (select count(*) from public.rules)<>before_rules or (select count(*) from public.rulebook_versions)<>before_versions or (select count(*) from public.audit_events)<>before_audits then raise exception 'stale policy attempt wrote canonical success state'; end if;

  update public.planning_dataset_versions set status='HISTORICAL' where studio_id='${studio}';
  insert into public.planning_dataset_versions(studio_id,version,snapshot,status) select studio_id,2,jsonb_set(snapshot,'{sessions,0,durationMinutes}','75'::jsonb),'CURRENT' from public.planning_dataset_versions where studio_id='${studio}' and version=1;
  v:=public.list_class_setup_review_status_v57('${studio}');
  if (select x#>>'{structure,state}' from jsonb_array_elements(v) x where x->>'classId'='class-a')<>'CHANGED_SINCE_REVIEW' then raise exception 'duration change did not invalidate structure: %',v; end if;
  if (select x#>>'{roster,state}' from jsonb_array_elements(v) x where x->>'classId'='class-a')<>'REVIEWED' then raise exception 'duration change invalidated unrelated roster review: %',v; end if;
end $block$;

select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000003',false);
do $block$ declare rejected boolean:=false; before_reviews integer:=(select count(*) from public.setup_review_attestations); begin begin perform public.attest_class_setup_review_v57('${studio}','class-a','structure',2,repeat('0',64),false,'viewer'); exception when others then if position('Editor membership required' in sqlerrm)=0 then raise; end if; rejected:=true; end; if not rejected or (select count(*) from public.setup_review_attestations)<>before_reviews then raise exception 'viewer review was accepted or wrote state'; end if; end $block$;
select 'SET-05 DB PASS: class policy authority, explicit empty roster, selective invalidation, persisted review and stale/no-write' as result;
`;

export async function main(argv = process.argv.slice(2)) {
  const target = argv.find((arg) => arg.startsWith('--target='))?.slice('--target='.length); if (target) process.env.STUDIO_SCHEDULER_TEST_DB_TARGET = target; assertDisposableTarget(process.env);
  if (!argv.includes('--allow-disposable') && process.env.STUDIO_SCHEDULER_TEST_DB_ALLOW_DISPOSABLE !== '1') throw new DatabaseHarnessError('Refusing to run without disposable opt-in.');
  const container = `studio-scheduler-set05-${process.pid}`; let running=false;
  try { docker(['run','--detach','--rm','--name',container,'-e','POSTGRES_HOST_AUTH_METHOD=trust',image,'postgres']); running=true; for(let attempt=0;attempt<45;attempt+=1){if(run('docker',['exec',container,'pg_isready','-U','postgres','-d','postgres']).status===0) break; await new Promise((resolve)=>setTimeout(resolve,1000));}
    psql(container,setupSql,'SET-05 base fixture'); psql(container,prerequisites,'SET-05 prerequisites'); psql(container,readFileSync(migration,'utf8'),'SET-05 migration'); process.stdout.write(psql(container,regression,'SET-05 regression'));
  } finally { if(running) run('docker',['rm','--force',container]); }
}
if(process.argv[1]&&path.resolve(process.argv[1])===path.resolve(fileURLToPath(import.meta.url))) main().catch((error)=>{process.stderr.write(`${error.stack||error.message}\n`);process.exitCode=1;});
