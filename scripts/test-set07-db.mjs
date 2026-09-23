import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { assertDisposableTarget, DatabaseHarnessError } from './test-db.mjs';
import { setupSql } from './test-set03-db.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const image = 'postgres@sha256:ef257d85f76e48da1c64832459b59fcaba1a4dac97bf5d7450c77753542eee94';
const studio = '11111111-1111-4111-8111-111111111111';
const owner = '10000000-0000-4000-8000-000000000001';
const viewer = '10000000-0000-4000-8000-000000000003';

function run(command, args, input) {
  const result = spawnSync(command, args, { cwd: repoRoot, input, encoding: 'utf8', windowsHide: true, maxBuffer: 32 * 1024 * 1024 });
  if (result.error) throw new DatabaseHarnessError(result.error.message);
  return result;
}
function output(result) { return [result.stdout, result.stderr].filter(Boolean).join('\n').trim(); }
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

const v27 = path.join(repoRoot, 'supabase', 'migrations', '20260902132207_constraint_model_versions_v27.sql');
const migrations = [
  '20260904220608_planning_dataset_confirmation_attestation_v39.sql',
  '20260908035000_set01_room_capacity_review_v51.sql',
  '20260909100000_set03_typed_setup_policies_v55.sql',
  '20260910020236_set04_teacher_policy_reviews_v56.sql',
  '20260910233000_set05_class_setup_reviews_v57.sql',
  '20260911010000_pol03_typed_relationship_safeguards_v58.sql',
  '20260911020000_set06_student_relationship_setup_v59.sql',
  '20260911030000_set07_readiness_certification_v60.sql',
].map((name) => path.join(repoRoot, 'supabase', 'migrations', name));

const preV27Schema = String.raw`
create table public.schedule_versions(id uuid primary key default extensions.gen_random_uuid(),studio_id uuid not null,version integer not null,rulebook_version integer not null,enforcement_version integer not null,planning_dataset_version integer not null,constraint_model_version integer not null,is_current boolean not null default false);
create table public.assignments(schedule_version_id uuid not null,id text not null,studio_id uuid not null,session_id text not null,day text not null,start_time time not null,end_time time not null,teacher_id text not null,room_id text not null,locked boolean not null default false,status text not null default 'NORMAL',primary key(schedule_version_id,id));
create table public.scenarios(id uuid primary key default extensions.gen_random_uuid(),studio_id uuid not null,base_constraint_model_version integer);
`;

