-- GEN-04: align the active calendar contract across SQL validators and the
-- assignment table. Historical migration bytes remain unchanged; only the
-- effective function definitions are replaced here.

do $block$
declare
  v_constraint record;
begin
  for v_constraint in
    select conname
    from pg_constraint
    where conrelid='public.assignments'::regclass
      and pg_get_constraintdef(oid) like '%Monday%'
      and pg_get_constraintdef(oid) like '%Saturday%'
  loop
    execute format('alter table public.assignments drop constraint %I',v_constraint.conname);
  end loop;
end
$block$;

alter table public.assignments
  add constraint assignments_day_gen04_check
  check(day in ('Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'));

do $block$
declare
  v_function record;
  v_definition text;
  v_updated text;
begin
  -- These are the active write, candidate, recovery, setup, and typed-schedule
  -- validation bodies. Restricting the patch to their names avoids changing
  -- DWDE-specific historical wording that intentionally describes a
  -- Monday-Saturday rule.
  for v_function in
    select p.oid
    from pg_proc p
    join pg_namespace n on n.oid=p.pronamespace
    where (n.nspname='public' and p.proname in (
      'apply_schedule_builder_patch_v23',
      'apply_schedule_command_v25',
      'adopt_solver_candidate_v33',
      'apply_authoritative_incremental_command_v47',
      'apply_authoritative_schedule_recovery_v48'
    ))
    or (n.nspname='private' and (
      p.proname='validate_setup_typed_policy_v55'
      or p.proname like 'validate_typed_schedule_v54%'
    ))
  loop
    v_definition:=pg_get_functiondef(v_function.oid);
    v_updated:=replace(
      v_definition,
      '''Monday'',''Tuesday'',''Wednesday'',''Thursday'',''Friday'',''Saturday''',
      '''Monday'',''Tuesday'',''Wednesday'',''Thursday'',''Friday'',''Saturday'',''Sunday'''
    );
    if v_updated<>v_definition then execute v_updated; end if;
  end loop;
end
$block$;

do $block$
declare
  v_definition text;
  v_updated text;
  v_oid oid;
begin
  select p.oid into v_oid
  from pg_proc p
  join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='private' and p.proname='canonical_tenant_typed_policy_value_v62'
  limit 1;
  if v_oid is null then raise exception 'GEN04_CANONICAL_DAY_AUTHORITY_MISSING'; end if;
  v_definition:=pg_get_functiondef(v_oid);
  v_updated:=replace(
    v_definition,
    $$when 'Friday' then 5 when 'Saturday' then 6 else 99$$,
    $$when 'Friday' then 5 when 'Saturday' then 6 when 'Sunday' then 7 else 99$$
  );
  if v_updated<>v_definition then execute v_updated; end if;
end
$block$;
