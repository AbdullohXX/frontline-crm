create or replace function crm_private.match_sales_call() returns trigger language plpgsql security definer set search_path='' as $$
declare candidate uuid; matches int; claim public.sales_calls;
begin
 if new.kind<>'call' or new.direction<>'outgoing' then return new;end if;
 perform pg_advisory_xact_lock(810122);
 if not exists(select 1 from public.sales_calls where call_id=new.id) then
 select count(*),(array_agg(a.id))[1] into matches,candidate from public.calling_attempts a join public.calling_sessions s on s.id=a.session_id
 where not exists(select 1 from public.sales_calls used where used.attempt_id=a.id) and a.phone=new.phone and new.occurred_at>=a.started_at and new.occurred_at<a.started_at+interval '10 minutes' and new.occurred_at<s.expires_at and (s.ended_at is null or new.occurred_at<=s.ended_at);
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
create or replace function public.sales_call_action(p jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor public.team_members; session public.calling_sessions; lead public.leads; claim public.sales_calls; ev public.quo_events; attempt uuid; chosen_rep text; result text;
begin
 actor:=public.current_member();if actor.email is null then raise exception 'ACCESS: Active company account required';end if;
 perform pg_advisory_xact_lock(810122);
 if p->>'action'='start' then
 if actor.job_role<>'Sales rep' and actor.role<>'Admin' then raise exception 'ACCESS: Sales rep account required';end if;
 update public.calling_sessions set ended_at=now() where rep=actor.email and ended_at is null;
 insert into public.calling_sessions(rep) values(actor.email) returning * into session;return to_jsonb(session);
 elsif p->>'action'='stop' then
 update public.calling_sessions set ended_at=now() where rep=actor.email and ended_at is null;return '{"ok":true}';
 elsif p->>'action'='attempt' then
 select * into session from public.calling_sessions where rep=actor.email and ended_at is null and expires_at>now() order by started_at desc limit 1;
 if session.id is null then raise exception 'Start your calling session first';end if;
 select * into lead from public.leads where id=(p->>'lead_id')::uuid and archived_at is null;
 if lead.id is null or crm_private.quo_phone(lead.phone,lead.country)='' then raise exception 'Lead needs a valid phone number';end if;
 if exists(select 1 from public.calling_attempts a where a.session_id=session.id and a.started_at>now()-interval '10 minutes' and not exists(select 1 from public.sales_calls c where c.attempt_id=a.id)) then raise exception 'Wait for the previous call to sync before registering another attempt (up to 10 minutes).';end if;
 insert into public.calling_attempts(session_id,lead_id,phone) values(session.id,lead.id,crm_private.quo_phone(lead.phone,lead.country)) returning id into attempt;return jsonb_build_object('attempt',attempt,'expiresInMinutes',10);
 elsif p->>'action'='assign' then
 if actor.role<>'Admin' then raise exception 'ACCESS: Admin review required';end if;
 chosen_rep:=p->>'rep';if not exists(select 1 from public.team_members where email=chosen_rep and active and job_role='Sales rep') then raise exception 'Choose an active sales rep';end if;
 select * into ev from public.quo_events where id=p->>'call_id' and kind='call' and direction='outgoing';
 if ev.id is null or ev.lead_id is null then raise exception 'Link this Quo call to a lead first';end if;
 if exists(select 1 from public.sales_calls where call_id=ev.id) then raise exception 'Call already attributed';end if;
 insert into public.sales_calls(call_id,rep,lead_id,attribution) values(ev.id,chosen_rep,ev.lead_id,'Admin reviewed');
 if ev.activity_id is not null then update public.activities set actor_email=chosen_rep,actor_name=(select display_name from public.team_members where email=chosen_rep) where id=ev.activity_id;end if;
 insert into public.activities(lead_id,actor_email,actor_name,action,details) values(ev.lead_id,actor.email,actor.display_name,'Call attribution','Admin attributed Quo call '||ev.id||' to '||chosen_rep);
 return '{"ok":true}';
 elsif p->>'action'='outcome' then
 select * into claim from public.sales_calls where call_id=p->>'call_id' for update;
 if claim.call_id is null or (actor.role<>'Admin' and claim.rep<>actor.email) then raise exception 'ACCESS: Only attributed rep or admin may confirm outcome';end if;
 result:=p->>'outcome';if result not in ('Spoke to person','Voicemail','No answer','Wrong number','Number disconnected','Follow-up required','Meeting booked','Qualified') then raise exception 'Choose a valid outcome';end if;
 update public.sales_calls set outcome=result,confirmed_at=now(),confirmed_by=actor.email where call_id=claim.call_id;
 insert into public.activities(lead_id,actor_email,actor_name,action,details,outcome) values(claim.lead_id,actor.email,actor.display_name,'Sales call outcome','Confirmed outcome for Quo call '||claim.call_id,result);
 return '{"ok":true}';end if;
 raise exception 'Unknown calling operation';
end $$;
revoke all on function public.sales_call_action(jsonb) from public,anon;
grant execute on function public.sales_call_action(jsonb) to authenticated;