const prerequisites = String.raw`
alter table public.planning_dataset_versions
  add column if not exists actor_user_id uuid,
  add column if not exists actor_label text default 'SET-07 fixture',
  add column if not exists reason text default 'SET-07 fixture',
  add column if not exists snapshot_hash text,
  add column if not exists confirmed_for_scheduling_at timestamptz,
  add column if not exists confirmed_for_scheduling_by uuid,
  add column if not exists confirmed_for_scheduling_by_label text,
  add column if not exists scheduling_confirmation_note text;

create or replace function private.planning_dataset_hash_v25(p_snapshot jsonb)
returns text language sql immutable security definer set search_path=''
as $function$ select encode(extensions.digest(pg_catalog.convert_to(p_snapshot::text,'UTF8'),'sha256'),'hex') $function$;
revoke all on function private.planning_dataset_hash_v25(jsonb) from public,anon,authenticated;

create table public.rooms(id text not null,studio_id uuid not null,name text not null,archived_at timestamptz,primary key(studio_id,id));
create table public.students(id text not null,studio_id uuid not null,name text not null,level text not null,archived_at timestamptz,primary key(studio_id,id));
create table public.class_definitions(id text not null,studio_id uuid not null,name text not null,roster_student_ids text[] not null default '{}',eligible_teacher_ids text[] not null default '{}',company_only boolean not null default false,archived_at timestamptz,primary key(studio_id,id));
create table public.class_sessions(id text not null,studio_id uuid not null,class_id text not null,ordinal integer not null,duration_minutes integer,archived_at timestamptz,primary key(studio_id,id));
insert into public.rooms values ('room-a','${studio}','Room A',null);
insert into public.students values ('student-a','${studio}','Student A','Level 1',null);
insert into public.class_definitions values ('class-a','${studio}','Class A',array['student-a'],array['teacher-a'],false,null);
insert into public.class_sessions values ('session-a','${studio}','class-a',1,45,null);
insert into public.rules(studio_id,id,title,description,classification_raw,strength,status,verification_status,review_status,parameters,affected_entity_ids)
values ('${studio}','AIM-001','Teacher qualification','Teacher A may teach Class A','HARD','HARD','ACTIVE','VERIFIED','VERIFIED','{"policy":{"schemaVersion":"1.0","kind":"TEACHER_QUALIFICATION","teacherId":"teacher-a","classIds":["class-a"]}}'::jsonb,array['teacher-a','class-a']);
update public.rules set strength='HARD' where studio_id='${studio}' and id='AIM-003';

update public.planning_dataset_versions
set snapshot='{"schemaVersion":"1.3","studioId":"${studio}","teacherIds":["teacher-a"],"teachers":[{"id":"teacher-a","name":"Teacher A"}],"rooms":[{"id":"room-a","name":"Room A","capacity":20,"features":[]}],"students":[{"id":"student-a","name":"Student A","level":"Level 1","cohortIds":[]}],"cohorts":[],"classes":[{"id":"class-a","name":"Class A","subject":"A","level":"1","durationMinutes":45,"weeklyFrequency":1,"rosterStudentIds":["student-a"],"companyOnly":false}],"sessions":[{"id":"session-a","classId":"class-a","ordinal":1,"durationMinutes":45,"locked":false}]}'::jsonb,
    actor_label='SET-07 fixture', reason='SET-07 fixture';
update public.planning_dataset_versions
set snapshot_hash=private.planning_dataset_hash_v25(snapshot)
where studio_id='${studio}' and status='CURRENT';
update public.rulebook_versions rb
set snapshot=(select coalesce(jsonb_agg(to_jsonb(r) order by r.id),'[]'::jsonb) from public.rules r where r.studio_id=rb.studio_id)
where rb.studio_id='${studio}' and rb.status='CURRENT';
update public.constraint_model_versions cm
set snapshot_hash=private.constraint_model_hash_v27(cm.snapshot)
where cm.studio_id='${studio}' and cm.status='CURRENT';
`;

