do $block$
declare
  v_studio uuid;
  v_old public.schedule_versions%rowtype;
  v_rb integer;
  v_new_id uuid;
  v_new_version integer;
  v_actor_id uuid;
  v_validation jsonb;
begin
  for v_studio in select id from public.studios loop
    select * into v_old from public.schedule_versions where studio_id=v_studio and is_current limit 1;
    select version into v_rb from public.rulebook_versions where studio_id=v_studio and status='CURRENT';
    if v_old.id is not null and v_rb is not null and v_old.rulebook_version<>v_rb then
      perform pg_advisory_xact_lock(hashtextextended(v_studio::text,0));
      v_new_version:=v_old.version+1;
      select user_id into v_actor_id from public.studio_members where studio_id=v_studio and role='OWNER' order by created_at limit 1;
      insert into public.schedule_versions(studio_id,version,rulebook_version,actor_user_id,actor_label,reason,is_current)
        values(v_studio,v_new_version,v_rb,v_actor_id,'V2.1 system','Revalidated unchanged assignments against current Rulebook v'||v_rb,false)
        returning id into v_new_id;
      insert into public.assignments(schedule_version_id,id,studio_id,session_id,day,start_time,end_time,teacher_id,room_id,locked,status)
        select v_new_id,id,studio_id,session_id,day,start_time,end_time,teacher_id,room_id,locked,status
        from public.assignments where schedule_version_id=v_old.id;
      select public.validate_schedule_hard_v21(v_new_id) into v_validation;
      update public.schedule_versions set is_current=false where id=v_old.id;
      update public.schedule_versions set is_current=true,validation_result=v_validation where id=v_new_id;
      insert into public.audit_events(studio_id,actor_user_id,actor_label,action,entity_type,detail,payload)
        values(v_studio,v_actor_id,'V2.1 system','SCHEDULE_REBASE','SCHEDULE','Rebased current schedule onto Rulebook v'||v_rb,
          jsonb_build_object('fromScheduleVersion',v_old.version,'toScheduleVersion',v_new_version,'fromRulebookVersion',v_old.rulebook_version,'toRulebookVersion',v_rb,'validation',v_validation));
    end if;
  end loop;
end $block$;