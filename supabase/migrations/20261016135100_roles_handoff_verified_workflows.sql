begin;
alter table public.team_members add column can_export boolean not null default false, add column can_archive boolean not null default false, add column can_ai boolean not null default false, add column can_shared_sms boolean not null default false;
update public.team_members set can_shared_sms=true where active and job_role='Sales rep';
alter table public.leads add column sales_assignee text references public.team_members(email), add column handoff_status text not null default 'Not submitted' check(handoff_status in ('Not submitted','Pending','Accepted','Returned')), add column handoff_at timestamptz, add column handoff_note text not null default '';
create index leads_sales_assignee on public.leads(sales_assignee,handoff_status) where archived_at is null;
alter table public.calling_attempts add column cancelled_at timestamptz;
alter table public.sales_calls add column disposition text not null default '' check(disposition in ('','Spoke to person','Voicemail','No answer','Wrong number','Number disconnected'));
create table public.shared_quo_numbers(id text primary key check(id ~ '^PN[a-zA-Z0-9_-]+$'), enabled boolean not null default true);
alter table public.shared_quo_numbers enable row level security;
revoke all on public.shared_quo_numbers from public,anon,authenticated;
grant select on public.shared_quo_numbers to authenticated;
create policy shared_numbers_read on public.shared_quo_numbers for select to authenticated using((select (public.current_member()).email) is not null);

create function public.crm_capability(cap text) returns boolean language sql stable security definer set search_path='' as $$
select coalesce(m.role='Admin' or case cap when 'export' then m.can_export when 'archive' then m.can_archive when 'ai' then m.can_ai when 'sms' then m.can_shared_sms and m.job_role='Sales rep' when 'sales' then m.job_role='Sales rep' else false end,false) from public.current_member() m
$$;
revoke all on function public.crm_capability(text) from public,anon; grant execute on function public.crm_capability(text) to authenticated;

alter function public.save_member(jsonb) set schema crm_private;
alter function crm_private.save_member(jsonb) rename to save_member_legacy;
revoke all on function crm_private.save_member_legacy(jsonb) from public,anon,authenticated;
create function public.save_member(p jsonb) returns void language plpgsql security definer set search_path='' as $$
begin
 if not public.is_admin() then raise exception 'ACCESS: Admin required';end if;
 perform crm_private.save_member_legacy(p);
 update public.team_members set can_export=coalesce((p->>'can_export')::boolean,can_export),can_archive=coalesce((p->>'can_archive')::boolean,can_archive),can_ai=coalesce((p->>'can_ai')::boolean,can_ai),can_shared_sms=coalesce((p->>'can_shared_sms')::boolean,can_shared_sms) where email=lower(p->>'email');
end $$;
revoke all on function public.save_member(jsonb) from public,anon;grant execute on function public.save_member(jsonb) to authenticated;
create function crm_private.end_ineligible_sessions() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if (old.active and not new.active) or old.job_role is distinct from new.job_role or old.role is distinct from new.role then
 update public.calling_sessions set ended_at=now() where rep=new.email and ended_at is null;
 end if;return new;
end $$;
revoke all on function crm_private.end_ineligible_sessions() from public,anon,authenticated;
create trigger member_session_permissions after update on public.team_members for each row execute function crm_private.end_ineligible_sessions();

alter function public.save_lead(jsonb) set schema crm_private;
alter function crm_private.save_lead(jsonb) rename to save_lead_legacy;
revoke all on function crm_private.save_lead_legacy(jsonb) from public,anon,authenticated;
create function public.save_lead(p jsonb) returns public.leads language plpgsql security definer set search_path='' as $$
declare old public.leads;
begin
 if (public.current_member()).email is null then raise exception 'ACCESS: Active member required';end if;
 if not public.crm_capability('sales') then
 select * into old from public.leads where id=nullif(p->>'id','')::uuid for update;
 if (old.id is null and (p->>'stage'<>'New' or coalesce((p->>'value')::numeric,0)<>0)) or (old.id is not null and (p->>'stage' is distinct from old.stage or (p->>'value')::numeric is distinct from old.value)) then raise exception 'ACCESS: Sales reps manage stage and deal value';end if;
 end if;
 return crm_private.save_lead_legacy(p);
