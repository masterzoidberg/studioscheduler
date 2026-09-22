import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { assertDisposableTarget, DatabaseHarnessError } from './test-db.mjs';
import { setupSql } from './test-set03-db.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const image = 'postgres@sha256:ef257d85f76e48da1c64832459b59fcaba1a4dac97bf5d7450c77753542eee94';
const migration = path.join(repoRoot, 'supabase', 'migrations', '20260911100000_gen02_tenant_policy_records_v62.sql');
const studio = '11111111-1111-4111-8111-111111111111';
const otherStudio = '22222222-2222-4222-8222-222222222222';
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

const v27Prerequisites = String.raw`
create table public.schedule_versions(
  id uuid primary key default extensions.gen_random_uuid(), studio_id uuid not null,
  version integer not null, rulebook_version integer not null, enforcement_version integer not null,
  planning_dataset_version integer not null, is_current boolean not null default false
);
create table public.assignments(
  schedule_version_id uuid not null, id text not null, studio_id uuid not null,
  session_id text not null, day text not null, start_time time not null, end_time time not null,
  teacher_id text not null, room_id text not null, locked boolean not null default false,
  status text not null default 'NORMAL', primary key(schedule_version_id,id)
);
create table public.scenarios(
  id uuid primary key default extensions.gen_random_uuid(), studio_id uuid not null,
  base_rulebook_version integer not null, base_schedule_version integer not null
);
`;

const fixture = String.raw`
update public.rules
set parameters=jsonb_set(parameters,'{policy,allowedDays}','["Thursday","Monday","Wednesday","Tuesday"]'::jsonb)
where studio_id='${studio}' and id='AIM-003';
update public.rulebook_versions rb
set snapshot=(select coalesce(jsonb_agg(to_jsonb(r) order by r.id collate "C"),'[]'::jsonb) from public.rules r where r.studio_id=rb.studio_id),
    source_hash=private.constraint_model_hash_v27((select coalesce(jsonb_agg(to_jsonb(r) order by r.id collate "C"),'[]'::jsonb) from public.rules r where r.studio_id=rb.studio_id)),
    rule_count=(select count(*) from public.rules r where r.studio_id=rb.studio_id)
where rb.studio_id='${studio}' and rb.status='CURRENT';
`;

const authenticatedReadGrants = String.raw`
grant select on public.rulebook_versions,public.rules,public.rule_enforcement_versions,
  public.constraint_model_versions,public.audit_events to authenticated;
`;

