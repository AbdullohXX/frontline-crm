begin;
create table public.agent_targets(email text primary key references public.team_members(email), calls integer not null default 50 check(calls between 1 and 10000), emails integer not null default 20 check(emails between 1 and 10000));
create table public.agent_presence(email text primary key references public.team_members(email), last_seen timestamptz not null default now());
create table public.agent_usage(email text references public.team_members(email), day date, minutes integer not null default 0, primary key(email,day));
create table public.gmail_imports(email text references public.team_members(email), message_id text, lead_id uuid references public.leads(id), primary key(email,message_id,lead_id));
alter table public.agent_targets enable row level security;
alter table public.agent_presence enable row level security;
alter table public.agent_usage enable row level security;
alter table public.gmail_imports enable row level security;
revoke all on public.agent_targets,public.agent_presence,public.agent_usage,public.gmail_imports from anon,authenticated;
grant select on public.agent_targets,public.agent_presence,public.agent_usage to authenticated;
grant insert,update on public.agent_targets to authenticated;
create policy targets_read on public.agent_targets for select to authenticated using ((select (public.current_member()).email) is not null);
create policy targets_write on public.agent_targets for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
create policy presence_read on public.agent_presence for select to authenticated using ((select (public.current_member()).email) is not null);
create policy usage_read on public.agent_usage for select to authenticated using ((select (public.current_member()).email) is not null);
create function public.record_presence() returns void language plpgsql security definer set search_path='' as $$
declare actor public.team_members; previous timestamptz; today date;
begin
 actor:=public.current_member(); if actor.email is null then raise exception 'ACCESS: Active team account required'; end if;
 perform pg_advisory_xact_lock(hashtext('presence:'||actor.email));
 select last_seen into previous from public.agent_presence where email=actor.email;
 select (now() at time zone time_zone)::date into today from public.crm_settings limit 1;
 if previous is null or previous<=now()-interval '55 seconds' then
 insert into public.agent_usage(email,day,minutes) values(actor.email,today,1) on conflict(email,day) do update set minutes=public.agent_usage.minutes+1;
 insert into public.agent_presence(email,last_seen) values(actor.email,now()) on conflict(email) do update set last_seen=now();
 end if;
end $$;
create function public.import_gmail(p jsonb) returns integer language plpgsql security definer set search_path='' as $$
declare actor public.team_members; item jsonb; lead public.leads; total integer:=0; added integer;
begin
 actor:=public.current_member(); if actor.email is null then raise exception 'ACCESS: Active team account required'; end if;
 if jsonb_array_length(p)>100 then raise exception 'Batch too large'; end if;
 for item in select * from jsonb_array_elements(p) loop
 if length(item->>'id')>200 or (item->>'sent_at')::timestamptz>now()+interval '5 minutes' then raise exception 'Invalid message';end if;
 for lead in select * from public.leads where archived_at is null and email<>'' and lower(email) in (select lower(value) from jsonb_array_elements_text(item->'recipients')) loop
 insert into public.gmail_imports values(actor.email,item->>'id',lead.id) on conflict do nothing;
 get diagnostics added=row_count;
 if added=1 then
 insert into public.activities(lead_id,actor_email,actor_name,action,details,outcome,created_at)
 values(lead.id,actor.email,actor.display_name,'Email','Gmail sent email: '||left(coalesce(item->>'subject','(No subject)'),300),'Sent',(item->>'sent_at')::timestamptz);
 total:=total+1;
 end if;
 end loop;
 end loop;
 return total;
end $$;
revoke all on function public.record_presence(),public.import_gmail(jsonb) from public,anon;
grant execute on function public.record_presence(),public.import_gmail(jsonb) to authenticated;
commit;
