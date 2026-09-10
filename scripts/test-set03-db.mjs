import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { assertDisposableTarget, DatabaseHarnessError } from './test-db.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const postgresImage = 'postgres@sha256:ef257d85f76e48da1c64832459b59fcaba1a4dac97bf5d7450c77753542eee94';
const migrationPath = path.join(repoRoot, 'supabase', 'migrations', '20260909100000_set03_typed_setup_policies_v55.sql');

function outputFor(result) { return [result.stdout, result.stderr].filter(Boolean).join('\n').trim(); }
function runProcess(command, args, input) {
  const result = spawnSync(command, args, { cwd: repoRoot, encoding: 'utf8', input, maxBuffer: 32 * 1024 * 1024, windowsHide: true });
  if (result.error) throw new DatabaseHarnessError(`${command} could not be started: ${result.error.message}`);
  return result;
}
function docker(args, input) {
  const result = runProcess('docker', args, input);
  if (result.status !== 0) throw new DatabaseHarnessError(`docker ${args[0] ?? 'command'} failed:\n${outputFor(result)}`);
  return result;
}
function psql(container, sql, label) {
  const result = runProcess('docker', ['exec', '-i', container, 'psql', '-X', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', 'postgres'], sql);
  if (result.status !== 0) throw new DatabaseHarnessError(`${label}:\n${outputFor(result)}`);
  return result.stdout;
}
async function waitForPostgres(container) {
  for (let attempt = 0; attempt < 45; attempt += 1) {
    const result = runProcess('docker', ['exec', container, 'pg_isready', '-U', 'postgres', '-d', 'postgres']);
    if (result.status === 0) return;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new DatabaseHarnessError('SET-03 PostgreSQL did not become ready within 45 seconds.');
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
create table public.studio_members(studio_id uuid not null,user_id uuid not null,role text not null,primary key(studio_id,user_id));
create table public.teachers(id text not null,studio_id uuid not null,name text not null,archived_at timestamptz,primary key(studio_id,id));
create table public.planning_dataset_versions(id uuid primary key default extensions.gen_random_uuid(),studio_id uuid not null,version integer not null,snapshot jsonb not null,status text not null,created_at timestamptz not null default now(),unique(studio_id,version));
create table public.rules(
  id text not null,studio_id uuid not null,category text not null default 'test',type text,title text not null,description text not null,
  strength text,status text not null default 'ACTIVE',verification_status text not null default 'VERIFIED',review_status text not null default 'VERIFIED',
  review jsonb not null default '{}'::jsonb,affected_entity_ids text[] not null default '{}',parameters jsonb not null default '{}'::jsonb,
  exceptions jsonb not null default '[]'::jsonb,source jsonb not null default '{}',version_introduced integer not null default 1,updated_at timestamptz not null default now(),
  classification_raw text not null default 'HARD',source_raw jsonb not null default '{}',enforcement_status text not null default 'NOT_IMPLEMENTED',primary key(studio_id,id)
);
create table public.rulebook_versions(
  id uuid primary key default extensions.gen_random_uuid(),studio_id uuid not null,version integer not null,name text not null,created_at timestamptz not null default now(),
  actor_user_id uuid,actor_label text,reason text,changed_rule_ids text[] not null default '{}',snapshot jsonb not null,rulebook_id text,status text not null,
  imported_at timestamptz,source_hash text,source_file_hash text,rule_count integer,parent_version integer,format_version text,document_type text,
  source_metadata jsonb not null default '{}'::jsonb,unique(studio_id,version)
);
create table public.rule_history(
  id uuid primary key default extensions.gen_random_uuid(),studio_id uuid not null,rule_id text not null,rulebook_version integer not null,changed_at timestamptz not null default now(),
  actor_user_id uuid,actor_label text,reason text,before_rule jsonb,after_rule jsonb,ai_proposed boolean not null default false
);
create table public.rule_enforcement_versions(
  id uuid primary key default extensions.gen_random_uuid(),studio_id uuid not null,version integer not null,rulebook_version integer not null,created_at timestamptz not null default now(),
  actor_user_id uuid,actor_label text,reason text,changed_rule_ids text[] not null default '{}',snapshot jsonb not null default '[]'::jsonb,status text not null,unique(studio_id,version)
);
create table public.rule_enforcement_proposals(studio_id uuid not null,base_rulebook_version integer not null,status text not null,updated_at timestamptz not null default now());
create table public.constraint_model_versions(
  id uuid primary key default extensions.gen_random_uuid(),studio_id uuid not null,version integer not null,rulebook_version integer not null,compiler_version text not null,
  created_at timestamptz not null default now(),actor_user_id uuid,actor_label text,reason text,snapshot jsonb not null,snapshot_hash text not null,
  complete_hard_constraint_compilation boolean not null,status text not null,unique(studio_id,version)
);
create table public.audit_events(id uuid primary key default extensions.gen_random_uuid(),studio_id uuid not null,actor_user_id uuid,actor_label text,action text not null,entity_type text not null,entity_id text,detail text,payload jsonb not null default '{}'::jsonb,created_at timestamptz not null default now());
create table public.setup_review_attestations(
  id uuid primary key default extensions.gen_random_uuid(),studio_id uuid not null,scope_kind text not null,entity_id text,aspect text not null,
  review_schema_version integer not null,dependency_fingerprint text not null,outcome text not null,reviewer_user_id uuid not null,reviewer_label text not null,
  source_planning_dataset_version integer,note text,created_at timestamptz not null default now()
);
create or replace function auth.uid() returns uuid language sql stable security definer set search_path='' as $function$ select nullif(pg_catalog.current_setting('request.jwt.claim.sub',true),'')::uuid $function$;
create or replace function private.is_studio_member(p_studio_id uuid) returns boolean language sql stable security definer set search_path='' as $function$ select exists(select 1 from public.studio_members m where m.studio_id=p_studio_id and m.user_id=auth.uid()) $function$;
create or replace function private.assert_editor_context() returns jsonb language plpgsql security definer set search_path='' as $function$
declare v_uid uuid:=auth.uid(); v_studio uuid; v_role text;
begin select m.studio_id,m.role into v_studio,v_role from public.studio_members m where m.user_id=v_uid order by m.studio_id limit 1 for update; if not found or v_role not in ('OWNER','EDITOR') then raise exception using errcode='42501',message='Editor membership required'; end if; return jsonb_build_object('user_id',v_uid,'studio_id',v_studio,'role',v_role,'actor','SET-03 Owner'); end
$function$;
insert into auth.users(id,email) values
('10000000-0000-4000-8000-000000000001','owner@example.test'),('10000000-0000-4000-8000-000000000002','editor@example.test'),('10000000-0000-4000-8000-000000000003','viewer@example.test');
insert into public.profiles values ('10000000-0000-4000-8000-000000000001','SET-03 Owner'),('10000000-0000-4000-8000-000000000002','SET-03 Editor'),('10000000-0000-4000-8000-000000000003','SET-03 Viewer');
insert into public.studios values ('11111111-1111-4111-8111-111111111111','SET-03 Studio'),('22222222-2222-4222-8222-222222222222','Other Studio');
insert into public.studio_members values
('11111111-1111-4111-8111-111111111111','10000000-0000-4000-8000-000000000001','OWNER'),
('11111111-1111-4111-8111-111111111111','10000000-0000-4000-8000-000000000002','EDITOR'),
('11111111-1111-4111-8111-111111111111','10000000-0000-4000-8000-000000000003','VIEWER');
insert into public.teachers values ('teacher-a','11111111-1111-4111-8111-111111111111','Teacher A',null);
insert into public.planning_dataset_versions(studio_id,version,snapshot,status) values
('11111111-1111-4111-8111-111111111111',1,'{"schemaVersion":"1.3","studioId":"11111111-1111-4111-8111-111111111111","teacherIds":["teacher-a"],"rooms":[{"id":"room-a","name":"Room A","capacity":20,"features":["mirrors"]},{"id":"room-b","name":"Room B","capacity":15,"features":[]}],"classes":[{"id":"class-a","name":"Ballet","subject":"Ballet","level":"3","durationMinutes":60,"weeklyFrequency":1,"rosterStudentIds":[],"companyOnly":false}],"students":[],"cohorts":[],"sessions":[]}'::jsonb,'CURRENT');
insert into public.rules(studio_id,id,title,description,classification_raw,parameters,affected_entity_ids) values
('11111111-1111-4111-8111-111111111111','AIM-003','Teacher window','Teacher A is available Monday through Thursday.','HARD','{"policy":{"schemaVersion":"1.0","kind":"TEACHER_DAY_WINDOW","teacherId":"teacher-a","allowedDays":["Monday","Tuesday","Wednesday","Thursday"]}}'::jsonb,array['teacher-a']),
('11111111-1111-4111-8111-111111111111','OPS-001','Operating windows','Studio operating windows.','HARD','{}','{}'),
('11111111-1111-4111-8111-111111111111','ROOM-002','Unavailable windows','Room unavailable windows.','HARD','{}','{}'),
('11111111-1111-4111-8111-111111111111','ROOM-007','Room capacity policy','Room capacity policy.','HARD','{}','{}'),
('11111111-1111-4111-8111-111111111111','ROOM-009','Required features','Room required features.','HARD','{}','{}'),
('11111111-1111-4111-8111-111111111111','SYN-001','Residual','Unchanged residual rule.','HARD','{}','{}');
insert into public.rulebook_versions(studio_id,version,name,changed_rule_ids,snapshot,rulebook_id,status,source_hash,rule_count,parent_version,format_version,document_type,source_metadata)
select '11111111-1111-4111-8111-111111111111',3,'V3','{}',jsonb_agg(to_jsonb(r) order by r.id),'dwde-2026-2027-master-rulebook','HISTORICAL','synthetic-v3',6,2,'2.1','DWDE_SITE_RULEBOOK','{"provenance":"DISPOSABLE_TEST_BASELINE"}' from public.rules r where r.studio_id='11111111-1111-4111-8111-111111111111';
insert into public.rulebook_versions(studio_id,version,name,changed_rule_ids,snapshot,rulebook_id,status,source_hash,rule_count,parent_version,format_version,document_type,source_metadata)
select '11111111-1111-4111-8111-111111111111',4,'V4',array['AIM-003'],jsonb_agg(to_jsonb(r) order by r.id),'dwde-2026-2027-master-rulebook','CURRENT','synthetic-v4',6,3,'2.2','DWDE_SITE_RULEBOOK',jsonb_build_object('provenance','TYPED_POLICY_MIGRATION','residualBaselineSourceHash','synthetic-v3','typedPolicyRuleIds',jsonb_build_array('AIM-003'),'typedPolicyBundles',jsonb_build_array(jsonb_build_object('ownerRuleId','AIM-003','consumedRuleIds',jsonb_build_array('AIM-003')))) from public.rules r where r.studio_id='11111111-1111-4111-8111-111111111111';
insert into public.rule_enforcement_versions(studio_id,version,rulebook_version,actor_label,reason,snapshot,status) values ('11111111-1111-4111-8111-111111111111',4,4,'SET-03','test','[]','CURRENT');
insert into public.constraint_model_versions(studio_id,version,rulebook_version,compiler_version,actor_label,reason,snapshot,snapshot_hash,complete_hard_constraint_compilation,status) values ('11111111-1111-4111-8111-111111111111',1,4,'dwde-ir-0.4','SET-03','test','{}','0000000000000000000000000000000000000000000000000000000000000000',true,'CURRENT');
`;

const regressionSql = String.raw`
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',false);
do $block$
declare v jsonb; result jsonb; room_fp text; before_rules integer; before_versions integer; before_enforcement integer; before_models integer; before_audits integer; rejected boolean;
begin
  v:=public.list_room_restriction_review_status_v55('11111111-1111-4111-8111-111111111111');
  if (select x->>'state' from jsonb_array_elements(v) x where x->>'roomId'='room-a')<>'NEEDS_REVIEW' then raise exception 'room-a initial review state incorrect: %',v; end if;
  result:=public.apply_setup_typed_policies_v55('[
    {"ruleId":"OPS-001","policy":{"schemaVersion":"1.0","kind":"STUDIO_OPERATING_WINDOWS","windows":[{"day":"Monday","start":"16:45","end":"21:30"},{"day":"Saturday","start":"09:00","end":"15:00"}]}},
    {"ruleId":"ROOM-002","policy":{"schemaVersion":"1.0","kind":"ROOM_UNAVAILABLE_WINDOWS","roomId":"room-a","windows":[{"day":"Monday","start":"18:00","end":"18:30"}]}},
    {"ruleId":"ROOM-007","policy":{"schemaVersion":"1.0","kind":"ROOM_CAPACITY_POLICY","roomId":"room-a"}},
    {"ruleId":"ROOM-009","policy":{"schemaVersion":"1.0","kind":"ROOM_REQUIRED_FEATURES","classIds":["class-a"],"requiredFeatures":["mirrors"]}}
  ]'::jsonb,'manager setup',4,4,1);
  if result->>'rulebookVersion'<>'5' or result->>'enforcementVersion'<>'5' then raise exception 'V4 to V5 result incorrect: %',result; end if;
  if (select version from public.rulebook_versions where studio_id='11111111-1111-4111-8111-111111111111' and status='CURRENT')<>5 then raise exception 'V5 is not current'; end if;
  if (select parameters#>>'{policy,kind}' from public.rules where id='OPS-001')<>'STUDIO_OPERATING_WINDOWS' then raise exception 'operating policy not persisted'; end if;
  if (select affected_entity_ids from public.rules where id='ROOM-009')<>array['class-a'] then raise exception 'ROOM-009 stable class binding missing'; end if;
  if (select count(*) from public.constraint_model_versions where status='CURRENT')<>0 then raise exception 'current model was not invalidated'; end if;
  v:=public.list_room_restriction_review_status_v55('11111111-1111-4111-8111-111111111111');
  select x->>'currentFingerprint' into room_fp from jsonb_array_elements(v) x where x->>'roomId'='room-a';
  if (select (x->>'hasRestriction')::boolean from jsonb_array_elements(v) x where x->>'roomId'='room-a') is not true then raise exception 'room restriction was not derived'; end if;
  perform public.attest_room_restriction_review_v55('11111111-1111-4111-8111-111111111111','room-a',5,1,room_fp,'REVIEWED_VALUE','checked unavailable period and feature policy');
  v:=public.list_room_restriction_review_status_v55('11111111-1111-4111-8111-111111111111');
  if (select x->>'state' from jsonb_array_elements(v) x where x->>'roomId'='room-a')<>'REVIEWED' then raise exception 'room restriction review did not persist: %',v; end if;

  before_rules:=(select count(*) from public.rules); before_versions:=(select count(*) from public.rulebook_versions); before_enforcement:=(select count(*) from public.rule_enforcement_versions); before_models:=(select count(*) from public.constraint_model_versions); before_audits:=(select count(*) from public.audit_events);
  rejected:=false;
  begin perform public.apply_setup_typed_policies_v55('[{"ruleId":"OPS-001","policy":{"schemaVersion":"1.0","kind":"STUDIO_OPERATING_WINDOWS","windows":[{"day":"Sunday","start":"09:00","end":"10:00"}]}}]'::jsonb,'bad closed day',5,5,1); exception when others then if position('SETUP_TYPED_POLICY_WINDOWS_INVALID' in sqlerrm)=0 then raise; end if; rejected:=true; end;
  if not rejected then raise exception 'unsupported day accepted'; end if;
  rejected:=false;
  begin perform public.apply_setup_typed_policies_v55('[{"ruleId":"ROOM-002","policy":{"schemaVersion":"1.0","kind":"ROOM_UNAVAILABLE_WINDOWS","roomId":"other-room","windows":[{"day":"Monday","start":"09:00","end":"10:00"}]}}]'::jsonb,'bad room',5,5,1); exception when others then if position('SETUP_TYPED_POLICY_ROOM_NOT_ACTIVE' in sqlerrm)=0 then raise; end if; rejected:=true; end;
  if not rejected then raise exception 'unknown room accepted'; end if;
  rejected:=false;
  begin perform public.apply_setup_typed_policies_v55('[]','stale rulebook',4,5,1); exception when others then if position('STALE_RULEBOOK' in sqlerrm)=0 then raise; end if; rejected:=true; end;
  if not rejected then raise exception 'stale rulebook accepted'; end if;
  rejected:=false;
  begin perform public.apply_setup_typed_policies_v55('[]','stale planning dataset',5,5,0); exception when others then if position('STALE_PLANNING_DATASET' in sqlerrm)=0 then raise; end if; rejected:=true; end;
  if not rejected then raise exception 'stale planning dataset accepted'; end if;
  if (select count(*) from public.rules)<>before_rules or (select count(*) from public.rulebook_versions)<>before_versions or (select count(*) from public.rule_enforcement_versions)<>before_enforcement or (select count(*) from public.constraint_model_versions)<>before_models or (select count(*) from public.audit_events)<>before_audits then raise exception 'rejected setup mutation wrote canonical/version/model/audit state'; end if;
end $block$;

-- An explicit no-additional-restriction outcome is valid for a room when the policy slice is empty.
do $block$ declare v jsonb; fp text; result jsonb; begin
  update public.rules set parameters='{}',affected_entity_ids='{}' where id='ROOM-002';
  update public.rules set parameters='{}',affected_entity_ids='{}' where id='ROOM-009';
  result:=public.apply_setup_typed_policies_v55('[{"ruleId":"OPS-001","policy":{"schemaVersion":"1.0","kind":"STUDIO_OPERATING_WINDOWS","windows":[{"day":"Monday","start":"16:45","end":"21:30"},{"day":"Saturday","start":"09:00","end":"15:00"}]}}]'::jsonb,'clear room restriction setup',5,5,1);
  if result->>'rulebookVersion'<>'6' or result->>'enforcementVersion'<>'6' then raise exception 'V5 to V6 result incorrect: %',result; end if;
  v:=public.list_room_restriction_review_status_v55('11111111-1111-4111-8111-111111111111');
  select x->>'currentFingerprint' into fp from jsonb_array_elements(v) x where x->>'roomId'='room-b';
  perform public.attest_room_restriction_review_v55('11111111-1111-4111-8111-111111111111','room-b',6,1,fp,'REVIEWED_NO_ADDITIONAL_RESTRICTION','No room-specific restriction applies.');
  v:=public.list_room_restriction_review_status_v55('11111111-1111-4111-8111-111111111111');
  if (select x->>'state' from jsonb_array_elements(v) x where x->>'roomId'='room-b')<>'REVIEWED' then raise exception 'no-restriction review did not persist: %',v; end if;
end $block$;

select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000003',false);
do $block$ declare rejected boolean:=false; begin begin perform public.attest_room_restriction_review_v55('11111111-1111-4111-8111-111111111111','room-b',6,1,repeat('0',64),'REVIEWED_NO_ADDITIONAL_RESTRICTION',null); exception when insufficient_privilege then rejected:=true; end; if not rejected then raise exception 'viewer room review was accepted'; end if; end $block$;
select 'SET-03 DB PASS' as result;
`;

async function main() {
  const args = process.argv.slice(2);
  const allowDisposable = args.includes('--allow-disposable') || process.env.STUDIO_SCHEDULER_TEST_DB_ALLOW_DISPOSABLE === '1';
  const targetArg = args.find((argument) => argument.startsWith('--target='));
  const targetEnvironment = { ...process.env };
  if (targetArg) targetEnvironment.STUDIO_SCHEDULER_TEST_DB_TARGET = targetArg.slice('--target='.length);
  assertDisposableTarget(targetEnvironment);
  if (!allowDisposable) throw new DatabaseHarnessError('SET-03 refuses to run without --allow-disposable.');
  const dockerVersion = runProcess('docker', ['version', '--format', '{{.Server.Version}}']);
  if (dockerVersion.status !== 0) throw new DatabaseHarnessError(`Docker daemon unavailable for SET-03 regression. Start Docker Desktop and retry.\n${outputFor(dockerVersion)}`);
  const container = `studio-scheduler-set03-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
  let running = false;
  try {
    docker(['run','--detach','--rm','--name',container,'--env','POSTGRES_PASSWORD=set03-disposable-only',postgresImage]);
    running = true;
    await waitForPostgres(container);
    psql(container, setupSql, 'SET-03 minimal fixture');
    psql(container, readFileSync(migrationPath, 'utf8'), 'SET-03 migration under test');
    process.stdout.write(psql(container, regressionSql, 'SET-03 typed setup regression'));
  } finally {
    if (running) runProcess('docker', ['rm','--force',container]);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`); process.exitCode = 1; });
}
