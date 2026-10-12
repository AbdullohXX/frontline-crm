begin;
create table public.sales_advisor_runs(id uuid primary key default gen_random_uuid(),actor text not null references public.team_members(email),created_at timestamptz not null default now(),status text not null default 'running' check(status in ('running','complete','failed')),report jsonb);
alter table public.sales_advisor_runs enable row level security;
revoke all on public.sales_advisor_runs from public,anon,authenticated;
grant select on public.sales_advisor_runs to authenticated;
create policy advisor_read on public.sales_advisor_runs for select to authenticated using(actor=(select (public.current_member()).email));
create function public.sales_advisor_run(p jsonb) returns uuid language plpgsql security definer set search_path='' as $$
declare member public.team_members; target uuid;
begin
 member:=public.current_member();if member.email is null then raise exception 'ACCESS: Active company member required';end if;
 perform pg_advisory_xact_lock(hashtext('advisor:'||member.email));
 if p->>'action'='start' then
 if (select count(*) from public.sales_advisor_runs where actor=member.email and created_at>now()-interval '1 hour')>=3 then raise exception 'Analysis limit reached: three runs per hour. Try later.';end if;
 if exists(select 1 from public.sales_advisor_runs where actor=member.email and status='running' and created_at>now()-interval '3 minutes') then raise exception 'An analysis is already running';end if;
 insert into public.sales_advisor_runs(actor) values(member.email) returning id into target;return target;
 end if;
 if p->>'action' not in ('complete','failed') then raise exception 'Invalid analysis operation';end if;
 target:=(p->>'id')::uuid;
 if octet_length(coalesce(p->'report','{}'::jsonb)::text)>150000 then raise exception 'Report too large';end if;
 update public.sales_advisor_runs set status=case when p->>'action'='complete' then 'complete' else 'failed' end,report=p->'report' where id=target and actor=member.email and status='running';
 if not found then raise exception 'ACCESS: Analysis unavailable';end if;return target;
end $$;
revoke all on function public.sales_advisor_run(jsonb) from public,anon;
grant execute on function public.sales_advisor_run(jsonb) to authenticated;
commit;