const regression = String.raw`
set search_path=public,extensions;
select set_config('request.jwt.claim.sub','${owner}',false);
set role authenticated;
do $block$
declare
  v_source_hash text;
  v_manifest jsonb;
  v_result jsonb;
  v_bad jsonb;
  v_before_versions integer;
  v_before_audits integer;
  v_before_rules integer;
  v_before_enforcement integer;
  v_before_models integer;
  v_source_snapshot jsonb;
  v_model jsonb;
  v_published jsonb;
  v_rejected boolean;
begin
  select source_hash,snapshot into v_source_hash,v_source_snapshot
  from public.rulebook_versions where studio_id='${studio}' and status='CURRENT';
  v_manifest:=jsonb_build_object(
    'schemaVersion','1.0',
    'sourceRulebookVersion',4,
    'sourceRulebookId','dwde-2026-2027-master-rulebook',
    'sourceHash',v_source_hash,
    'activeRuleIds',jsonb_build_array('AIM-003','OPS-001','ROOM-002','ROOM-007','ROOM-009','SYN-001'),
    'records',jsonb_build_array(
      jsonb_build_object('schemaVersion','1.0','ruleId','AIM-003','provenance',jsonb_build_object('sourceRuleId','AIM-003','sourceRulebookVersion',4,'sourceRulebookId','dwde-2026-2027-master-rulebook','sourceHash',v_source_hash,'conversion','REVIEWED_RULEBOOK_TO_TENANT_RECORDS'),'disposition','HARD_CONSTRAINT','family','TEACHER_POLICY','runtimeLayer','CONSTRAINT_IR','rationale','Teacher day legality','constraintIds',jsonb_build_array('tenant-aim-window'),'preconditionIds',jsonb_build_array(),'typedPolicy',jsonb_build_object('schemaVersion','1.0','kind','TEACHER_DAY_WINDOW','teacherId','teacher-a','allowedDays',jsonb_build_array('Monday','Tuesday','Wednesday','Thursday'))),
      jsonb_build_object('schemaVersion','1.0','ruleId','OPS-001','provenance',jsonb_build_object('sourceRuleId','OPS-001','sourceRulebookVersion',4,'sourceRulebookId','dwde-2026-2027-master-rulebook','sourceHash',v_source_hash,'conversion','REVIEWED_RULEBOOK_TO_TENANT_RECORDS'),'disposition','HARD_CONSTRAINT','family','STUDIO_OPERATIONS','runtimeLayer','CONSTRAINT_IR','rationale','Time grid legality','constraintIds',jsonb_build_array('tenant-time-grid'),'preconditionIds',jsonb_build_array(),'typedPolicy',null),
      jsonb_build_object('schemaVersion','1.0','ruleId','ROOM-002','provenance',jsonb_build_object('sourceRuleId','ROOM-002','sourceRulebookVersion',4,'sourceRulebookId','dwde-2026-2027-master-rulebook','sourceHash',v_source_hash,'conversion','REVIEWED_RULEBOOK_TO_TENANT_RECORDS'),'disposition','HARD_CONSTRAINT','family','ROOM_POLICY','runtimeLayer','CONSTRAINT_IR','rationale','Room legality','constraintIds',jsonb_build_array('tenant-room-002'),'preconditionIds',jsonb_build_array(),'typedPolicy',null),
      jsonb_build_object('schemaVersion','1.0','ruleId','ROOM-007','provenance',jsonb_build_object('sourceRuleId','ROOM-007','sourceRulebookVersion',4,'sourceRulebookId','dwde-2026-2027-master-rulebook','sourceHash',v_source_hash,'conversion','REVIEWED_RULEBOOK_TO_TENANT_RECORDS'),'disposition','HARD_CONSTRAINT','family','ROOM_POLICY','runtimeLayer','CONSTRAINT_IR','rationale','Capacity legality','constraintIds',jsonb_build_array('tenant-room-007'),'preconditionIds',jsonb_build_array(),'typedPolicy',null),
      jsonb_build_object('schemaVersion','1.0','ruleId','ROOM-009','provenance',jsonb_build_object('sourceRuleId','ROOM-009','sourceRulebookVersion',4,'sourceRulebookId','dwde-2026-2027-master-rulebook','sourceHash',v_source_hash,'conversion','REVIEWED_RULEBOOK_TO_TENANT_RECORDS'),'disposition','HARD_CONSTRAINT','family','ROOM_POLICY','runtimeLayer','CONSTRAINT_IR','rationale','Feature legality','constraintIds',jsonb_build_array('tenant-room-009'),'preconditionIds',jsonb_build_array(),'typedPolicy',null),
      jsonb_build_object('schemaVersion','1.0','ruleId','SYN-001','provenance',jsonb_build_object('sourceRuleId','SYN-001','sourceRulebookVersion',4,'sourceRulebookId','dwde-2026-2027-master-rulebook','sourceHash',v_source_hash,'conversion','REVIEWED_RULEBOOK_TO_TENANT_RECORDS'),'disposition','HARD_DATA_PRECONDITION','family','CURRICULUM_INTEGRITY','runtimeLayer','READY_GATE','rationale','Tenant class structure','constraintIds',jsonb_build_array(),'preconditionIds',jsonb_build_array('tenant-class-structure'),'typedPolicy',null)
    ),
    'constraints',jsonb_build_array(
      jsonb_build_object('id','tenant-aim-window','kind','TEACHER_DAY_WINDOW','ruleIds',jsonb_build_array('AIM-003'),'selector',jsonb_build_object('teacherIds',jsonb_build_array('teacher-a')),'parameters',jsonb_build_object('allowedDays',jsonb_build_array('Monday','Tuesday','Wednesday','Thursday')),'explanation','Teacher day legality'),
      jsonb_build_object('id','tenant-room-002','kind','TIME_GRID','ruleIds',jsonb_build_array('ROOM-002'),'selector',jsonb_build_object(),'parameters',jsonb_build_object('minutes',15),'explanation','Room legality'),
      jsonb_build_object('id','tenant-room-007','kind','TIME_GRID','ruleIds',jsonb_build_array('ROOM-007'),'selector',jsonb_build_object(),'parameters',jsonb_build_object('minutes',15),'explanation','Capacity legality'),
      jsonb_build_object('id','tenant-room-009','kind','TIME_GRID','ruleIds',jsonb_build_array('ROOM-009'),'selector',jsonb_build_object(),'parameters',jsonb_build_object('minutes',15),'explanation','Feature legality'),
      jsonb_build_object('id','tenant-time-grid','kind','TIME_GRID','ruleIds',jsonb_build_array('OPS-001'),'selector',jsonb_build_object(),'parameters',jsonb_build_object('minutes',15),'explanation','Time grid legality')
    ),
    'objectivePrioritySpine',jsonb_build_array(),
    'readinessRuleIds',jsonb_build_array('SYN-001'),
    'governanceAssertions',jsonb_build_array(),
    'preconditions',jsonb_build_array(jsonb_build_object('schemaVersion','1.0','id','tenant-class-structure','kind','CLASS_STRUCTURE','ruleIds',jsonb_build_array('SYN-001'),'classId','class-a','expectedFrequency',1,'expectedDurations',jsonb_build_array(60))),
    'conversion',jsonb_build_object('kind','REVIEWED_RULEBOOK_TO_TENANT_RECORDS','sourceVersion',4,'sourceRuleCount',6)
  );

  v_before_versions:=(select count(*) from public.rulebook_versions);
  v_before_audits:=(select count(*) from public.audit_events);
  v_before_rules:=(select count(*) from public.rules);
  v_before_enforcement:=(select count(*) from public.rule_enforcement_versions);
  v_before_models:=(select count(*) from public.constraint_model_versions);
  v_result:=public.convert_reviewed_rulebook_to_tenant_records_v62('${studio}',4,v_source_hash,v_manifest,'GEN-02 conversion fixture');
  if v_result->>'status'<>'APPLIED' or v_result->>'rulebookVersion'<>'5' then raise exception 'conversion did not create Rulebook successor: %',v_result; end if;
  if (select count(*) from public.rules)<>v_before_rules then raise exception 'conversion duplicated or removed rules'; end if;
  if (select count(*) from public.rulebook_versions)<>v_before_versions+1 then raise exception 'conversion did not create exactly one Rulebook successor'; end if;
  if (select snapshot from public.rulebook_versions where studio_id='${studio}' and version=4) is distinct from v_source_snapshot then raise exception 'prior Rulebook authority was rewritten'; end if;
  if (select source_hash from public.rulebook_versions where studio_id='${studio}' and version=4)<>v_source_hash then raise exception 'prior Rulebook source hash changed'; end if;
  if (select source_metadata#>>'{tenantPolicyManifest,sourceRulebookVersion}' from public.rulebook_versions where studio_id='${studio}' and status='CURRENT')<>'5' then raise exception 'successor manifest was not rebased to target version'; end if;
  if (select (source_metadata#>>'{tenantPolicyManifest,records,0,provenance,sourceRulebookVersion}')::integer from public.rulebook_versions where studio_id='${studio}' and status='CURRENT')<>5 then raise exception 'record provenance was not rebased'; end if;
  if (select count(*) from public.constraint_model_versions where status='CURRENT')<>0 then raise exception 'current ConstraintModelVersion was not invalidated'; end if;
  if (select count(*) from public.rule_enforcement_versions where status='CURRENT')<>1 or (select rulebook_version from public.rule_enforcement_versions where status='CURRENT')<>5 then raise exception 'compatibility enforcement was not rebased'; end if;

  -- Exact retry of the source operation returns the same immutable successor.
  v_before_versions:=(select count(*) from public.rulebook_versions); v_before_audits:=(select count(*) from public.audit_events);
  v_result:=public.convert_reviewed_rulebook_to_tenant_records_v62('${studio}',4,v_source_hash,v_manifest,'retry after uncertain response');
  if v_result->>'status'<>'ALREADY_CURRENT' or v_result->>'rulebookVersion'<>'5' then raise exception 'conversion retry was not idempotent: %',v_result; end if;
  if (select count(*) from public.rulebook_versions)<>v_before_versions or (select count(*) from public.audit_events)<>v_before_audits then raise exception 'idempotent retry wrote duplicate authority/audit rows'; end if;

  -- Stale source/hash mismatch is rejected without a write.
  v_rejected:=false; v_before_versions:=(select count(*) from public.rulebook_versions); v_before_audits:=(select count(*) from public.audit_events);
  begin perform public.convert_reviewed_rulebook_to_tenant_records_v62('${studio}',4,repeat('0',64),v_manifest,'stale source'); exception when others then if position('STALE_RULEBOOK_SOURCE' in sqlerrm)=0 then raise; end if; v_rejected:=true; end;
  if not v_rejected or (select count(*) from public.rulebook_versions)<>v_before_versions or (select count(*) from public.audit_events)<>v_before_audits then raise exception 'stale source wrote state'; end if;

  -- Missing record and invalid ownership are rejected before successor creation.
  v_bad:=jsonb_set(v_manifest,'{records}',(v_manifest->'records')-0);
  v_rejected:=false; v_before_versions:=(select count(*) from public.rulebook_versions); v_before_audits:=(select count(*) from public.audit_events);
  begin perform public.convert_reviewed_rulebook_to_tenant_records_v62('${studio}',4,v_source_hash,v_bad,'missing record'); exception when others then if position('TENANT_POLICY_RECORD_ACCOUNTING_INCOMPLETE' in sqlerrm)=0 then raise; end if; v_rejected:=true; end;
  if not v_rejected or (select count(*) from public.rulebook_versions)<>v_before_versions or (select count(*) from public.audit_events)<>v_before_audits then raise exception 'invalid manifest wrote state'; end if;

  -- Name-bound entity resolution is not a tenant record. It is rejected before
  -- conversion so an ambiguous or renamed planning entity cannot be guessed.
  v_bad:=jsonb_set(v_manifest,'{constraints,0,selector}',jsonb_build_object('teacherNames',jsonb_build_array('Teacher A')));
  v_rejected:=false; v_before_versions:=(select count(*) from public.rulebook_versions); v_before_audits:=(select count(*) from public.audit_events);
  begin perform public.convert_reviewed_rulebook_to_tenant_records_v62('${studio}',4,v_source_hash,v_bad,'name-bound identity'); exception when others then if position('TENANT_POLICY_CONSTRAINT_IDENTITY_UNRESOLVED' in sqlerrm)=0 then raise; end if; v_rejected:=true; end;
  if not v_rejected or (select count(*) from public.rulebook_versions)<>v_before_versions or (select count(*) from public.audit_events)<>v_before_audits then raise exception 'name-bound manifest wrote state'; end if;

  -- An authenticated viewer and a member of another studio cannot convert the
  -- selected studio even when the payload is otherwise valid.
  perform set_config('request.jwt.claim.sub','${viewer}',false);
  v_rejected:=false; v_before_versions:=(select count(*) from public.rulebook_versions);
  begin perform public.convert_reviewed_rulebook_to_tenant_records_v62('${studio}',4,v_source_hash,v_manifest,'viewer'); exception when insufficient_privilege then v_rejected:=true; end;
  if not v_rejected or (select count(*) from public.rulebook_versions)<>v_before_versions then raise exception 'viewer conversion was accepted'; end if;
  perform set_config('request.jwt.claim.sub','${owner}',false);
  v_rejected:=false;
  begin perform public.convert_reviewed_rulebook_to_tenant_records_v62('${otherStudio}',4,v_source_hash,v_manifest,'wrong tenant'); exception when insufficient_privilege then v_rejected:=true; end;
  if not v_rejected then raise exception 'wrong-tenant conversion was accepted'; end if;
end
$block$;

-- The effective publication primitive accepts the converted tenant's six-rule
-- model, proving that publication no longer has a fixed 178-rule requirement.
set role postgres;
do $block$
declare v_manifest jsonb; v_model jsonb; v_result jsonb; v_rejected boolean;
begin
  select source_metadata->'tenantPolicyManifest' into v_manifest from public.rulebook_versions where studio_id='${studio}' and status='CURRENT';
  v_model:=jsonb_build_object('schemaVersion','1.0','compilerVersion','dwde-ir-0.9','rulebookVersion',5,'activeRuleCount',6,'hardConstraints',v_manifest->'constraints','objectivePrioritySpine',v_manifest->'objectivePrioritySpine','readinessRuleIds',v_manifest->'readinessRuleIds','governanceAssertions',v_manifest->'governanceAssertions','uncompiledConstraintRuleIds',jsonb_build_array(),'completeHardConstraintCompilation',true);
  v_rejected:=false;
  begin
    perform public.publish_constraint_model_v30(v_model||jsonb_build_object('planningDatasetVersion',1),'planning field must stay outside model',5);
  exception when others then
    if position('TENANT_POLICY_CONSTRAINT_MODEL_INVALID' in sqlerrm)=0 then raise; end if;
    v_rejected:=true;
  end;
  if not v_rejected or (select count(*) from public.constraint_model_versions where status='CURRENT')<>0 then raise exception 'tenant model accepted embedded PlanningDatasetVersion'; end if;
  v_result:=public.publish_constraint_model_v30(v_model,'publish converted tenant model',5);
  if v_result->>'rulebookVersion'<>'5' or v_result->>'compilerVersion'<>'dwde-ir-0.9' then raise exception 'tenant model publication failed: %',v_result; end if;
  if (select count(*) from public.constraint_model_versions where status='CURRENT')<>1 then raise exception 'tenant model was not published'; end if;
end
$block$;

set role authenticated;
select 'GEN-02 DB PASS: immutable tenant conversion, exact accounting, idempotent retry, stale/unauthorized no-write and manifest-derived publication' as result;
`;

