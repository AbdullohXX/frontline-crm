create or replace function public.save_member(p jsonb) returns void language plpgsql security definer set search_path='' as $$
declare actor public.team_members; target text;
begin
 actor:=public.current_member();if actor.role is distinct from 'Admin' then raise exception 'ACCESS: Admin required';end if;
 perform pg_advisory_xact_lock(710104);target:=lower(p->>'email');
 if split_part(target,'@',2)<>'frontline-x.com' or target !~ '^[^\s@]+@frontline-x\.com$' then raise exception 'Use company email';end if;
 if target=actor.email and (p->>'role'<>'Admin' or not (p->>'active')::boolean) then raise exception 'You cannot disable or demote your own admin account';end if;
 insert into public.team_members(email,display_name,role,active,aliases,job_role) values(target,trim(p->>'display_name'),p->>'role',(p->>'active')::boolean,array(select lower(jsonb_array_elements_text(coalesce(p->'aliases','[]'::jsonb)))),coalesce(p->>'job_role',(select job_role from public.team_members where email=target),'Other'))
 on conflict(email) do update set display_name=excluded.display_name,role=excluded.role,active=excluded.active,aliases=excluded.aliases,job_role=excluded.job_role;
 insert into public.admin_audit(actor_email,action,details) values(actor.email,'Team member saved',p);
end $$;