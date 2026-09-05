-- V4.0 archive lifecycle hardening.
-- Archived planning records are historical identities, not an alternate edit surface.
-- Restore first, then edit. Also preserve schedule locks when a class itself is archived.

create or replace function private.guard_archived_planning_entity_edit_v40()
returns trigger
language plpgsql
security definer
set search_path=''
as $function$
begin
  if old.archived_at is not null
     and new.archived_at is not distinct from old.archived_at
     and (to_jsonb(new) - 'updated_at' - 'archived_at') is distinct from (to_jsonb(old) - 'updated_at' - 'archived_at') then
    raise exception 'ARCHIVED_ENTITY_READ_ONLY: restore this record before editing active planning fields';
  end if;
  return new;
end
$function$;
revoke all on function private.guard_archived_planning_entity_edit_v40() from public,anon,authenticated;

drop trigger if exists trg_teachers_archived_read_only_v40 on public.teachers;
create trigger trg_teachers_archived_read_only_v40 before update on public.teachers
for each row execute function private.guard_archived_planning_entity_edit_v40();

drop trigger if exists trg_students_archived_read_only_v40 on public.students;
create trigger trg_students_archived_read_only_v40 before update on public.students
for each row execute function private.guard_archived_planning_entity_edit_v40();

drop trigger if exists trg_rooms_archived_read_only_v40 on public.rooms;
create trigger trg_rooms_archived_read_only_v40 before update on public.rooms
for each row execute function private.guard_archived_planning_entity_edit_v40();

drop trigger if exists trg_classes_archived_read_only_v40 on public.class_definitions;
create trigger trg_classes_archived_read_only_v40 before update on public.class_definitions
for each row execute function private.guard_archived_planning_entity_edit_v40();

drop trigger if exists trg_sessions_archived_read_only_v40 on public.class_sessions;
create trigger trg_sessions_archived_read_only_v40 before update on public.class_sessions
for each row execute function private.guard_archived_planning_entity_edit_v40();

create or replace function private.guard_class_archive_locked_sessions_v40()
returns trigger
language plpgsql
security definer
set search_path=''
as $function$
declare
  v_locked text[];
begin
  if old.archived_at is null and new.archived_at is not null then
    select array_agg(distinct s.id order by s.id) into v_locked
    from public.class_sessions s
    join public.assignments a on a.session_id=s.id and a.studio_id=new.studio_id
    join public.schedule_versions sv on sv.id=a.schedule_version_id and sv.studio_id=new.studio_id
    where s.studio_id=new.studio_id
      and s.class_id=new.id
      and s.archived_at is null
      and sv.is_current
      and a.locked;
    if coalesce(array_length(v_locked,1),0)>0 then
      raise exception 'CLASS_ARCHIVE_BLOCKED_LOCKED_SESSION: unlock or resolve current locked sessions first: %',array_to_string(v_locked,', ');
    end if;
  end if;
  return new;
end
$function$;
revoke all on function private.guard_class_archive_locked_sessions_v40() from public,anon,authenticated;

drop trigger if exists trg_classes_archive_locked_guard_v40 on public.class_definitions;
create trigger trg_classes_archive_locked_guard_v40
before update of archived_at on public.class_definitions
for each row execute function private.guard_class_archive_locked_sessions_v40();
