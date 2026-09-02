create or replace function public.list_studio_members_v21()
returns table(user_id uuid, role text, display_name text, email text, created_at timestamptz)
language plpgsql
stable
security definer
set search_path=''
as $function$
declare
  ctx jsonb:=private.dwde_actor_context();
  v_studio uuid:=(ctx->>'studio_id')::uuid;
begin
  if ctx->>'role'<>'OWNER' then
    return query
      select
        m.user_id,
        m.role::text,
        coalesce(p.display_name,u.email)::text,
        u.email::text,
        m.created_at
      from public.studio_members m
      join auth.users u on u.id=m.user_id
      left join public.profiles p on p.id=m.user_id
      where m.studio_id=v_studio and m.user_id=auth.uid();
    return;
  end if;

  return query
    select
      m.user_id,
      m.role::text,
      coalesce(p.display_name,u.email)::text,
      u.email::text,
      m.created_at
    from public.studio_members m
    join auth.users u on u.id=m.user_id
    left join public.profiles p on p.id=m.user_id
    where m.studio_id=v_studio
    order by case m.role when 'OWNER' then 0 when 'EDITOR' then 1 else 2 end,
             coalesce(p.display_name,u.email);
end
$function$;

revoke all on function public.list_studio_members_v21() from public,anon;
grant execute on function public.list_studio_members_v21() to authenticated,service_role;