export async function main(argv = process.argv.slice(2)) {
  const target = argv.find((arg) => arg.startsWith('--target='))?.slice('--target='.length);
  if (target) process.env.STUDIO_SCHEDULER_TEST_DB_TARGET = target;
  assertDisposableTarget(process.env);
  if (!argv.includes('--allow-disposable') && process.env.STUDIO_SCHEDULER_TEST_DB_ALLOW_DISPOSABLE !== '1') throw new DatabaseHarnessError('Refusing to run without disposable opt-in.');
  const container = `studio-scheduler-gen02-${process.pid}`;
  let running = false;
  try {
    docker(['run','--detach','--rm','--name',container,'-e','POSTGRES_HOST_AUTH_METHOD=trust',image,'postgres']);
    running = true;
    for (let attempt = 0; attempt < 45; attempt += 1) {
      const ready = run('docker',['exec',container,'pg_isready','-U','postgres','-d','postgres']);
      if (ready.status === 0) break;
      if (attempt === 44) throw new DatabaseHarnessError('GEN-02 PostgreSQL did not become ready.');
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    psql(container, setupSql, 'GEN-02 base fixture');
    psql(container, v27Prerequisites, 'GEN-02 V2.7 prerequisites');
    psql(container, readFileSync(path.join(repoRoot, 'supabase/migrations/20260902132207_constraint_model_versions_v27.sql'), 'utf8'), 'GEN-02 V2.7 migration');
    psql(container, fixture, 'GEN-02 source fixture');
    psql(container, readFileSync(migration, 'utf8'), 'GEN-02 migration');
    psql(container, authenticatedReadGrants, 'GEN-02 authenticated read fixture');
    process.stdout.write(psql(container, regression, 'GEN-02 regression'));
  } finally {
    if (running) run('docker',['rm','--force',container]);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  main().catch((error) => { process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`); process.exitCode = 1; });
}