// Keep the SQL below separate from the fixture strings so syntax errors identify
// the exercised SET-07 boundary rather than a large seed statement.
const reviewAndRegression = String.raw`
set search_path=public,extensions;
select set_config('request.jwt.claim.sub','${owner}',false);
set role postgres;

insert into public.setup_review_attestations(studio_id,scope_kind,entity_id,aspect,review_schema_version,dependency_fingerprint,outcome,reviewer_user_id,reviewer_label,source_planning_dataset_version,note)
select '${studio}','ROOM','room-a','capacity',1,private.room_capacity_review_fingerprint_v51(pd.snapshot,'room-a',1),'REVIEWED_VALUE','${owner}','SET-07 fixture',pd.version,'room capacity reviewed'
from public.planning_dataset_versions pd where pd.studio_id='${studio}' and pd.status='CURRENT';
insert into public.setup_review_attestations(studio_id,scope_kind,entity_id,aspect,review_schema_version,dependency_fingerprint,outcome,reviewer_user_id,reviewer_label,source_planning_dataset_version,note)
select '${studio}','ROOM','room-a','restrictions',1,private.room_restriction_review_fingerprint_v55(rb.snapshot,pd.snapshot,'room-a',1),'REVIEWED_NO_ADDITIONAL_RESTRICTION','${owner}','SET-07 fixture',pd.version,'room restrictions reviewed'
from public.rulebook_versions rb cross join public.planning_dataset_versions pd where rb.studio_id='${studio}' and rb.status='CURRENT' and pd.studio_id='${studio}' and pd.status='CURRENT';
insert into public.setup_review_attestations(studio_id,scope_kind,entity_id,aspect,review_schema_version,dependency_fingerprint,outcome,reviewer_user_id,reviewer_label,source_planning_dataset_version,note)
select '${studio}','TEACHER','teacher-a',v.aspect,1,private.teacher_setup_review_fingerprint_v56(rb.snapshot,pd.snapshot,'teacher-a',v.aspect,1),'REVIEWED_VALUE','${owner}','SET-07 fixture',pd.version,'teacher slice reviewed'
from public.rulebook_versions rb cross join public.planning_dataset_versions pd cross join (values ('availability'),('qualification')) v(aspect)
where rb.studio_id='${studio}' and rb.status='CURRENT' and pd.studio_id='${studio}' and pd.status='CURRENT';
insert into public.setup_review_attestations(studio_id,scope_kind,entity_id,aspect,review_schema_version,dependency_fingerprint,outcome,reviewer_user_id,reviewer_label,source_planning_dataset_version,note)
select '${studio}','CLASS','class-a',v.aspect,1,private.class_setup_review_fingerprint_v57('${studio}',pd.snapshot,'class-a',v.aspect,1),'REVIEWED_VALUE','${owner}','SET-07 fixture',pd.version,'class slice reviewed'
from public.planning_dataset_versions pd cross join (values ('structure'),('roster')) v(aspect)
where pd.studio_id='${studio}' and pd.status='CURRENT';
insert into public.setup_review_attestations(studio_id,scope_kind,entity_id,aspect,review_schema_version,dependency_fingerprint,outcome,reviewer_user_id,reviewer_label,source_planning_dataset_version,note)
select '${studio}','STUDENT','student-a','restrictions',1,private.set06_review_fingerprint_v59('${studio}','STUDENT','student-a','restrictions',pd.snapshot),'REVIEWED_VALUE','${owner}','SET-07 fixture',pd.version,'student restrictions reviewed'
from public.planning_dataset_versions pd where pd.studio_id='${studio}' and pd.status='CURRENT';

create or replace function private.set07_state_counts(p_studio uuid)
returns jsonb language sql stable security definer set search_path=''
as $function$
select jsonb_build_object(
  'auditCount',(select count(*) from public.audit_events where studio_id=p_studio),
  'certificationAuditCount',(select count(*) from public.audit_events where studio_id=p_studio and action='PLANNING_DATASET_CERTIFIED'),
  'certificationFingerprint',(select certification_review_set_fingerprint from public.planning_dataset_versions where studio_id=p_studio and status='CURRENT')
)
$function$;
grant usage on schema private to authenticated;
grant execute on function private.set07_state_counts(uuid) to authenticated,service_role;

set role authenticated;
do $block$
declare v jsonb; result jsonb; before_audits integer;
begin
  v:=public.get_readiness_certification_v60('${studio}');
  if jsonb_array_length(v->'reviewFindings')<>7 then raise exception 'expected seven reviewed slices: %',v; end if;
  if v->>'certification' is not null then raise exception 'fixture unexpectedly certified before confirmation'; end if;
  before_audits:=(private.set07_state_counts('${studio}') ->> 'auditCount')::integer;
  result:=public.confirm_current_planning_dataset_v60(
    (v->>'currentPlanningDatasetVersion')::integer,v->>'currentPlanningSnapshotHash',
    (v->>'currentRulebookVersion')::integer,(v->>'currentConstraintModelVersion')::integer,
    v->>'currentConstraintModelSnapshotHash',v->>'reviewSetFingerprint',(v->>'reviewSetSchemaVersion')::integer,
    'SET-07 certification fixture','{"peopleInventoryReviewed":true,"classSessionCatalogReviewed":true,"classRostersReviewed":true,"sourceAndCompletenessReviewed":true}'::jsonb
  );
  if result->>'status'<>'CERTIFIED' then raise exception 'certification did not succeed: %',result; end if;
  if (private.set07_state_counts('${studio}') ->> 'certificationAuditCount')::integer<>1 then raise exception 'certification audit missing'; end if;
  if private.set07_state_counts('${studio}')->>'certificationFingerprint' is null then raise exception 'certification metadata missing'; end if;
end $block$;

-- A stale Rulebook token is rejected before the certification write.
do $block$
declare v jsonb; before_audits integer; rejected boolean:=false;
begin
  v:=public.get_readiness_certification_v60('${studio}');
  before_audits:=(private.set07_state_counts('${studio}') ->> 'auditCount')::integer;
  begin perform public.confirm_current_planning_dataset_v60((v->>'currentPlanningDatasetVersion')::integer,v->>'currentPlanningSnapshotHash',(v->>'currentRulebookVersion')::integer+1,(v->>'currentConstraintModelVersion')::integer,v->>'currentConstraintModelSnapshotHash',v->>'reviewSetFingerprint',1,'stale policy','{"peopleInventoryReviewed":true,"classSessionCatalogReviewed":true,"classRostersReviewed":true,"sourceAndCompletenessReviewed":true}'::jsonb); exception when others then if position('STALE_RULEBOOK' in sqlerrm)=0 then raise; end if; rejected:=true; end;
  if not rejected or (private.set07_state_counts('${studio}') ->> 'auditCount')::integer<>before_audits then raise exception 'stale policy token wrote state'; end if;
end $block$;

-- A forged review token is rejected before any PlanningDataset/audit success write.
do $block$
declare v jsonb; before_audits integer; rejected boolean:=false;
begin
  v:=public.get_readiness_certification_v60('${studio}');
  before_audits:=(private.set07_state_counts('${studio}') ->> 'auditCount')::integer;
  begin perform public.confirm_current_planning_dataset_v60((v->>'currentPlanningDatasetVersion')::integer,v->>'currentPlanningSnapshotHash',(v->>'currentRulebookVersion')::integer,(v->>'currentConstraintModelVersion')::integer,v->>'currentConstraintModelSnapshotHash',repeat('0',64),1,'forged','{"peopleInventoryReviewed":true,"classSessionCatalogReviewed":true,"classRostersReviewed":true,"sourceAndCompletenessReviewed":true}'::jsonb); exception when others then if position('STALE_READINESS_REVIEW_SET' in sqlerrm)=0 then raise; end if; rejected:=true; end;
  if not rejected or (private.set07_state_counts('${studio}') ->> 'auditCount')::integer<>before_audits then raise exception 'forged review token wrote state'; end if;
end $block$;

-- An explicitly revoked/latest NEEDS_REVIEW attestation blocks reconfirmation.
set role postgres;
insert into public.setup_review_attestations(studio_id,scope_kind,entity_id,aspect,review_schema_version,dependency_fingerprint,outcome,reviewer_user_id,reviewer_label,source_planning_dataset_version,note,created_at)
select '${studio}','TEACHER','teacher-a','availability',1,private.teacher_setup_review_fingerprint_v56(rb.snapshot,pd.snapshot,'teacher-a','availability',1),'NEEDS_REVIEW','${owner}','SET-07 fixture',pd.version,'revoked review',now()+interval '1 second'
from public.rulebook_versions rb cross join public.planning_dataset_versions pd where rb.studio_id='${studio}' and rb.status='CURRENT' and pd.studio_id='${studio}' and pd.status='CURRENT';
set role authenticated;
do $block$
declare v jsonb; before_audits integer; rejected boolean:=false;
begin
  v:=public.get_readiness_certification_v60('${studio}');
  if not exists(select 1 from jsonb_array_elements(v->'reviewFindings') x where x->>'scopeKind'='TEACHER' and x->>'aspect'='availability' and x->>'state' in ('NEEDS_REVIEW','CHANGED_SINCE_REVIEW')) then raise exception 'revoked review was not surfaced: %',v; end if;
  before_audits:=(private.set07_state_counts('${studio}') ->> 'auditCount')::integer;
  begin perform public.confirm_current_planning_dataset_v60((v->>'currentPlanningDatasetVersion')::integer,v->>'currentPlanningSnapshotHash',(v->>'currentRulebookVersion')::integer,(v->>'currentConstraintModelVersion')::integer,v->>'currentConstraintModelSnapshotHash',v->>'reviewSetFingerprint',1,'revoked','{"peopleInventoryReviewed":true,"classSessionCatalogReviewed":true,"classRostersReviewed":true,"sourceAndCompletenessReviewed":true}'::jsonb); exception when others then if position('READINESS_REVIEW_REQUIRED' in sqlerrm)=0 then raise; end if; rejected:=true; end;
  if not rejected or (private.set07_state_counts('${studio}') ->> 'auditCount')::integer<>before_audits then raise exception 'revoked review wrote state'; end if;
end $block$;

-- Restore that slice, then change only the room fact. The teacher review stays
-- resolved while the aggregate certification and context token become stale.
set role postgres;
insert into public.setup_review_attestations(studio_id,scope_kind,entity_id,aspect,review_schema_version,dependency_fingerprint,outcome,reviewer_user_id,reviewer_label,source_planning_dataset_version,note,created_at)
select '${studio}','TEACHER','teacher-a','availability',1,private.teacher_setup_review_fingerprint_v56(rb.snapshot,pd.snapshot,'teacher-a','availability',1),'REVIEWED_VALUE','${owner}','SET-07 fixture',pd.version,'review restored',now()+interval '2 seconds'
from public.rulebook_versions rb cross join public.planning_dataset_versions pd where rb.studio_id='${studio}' and rb.status='CURRENT' and pd.studio_id='${studio}' and pd.status='CURRENT';
do $block$
declare old_token jsonb; new_token jsonb; changed_snapshot jsonb;
begin
  old_token:=private.build_solver_context_token_v43('${studio}');
  update public.planning_dataset_versions set status='HISTORICAL' where studio_id='${studio}' and status='CURRENT';
  select jsonb_set(snapshot,'{rooms,0,capacity}','25'::jsonb) into changed_snapshot
  from public.planning_dataset_versions where studio_id='${studio}' and version=1;
  insert into public.planning_dataset_versions(studio_id,version,snapshot,snapshot_hash,status,actor_label,reason)
  values ('${studio}',2,changed_snapshot,private.planning_dataset_hash_v25(changed_snapshot),'CURRENT','SET-07 fixture','room change');
  new_token:=private.build_solver_context_token_v43('${studio}');
  if old_token=new_token then raise exception 'room change did not change the solver context token'; end if;
end $block$;
do $block$
declare v jsonb;
begin
  v:=public.get_readiness_certification_v60('${studio}');
  if not exists(select 1 from jsonb_array_elements(v->'reviewFindings') x where x->>'scopeKind'='ROOM' and x->>'aspect'='capacity' and x->>'state'='CHANGED_SINCE_REVIEW') then raise exception 'room change did not stale capacity review: %',v; end if;
  if not exists(select 1 from jsonb_array_elements(v->'reviewFindings') x where x->>'scopeKind'='TEACHER' and x->>'aspect'='qualification' and x->>'state'='REVIEWED') then raise exception 'unrelated teacher review was not preserved: %',v; end if;
  if v->>'certification' is not null then raise exception 'aggregate certification survived a changed Planning Dataset: %',v; end if;
end $block$;

-- The database adoption boundary also fails closed when the current Planning
-- Dataset has been changed and therefore has no current certification.
set role postgres;
do $block$
declare rejected boolean:=false; before_audits integer;
begin
  before_audits:=(private.set07_state_counts('${studio}') ->> 'auditCount')::integer;
  begin perform public.adopt_solver_candidate_v49('${studio}','${owner}','SET-07 owner','uncertified adoption','{}'::jsonb,'[]'::jsonb,'{}'::jsonb); exception when others then if position('PLANNING_DATASET_NOT_CERTIFIED' in sqlerrm)=0 and position('PLANNING_CERTIFICATION_STALE' in sqlerrm)=0 then raise; end if; rejected:=true; end;
  if not rejected or (private.set07_state_counts('${studio}') ->> 'auditCount')::integer<>before_audits then raise exception 'uncertified adoption wrote state'; end if;
end $block$;

-- A new unresolved HARD meaning is a MUST finding; a PREFER omission is not.
update public.rules set review_status='NEEDS_REVIEW' where studio_id='${studio}' and id='AIM-003';
insert into public.rules(studio_id,id,title,description,classification_raw,strength,status,verification_status,review_status,parameters,affected_entity_ids)
values ('${studio}','PREF-001','Optional preference','Optional preference','PREFER','PREFER','ACTIVE','NEEDS_REVIEW','NEEDS_REVIEW','{}','{}');
do $block$
declare v jsonb; before_audits integer; rejected boolean:=false;
begin
  v:=public.get_readiness_certification_v60('${studio}');
  if not exists(select 1 from jsonb_array_elements(v->'reviewFindings') x where x->>'code'='UNREVIEWED_HARD_RULE' and x->>'entityId'='AIM-003') then raise exception 'unreviewed HARD meaning was not surfaced: %',v; end if;
  if exists(select 1 from jsonb_array_elements(v->'reviewFindings') x where x->>'entityId'='PREF-001') then raise exception 'optional preference became a blocking review finding: %',v; end if;
  before_audits:=(private.set07_state_counts('${studio}') ->> 'auditCount')::integer;
  begin perform public.confirm_current_planning_dataset_v60((v->>'currentPlanningDatasetVersion')::integer,v->>'currentPlanningSnapshotHash',(v->>'currentRulebookVersion')::integer,(v->>'currentConstraintModelVersion')::integer,v->>'currentConstraintModelSnapshotHash',v->>'reviewSetFingerprint',1,'unreviewed HARD','{"peopleInventoryReviewed":true,"classSessionCatalogReviewed":true,"classRostersReviewed":true,"sourceAndCompletenessReviewed":true}'::jsonb); exception when others then if position('READINESS_REVIEW_REQUIRED' in sqlerrm)=0 then raise; end if; rejected:=true; end;
  if not rejected or (private.set07_state_counts('${studio}') ->> 'auditCount')::integer<>before_audits then raise exception 'unreviewed HARD confirmation wrote state'; end if;
end $block$;

-- Viewer and non-member calls fail at the existing exact membership boundary.
set role authenticated;
select set_config('request.jwt.claim.sub','${viewer}',false);
do $block$ declare rejected boolean:=false; begin begin perform public.confirm_current_planning_dataset_v60(2,'bad',5,1,'bad',repeat('0',64),1,'viewer','{}'); exception when others then if position('Editor membership required' in sqlerrm)=0 then raise; end if; rejected:=true; end; if not rejected then raise exception 'viewer certification was accepted'; end if; end $block$;
select set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',false);
do $block$ declare rejected boolean:=false; begin begin perform public.get_readiness_certification_v60('${studio}'); exception when others then if position('Studio membership required' in sqlerrm)=0 then raise; end if; rejected:=true; end; if not rejected then raise exception 'non-member certification read was accepted'; end if; end $block$;
reset role;

select 'SET-07 DB PASS: certification, forged/stale/revoked/unreviewed-HARD no-write gates, optional preference classification, selective invalidation, and authorization' as result;
`;

