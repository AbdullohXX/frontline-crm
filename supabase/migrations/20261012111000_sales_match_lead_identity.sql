create or replace function crm_private.match_sales_call() returns trigger language plpgsql security definer set search_path='' as $$
declare candidate uuid; matches int; claim public.sales_calls;
begin
 if new.kind<>'call' or new.direction<>'outgoing' then return new;end if;
 perform pg_advisory_xact_lock(810122);
 if not exists(select 1 from public.sales_calls where call_id=new.id) then
 select count(*),(array_agg(a.id))[1] into matches,candidate from public.calling_attempts a join public.calling_sessions s on s.id=a.session_id
 where not exists(select 1 from public.sales_calls used where used.attempt_id=a.id) and a.lead_id=new.lead_id and a.phone=new.phone and new.occurred_at>=a.started_at and new.occurred_at<a.started_at+interval '10 minutes' and new.occurred_at<s.expires_at and (s.ended_at is null or new.occurred_at<=s.ended_at);
 if matches=1 and not exists(select 1 from public.sales_calls where attempt_id=candidate) then
 insert into public.sales_calls(call_id,attempt_id,rep,lead_id,attribution) select new.id,a.id,s.rep,a.lead_id,'Session match' from public.calling_attempts a join public.calling_sessions s on s.id=a.session_id where a.id=candidate on conflict do nothing;
 end if;
 end if;
 select * into claim from public.sales_calls where call_id=new.id;
 if new.activity_id is not null then
 update public.activities set actor_email=coalesce(claim.rep,''),actor_name=coalesce((select display_name from public.team_members where email=claim.rep),'Shared Quo · Unassigned') where id=new.activity_id;
 end if;
 return new;
end $$;
revoke all on function crm_private.match_sales_call() from public,anon,authenticated;