end $$;
revoke all on function public.save_lead(jsonb) from public,anon;grant execute on function public.save_lead(jsonb) to authenticated;
alter function crm_private.change_leads(jsonb) rename to change_leads_legacy;
revoke all on function crm_private.change_leads_legacy(jsonb) from public,anon,authenticated;
create function crm_private.change_leads(p jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if p->>'action' in ('archive','restore') and not public.crm_capability('archive') then raise exception 'ACCESS: Archive permission required';end if;
 if p->>'action'='stage' and not public.crm_capability('sales') then raise exception 'ACCESS: Sales rep permission required';end if;
 return crm_private.change_leads_legacy(p);
end $$;
revoke all on function crm_private.change_leads(jsonb) from public,anon;grant execute on function crm_private.change_leads(jsonb) to authenticated;

create function public.handoff_lead(p jsonb) returns public.leads language plpgsql security definer set search_path='' as $$
declare actor public.team_members:=public.current_member(); old public.leads; saved public.leads; target text:=p->>'rep'; operation text:=p->>'action';
begin
 if actor.email is null then raise exception 'ACCESS: Active member required';end if;
 select * into old from public.leads where id=(p->>'lead_id')::uuid for update;
 if old.id is null or old.archived_at is not null then raise exception 'Lead unavailable';end if;
 if old.version is distinct from (p->>'version')::integer then raise exception 'CONFLICT: Refresh lead before handoff';end if;
 if operation='submit' then
 if actor.role<>'Admin' and not (actor.job_role='Lead generator' and (old.created_by=actor.email or old.owner_email=actor.email)) then raise exception 'ACCESS: Only responsible generator or admin may submit';end if;
 if old.handoff_status in ('Pending','Accepted') and actor.role<>'Admin' then raise exception 'Ask admin to reassign an existing handoff';end if;
 if not exists(select 1 from public.team_members where email=target and active and job_role='Sales rep') then raise exception 'Choose an active sales rep';end if;
 if trim(old.phone)='' and trim(old.email)='' then raise exception 'Add phone or email before handoff';end if;
 update public.leads set sales_assignee=target,handoff_status='Pending',handoff_at=now(),handoff_note=left(coalesce(p->>'note',''),1000),version=version+1,updated_at=now() where id=old.id returning * into saved;
 elsif operation in ('accept','return') then
 if actor.role<>'Admin' and (actor.email is distinct from old.sales_assignee or actor.job_role<>'Sales rep') then raise exception 'ACCESS: Assigned sales rep required';end if;
 if old.handoff_status<>'Pending' then raise exception 'Handoff is not pending';end if;
 if operation='return' and trim(coalesce(p->>'note',''))='' then raise exception 'Add a return reason';end if;
 update public.leads set handoff_status=case operation when 'accept' then 'Accepted' else 'Returned' end,handoff_note=left(coalesce(p->>'note',''),1000),version=version+1,updated_at=now() where id=old.id returning * into saved;
 else raise exception 'Invalid handoff action';end if;
 insert into public.activities(lead_id,actor_email,actor_name,action,details,snapshot) values(old.id,actor.email,actor.display_name,'Sales handoff',operation||': '||coalesce(saved.sales_assignee,'')||' '||saved.handoff_note,jsonb_build_object('before',to_jsonb(old),'after',to_jsonb(saved)));
 return saved;
end $$;
revoke all on function public.handoff_lead(jsonb) from public,anon;grant execute on function public.handoff_lead(jsonb) to authenticated;
create or replace function crm_private.quo_phone(value text,country text default '') returns text language sql immutable set search_path='' as $$
with digits as(select regexp_replace(coalesce(value,''),'[^0-9]','','g') d), normalized as(select case when length(d)=10 and trim(regexp_replace(upper(coalesce(country,'')),'[^A-Z]+',' ','g')) ~ '^(U S A|U S|USA|US|UNITED STATES OF AMERICA|UNITED STATES|CA|CANADA)( |$)' then '1'||d else d end n from digits) select case when n ~ '^[1-9][0-9]{6,14}$' then n else '' end from normalized $$;
revoke all on function crm_private.quo_phone(text,text) from public,anon,authenticated;
create or replace function crm_private.quo_match_phone(p_phone text) returns uuid language sql stable set search_path='' as $$
with matches as(select id from public.leads where archived_at is null and crm_private.quo_phone(phone,country)=p_phone and p_phone<>'' union select l.id from public.lead_contacts c join public.leads l on l.id=c.lead_id where l.archived_at is null and c.archived_at is null and crm_private.quo_phone(c.phone,l.country)=p_phone and p_phone<>'') select case when count(*)=1 then (array_agg(id))[1] end from matches $$;
revoke all on function crm_private.quo_match_phone(text) from public,anon,authenticated;
create or replace function crm_private.match_sales_call() returns trigger language plpgsql security definer set search_path='' as $$
declare candidate uuid; matches int; claim public.sales_calls;
begin
 if new.kind<>'call' or new.direction<>'outgoing' then return new;end if;
 perform pg_advisory_xact_lock(810122);
 if not exists(select 1 from public.sales_calls where call_id=new.id) then
 select count(*),(array_agg(a.id))[1] into matches,candidate from public.calling_attempts a join public.calling_sessions s on s.id=a.session_id
 where a.cancelled_at is null and not exists(select 1 from public.sales_calls used where used.attempt_id=a.id) and a.lead_id=new.lead_id and a.phone=new.phone and new.occurred_at>=a.started_at and new.occurred_at<a.started_at+interval '10 minutes' and new.occurred_at<s.expires_at and (s.ended_at is null or new.occurred_at<=s.ended_at);
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
alter function public.sales_call_action(jsonb) set schema crm_private;
alter function crm_private.sales_call_action(jsonb) rename to sales_call_action_legacy;
revoke all on function crm_private.sales_call_action_legacy(jsonb) from public,anon,authenticated;
create function public.sales_call_action(p jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor public.team_members:=public.current_member(); l public.leads; oldlead public.leads; s public.calling_sessions; a public.calling_attempts; claim public.sales_calls; ev public.quo_events; target text; result jsonb; disp text:=coalesce(p->>'disposition',''); nextstage text;
begin
 if actor.email is null then raise exception 'ACCESS: Active member required';end if;
 perform pg_advisory_xact_lock(810122);
 if p->>'action' in ('start','attempt','launch') and not public.crm_capability('sales') then raise exception 'ACCESS: Sales rep required';end if;
 if p->>'action' in ('attempt','launch') then
 select * into l from public.leads where id=(p->>'lead_id')::uuid and archived_at is null;
 if l.id is null then raise exception 'Lead unavailable';end if;
 target:=crm_private.quo_phone(coalesce(nullif(p->>'phone',''),l.phone),l.country);
 if target='' or (target<>crm_private.quo_phone(l.phone,l.country) and not exists(select 1 from public.lead_contacts c where c.lead_id=l.id and c.archived_at is null and crm_private.quo_phone(c.phone,l.country)=target)) then raise exception 'Choose a phone saved on this lead';end if;
 select * into s from public.calling_sessions where rep=actor.email and ended_at is null and expires_at>now() order by started_at desc limit 1;
 if s.id is null then insert into public.calling_sessions(rep) values(actor.email) returning * into s;end if;
 select ca.* into a from public.calling_attempts ca join public.calling_sessions cs on cs.id=ca.session_id where cs.rep=actor.email and cs.ended_at is null and ca.cancelled_at is null and ca.started_at>now()-interval '10 minutes' and not exists(select 1 from public.sales_calls sc where sc.attempt_id=ca.id) order by ca.started_at desc limit 1;
 if a.id is not null then raise exception 'An attempt is awaiting Quo. Cancel it if no call was made, or wait for sync.';end if;
 insert into public.calling_attempts(session_id,lead_id,phone) values(s.id,l.id,target) returning * into a;
 return jsonb_build_object('attempt',a.id,'phone','+'||target,'expires_at',a.started_at+interval '10 minutes');
 elsif p->>'action'='cancel' then
 select ca.* into a from public.calling_attempts ca join public.calling_sessions cs on cs.id=ca.session_id where ca.id=(p->>'attempt_id')::uuid and (cs.rep=actor.email or actor.role='Admin') for update of ca;
 if a.id is null or exists(select 1 from public.sales_calls where attempt_id=a.id) then raise exception 'Attempt unavailable or already matched';end if;
 update public.calling_attempts set cancelled_at=now() where id=a.id;
 insert into public.activities(lead_id,actor_email,actor_name,action,details) values(a.lead_id,actor.email,actor.display_name,'Call attempt cancelled','Unused attempt cancelled: '||a.id);return '{"ok":true}';
 elsif p->>'action'='assign' then
 if actor.role<>'Admin' then raise exception 'ACCESS: Admin required';end if;
 if length(trim(coalesce(p->>'reason','')))<5 then raise exception 'Explain the evidence for this caller assignment';end if;
 target:=p->>'rep';if not exists(select 1 from public.team_members where email=target and active and job_role='Sales rep') then raise exception 'Choose an active sales rep';end if;
 select * into ev from public.quo_events where id=p->>'call_id' and kind='call' and direction='outgoing';
 if ev.id is null or ev.lead_id is null then raise exception 'Link call to a lead first';end if;
 select * into claim from public.sales_calls where call_id=ev.id for update;
 insert into public.sales_calls(call_id,rep,lead_id,attribution) values(ev.id,target,ev.lead_id,'Admin reviewed') on conflict(call_id) do update set rep=excluded.rep,attribution='Admin reviewed',outcome='',disposition='',confirmed_at=null,confirmed_by=null;
 if ev.activity_id is not null then update public.activities set actor_email=target,actor_name=(select display_name from public.team_members where email=target) where id=ev.activity_id;end if;
 insert into public.activities(lead_id,actor_email,actor_name,action,details,snapshot) values(ev.lead_id,actor.email,actor.display_name,'Call attribution',left(p->>'reason',1000),jsonb_build_object('before',to_jsonb(claim),'rep',target,'call_id',ev.id));return '{"ok":true}';
 elsif p->>'action'='outcome' then
 select * into claim from public.sales_calls where call_id=p->>'call_id' for update;
 if claim.call_id is null or (actor.role<>'Admin' and claim.rep<>actor.email) then raise exception 'ACCESS: Attributed rep required';end if;
 if disp not in ('Spoke to person','Voicemail','No answer','Wrong number','Number disconnected') then raise exception 'Confirm connection disposition';end if;
 if coalesce(p->>'outcome','') not in ('Spoke to person','Voicemail','No answer','Wrong number','Number disconnected','Follow-up required','Meeting booked','Qualified') then raise exception 'Choose a sales outcome';end if;
 if p->>'outcome' in ('Meeting booked','Qualified') and disp<>'Spoke to person' then raise exception 'This sales result requires human contact';end if;
 select * into oldlead from public.leads where id=claim.lead_id for update;
 if oldlead.archived_at is not null then raise exception 'Restore lead before updating outcome';end if;
 if p ? 'version' and oldlead.version is distinct from (p->>'version')::integer then raise exception 'CONFLICT: Refresh lead before saving';end if;
 if p->>'outcome'='Follow-up required' and (coalesce(p->>'next_action','')='' or coalesce(p->>'next_follow_up','')='') then raise exception 'Schedule the follow-up';end if;
 if (coalesce(p->>'next_action','')='')<>(coalesce(p->>'next_follow_up','')='') then raise exception 'Provide both next action and date';end if;
 result:=crm_private.sales_call_action_legacy(p);
 update public.sales_calls set disposition=disp where call_id=claim.call_id;
 nextstage:=coalesce(nullif(p->>'stage',''),case p->>'outcome' when 'Meeting booked' then 'Meeting Booked' when 'Qualified' then 'Qualified' else oldlead.stage end);
 if nextstage='Lost' and trim(coalesce(p->>'loss_reason',''))='' then raise exception 'Add loss reason';end if;
 update public.leads set stage=nextstage,stage_entered_at=case when nextstage<>stage then now() else stage_entered_at end,closed_at=case when nextstage=stage then closed_at when nextstage in ('Won','Lost') then now() else null end,loss_reason=case when nextstage='Lost' then coalesce(p->>'loss_reason',loss_reason) else '' end,next_action=case when p ? 'next_action' then coalesce(p->>'next_action','') else next_action end,next_follow_up=case when p ? 'next_follow_up' then nullif(p->>'next_follow_up','')::date else next_follow_up end,version=version+1,updated_at=now() where id=oldlead.id returning * into l;
 insert into public.activities(lead_id,actor_email,actor_name,action,details,snapshot) values(l.id,actor.email,actor.display_name,'Call workflow completed',disp,jsonb_build_object('before',to_jsonb(oldlead),'after',to_jsonb(l),'call_id',claim.call_id));
 return jsonb_build_object('ok',true,'lead',to_jsonb(l));
 end if;
 return crm_private.sales_call_action_legacy(p);
end $$;
revoke all on function public.sales_call_action(jsonb) from public,anon;grant execute on function public.sales_call_action(jsonb) to authenticated;
create function crm_private.import_verified_gmail(actor_email text,p jsonb) returns integer language plpgsql security definer set search_path='' as $$
declare actor public.team_members; item jsonb; lead public.leads; total integer:=0; added integer;
begin
 select * into actor from public.team_members where email=actor_email and active; if actor.email is null then raise exception 'ACCESS: Active team account required'; end if;
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
revoke all on function public.import_gmail(jsonb) from public,anon,authenticated;
revoke all on function crm_private.import_verified_gmail(text,jsonb) from public,anon,authenticated;
create table crm_private.sync_leases(id uuid primary key default gen_random_uuid(),actor text not null references public.team_members(email),lead_id uuid not null references public.leads(id),started_at timestamptz not null default now(),finished_at timestamptz,status text not null default 'running' check(status in ('running','complete','failed')));
create index sync_leases_lead on crm_private.sync_leases(lead_id,started_at desc);create index sync_leases_actor on crm_private.sync_leases(actor,started_at desc);
alter table crm_private.sync_leases enable row level security;revoke all on crm_private.sync_leases from public,anon,authenticated;
create function public.crm_server_action(token text,actor_email text,operation text,p jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor public.team_members; lease uuid;
begin
 if token is null or not exists(select 1 from crm_private.quo_state where id and token_hash=encode(sha256(convert_to(token,'UTF8')),'hex')) then raise exception 'ACCESS: Server credential required';end if;
 select * into actor from public.team_members where email=actor_email and active;
 if actor.email is null then raise exception 'ACCESS: Active member required';end if;
 if operation='gmail' then return to_jsonb(crm_private.import_verified_gmail(actor.email,p));
 elsif operation='share_number' then
 if actor.role<>'Admin' then raise exception 'ACCESS: Admin required';end if;
 insert into public.shared_quo_numbers(id,enabled) values(p->>'id',(p->>'enabled')::boolean) on conflict(id) do update set enabled=excluded.enabled;
 insert into public.admin_audit(actor_email,action,details) values(actor.email,'Shared Quo number permission',p);return '{}';
 elsif operation='sync_start' then
 perform pg_advisory_xact_lock(810124);
 if not exists(select 1 from public.leads where id=(p->>'lead_id')::uuid and archived_at is null) then raise exception 'Lead unavailable';end if;
 delete from crm_private.sync_leases where started_at<now()-interval '2 days';
 if exists(select 1 from crm_private.sync_leases where lead_id=(p->>'lead_id')::uuid and ((status='running' and started_at>now()-interval '6 minutes') or (status='complete' and finished_at>now()-interval '5 minutes'))) then raise exception 'RATE: This lead is syncing or was refreshed in the last 5 minutes';end if;
 if (select count(*) from crm_private.sync_leases where sync_leases.actor=actor.email and started_at>now()-interval '1 hour')>=20 then raise exception 'RATE: 20 sync attempts per hour. Try later';end if;
 insert into crm_private.sync_leases(actor,lead_id) values(actor.email,(p->>'lead_id')::uuid) returning id into lease;return jsonb_build_object('id',lease);
 elsif operation='sync_finish' then
 update crm_private.sync_leases set status=case when (p->>'success')::boolean then 'complete' else 'failed' end,finished_at=now() where id=(p->>'id')::uuid and sync_leases.actor=actor.email and status='running';return '{}';
 end if;raise exception 'Unknown server operation';
end $$;
revoke all on function public.crm_server_action(text,text,text,jsonb) from public,anon,authenticated;grant execute on function public.crm_server_action(text,text,text,jsonb) to anon;
create function public.crm_day_bounds(day_from date,day_to date) returns jsonb language sql stable security invoker set search_path='' as $$ select jsonb_build_object('from',day_from::timestamp at time zone time_zone,'to',(day_to+1)::timestamp at time zone time_zone,'timeZone',time_zone) from public.crm_settings where id $$;
revoke all on function public.crm_day_bounds(date,date) from public,anon;grant execute on function public.crm_day_bounds(date,date) to authenticated;
alter function public.sales_advisor_run(jsonb) set schema crm_private;
alter function crm_private.sales_advisor_run(jsonb) rename to sales_advisor_run_legacy;
revoke all on function crm_private.sales_advisor_run_legacy(jsonb) from public,anon,authenticated;
create function public.sales_advisor_run(p jsonb) returns uuid language plpgsql security definer set search_path='' as $$ begin if not public.crm_capability('ai') then raise exception 'ACCESS: AI analysis permission required';end if;return crm_private.sales_advisor_run_legacy(p);end $$;
revoke all on function public.sales_advisor_run(jsonb) from public,anon;grant execute on function public.sales_advisor_run(jsonb) to authenticated;
create or replace function public.crm_lead_zone(country text,explicit_zone text) returns text language sql immutable security invoker set search_path='' as $$
 with normalized as(select trim(regexp_replace(upper(coalesce(country,'')),'[^A-Z]+',' ','g')) n), state as(select n,regexp_replace(n,'^(UNITED STATES OF AMERICA|UNITED STATES|U S A|U S|USA|US) ','') s from normalized)
 select case when explicit_zone in ('America/New_York','America/Chicago','America/Denver','America/Los_Angeles','America/Phoenix','America/Anchorage','Pacific/Honolulu') then explicit_zone when n=s then '' else case s when 'CT' then 'America/New_York'
when 'CONNECTICUT' then 'America/New_York'
when 'DE' then 'America/New_York'
when 'DELAWARE' then 'America/New_York'
when 'GA' then 'America/New_York'
when 'GEORGIA' then 'America/New_York'
when 'MA' then 'America/New_York'
when 'MASSACHUSETTS' then 'America/New_York'
when 'MD' then 'America/New_York'
when 'MARYLAND' then 'America/New_York'
when 'ME' then 'America/New_York'
when 'MAINE' then 'America/New_York'
when 'NH' then 'America/New_York'
when 'NEW HAMPSHIRE' then 'America/New_York'
when 'NJ' then 'America/New_York'
when 'NEW JERSEY' then 'America/New_York'
when 'NY' then 'America/New_York'
when 'NEW YORK' then 'America/New_York'
when 'NC' then 'America/New_York'
when 'NORTH CAROLINA' then 'America/New_York'
when 'OH' then 'America/New_York'
when 'OHIO' then 'America/New_York'
when 'PA' then 'America/New_York'
when 'PENNSYLVANIA' then 'America/New_York'
when 'RI' then 'America/New_York'
when 'RHODE ISLAND' then 'America/New_York'
when 'SC' then 'America/New_York'
when 'SOUTH CAROLINA' then 'America/New_York'
when 'VA' then 'America/New_York'
when 'VIRGINIA' then 'America/New_York'
when 'VT' then 'America/New_York'
when 'VERMONT' then 'America/New_York'
when 'WV' then 'America/New_York'
when 'WEST VIRGINIA' then 'America/New_York'
when 'DC' then 'America/New_York'
when 'DISTRICT OF COLUMBIA' then 'America/New_York'
when 'AL' then 'America/Chicago'
when 'ALABAMA' then 'America/Chicago'
when 'AR' then 'America/Chicago'
when 'ARKANSAS' then 'America/Chicago'
when 'IA' then 'America/Chicago'
when 'IOWA' then 'America/Chicago'
when 'IL' then 'America/Chicago'
when 'ILLINOIS' then 'America/Chicago'
when 'LA' then 'America/Chicago'
when 'LOUISIANA' then 'America/Chicago'
when 'MN' then 'America/Chicago'
when 'MINNESOTA' then 'America/Chicago'
when 'MO' then 'America/Chicago'
when 'MISSOURI' then 'America/Chicago'
when 'MS' then 'America/Chicago'
when 'MISSISSIPPI' then 'America/Chicago'
when 'OK' then 'America/Chicago'
when 'OKLAHOMA' then 'America/Chicago'
when 'WI' then 'America/Chicago'
when 'WISCONSIN' then 'America/Chicago'
when 'CO' then 'America/Denver'
when 'COLORADO' then 'America/Denver'
when 'MT' then 'America/Denver'
when 'MONTANA' then 'America/Denver'
when 'NM' then 'America/Denver'
when 'NEW MEXICO' then 'America/Denver'
when 'UT' then 'America/Denver'
when 'UTAH' then 'America/Denver'
when 'WY' then 'America/Denver'
when 'WYOMING' then 'America/Denver'
when 'CA' then 'America/Los_Angeles'
when 'CALIFORNIA' then 'America/Los_Angeles'
when 'WA' then 'America/Los_Angeles'
when 'WASHINGTON' then 'America/Los_Angeles'
when 'HI' then 'Pacific/Honolulu'
when 'HAWAII' then 'Pacific/Honolulu' else '' end end from state $$;
commit;