export async function main(argv = process.argv.slice(2)) {
  const target = argv.find((arg) => arg.startsWith('--target='))?.slice('--target='.length);
  if (target) process.env.STUDIO_SCHEDULER_TEST_DB_TARGET = target;
  assertDisposableTarget(process.env);
  if (!argv.includes('--allow-disposable') && process.env.STUDIO_SCHEDULER_TEST_DB_ALLOW_DISPOSABLE !== '1') throw new DatabaseHarnessError('Refusing to run without disposable opt-in.');
  const container = `studio-scheduler-set07-${process.pid}`;
  let running = false;
  try {
    docker(['run','--detach','--rm','--name',container,'-e','POSTGRES_HOST_AUTH_METHOD=trust',image,'postgres']);
    running = true;
    for (let attempt = 0; attempt < 45; attempt += 1) {
      if (run('docker',['exec',container,'pg_isready','-U','postgres','-d','postgres']).status === 0) break;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
    psql(container, setupSql, 'SET-07 base fixture');
    psql(container, preV27Schema, 'SET-07 pre-V27 schema');
    psql(container, readFileSync(v27, 'utf8'), 'V27 hash helper');
    psql(container, prerequisites, 'SET-07 prerequisites');
    for (const migration of migrations) psql(container, readFileSync(migration, 'utf8'), `SET-07 migration ${path.basename(migration)}`);
    process.stdout.write(psql(container, reviewAndRegression, 'SET-07 regression'));
  } finally {
    if (running) run('docker',['rm','--force',container]);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  main().catch((error) => { process.stderr.write(`${error.stack || error.message}\n`); process.exitCode = 1; });
}
