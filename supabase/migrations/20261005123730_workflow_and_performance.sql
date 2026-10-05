begin;
alter table public.leads add column time_zone text not null default '', add column work_status text not null default 'None' check(work_status in ('None','Email sent','AI voicemail','Follow-up','Not ready','Not valid')), add column archived_at timestamptz;
alter table public.crm_settings add column work_address text not null default 'Colorado Springs, 1801 South Cascade Avenue, ZIP 80905', add column team_phone text not null default '+19295773302';
create index leads_active_owner_updated on public.leads(owner_email,updated_at desc,id) where archived_at is null;
create index leads_active_work_followup on public.leads(work_status,next_follow_up) where archived_at is null;
-- Cache the verified identity lookup once per statement; preserve the existing owner/admin model.
alter policy leads_read on public.leads using ((select (public.current_member()).role)='Admin' or owner_email=(select (public.current_member()).email));
alter policy settings_read on public.crm_settings using ((select (public.current_member()).email) is not null);
alter policy team_read on public.team_members using ((select (public.current_member()).email) is not null and (active or (select public.is_admin())));
create or replace function public.save_lead(p jsonb) returns public.leads language plpgsql security definer set search_path='' as $$
declare actor public.team_members; old public.leads; saved public.leads; target uuid; owner text; newstage text; duplicate_reason text;
begin
 actor:=public.current_member();if actor.email is null then raise exception 'ACCESS: Active company account required';end if;
 -- Serializes identity checks for concurrent inserts and edits; row versions still prevent stale writes.
 perform pg_advisory_xact_lock(710103);
 target:=nullif(p->>'id','')::uuid;
 if target is not null then
  select * into old from public.leads where id=target for update;
  if old.id is null or not public.can_view(old.owner_email) then raise exception 'ACCESS: Lead not available';end if;
  if old.version<>coalesce((p->>'version')::integer,0) then raise exception 'CONFLICT: Lead changed. Refresh before saving; keep your draft.';end if;
 end if;
 if old.archived_at is not null then raise exception 'Restore this archived lead before editing';end if;
 if coalesce(p->>'time_zone','')<>'' and not exists(select 1 from pg_catalog.pg_timezone_names where name=p->>'time_zone') then raise exception 'Invalid timezone';end if;
 if coalesce(p->>'work_status','None') not in ('None','Email sent','AI voicemail','Follow-up','Not ready','Not valid') then raise exception 'Invalid work category';end if;
 owner:=lower(coalesce(nullif(p->>'owner_email',''),actor.email));
 if actor.role<>'Admin' and (owner<>actor.email or (old.id is not null and owner<>old.owner_email)) then raise exception 'ACCESS: Only admins can reassign leads';end if;
 if not exists(select 1 from public.team_members where email=owner and active) then raise exception 'Choose an active team owner';end if;
 newstage:=p->>'stage';duplicate_reason:=trim(coalesce(p->>'duplicate_reason',''));
 if length(coalesce(p->>'company',''))>200 or length(coalesce(p->>'contact',''))>200 or length(coalesce(p->>'notes',''))>10000 or length(coalesce(p->>'next_action',''))>300 or length(coalesce(p->>'loss_reason',''))>500 then raise exception 'Input too long';end if;
 if coalesce(p->>'email','')<>'' and not (p->>'email' ~ '^[^\s@]+@[^\s@]+\.[^\s@]+$') then raise exception 'Invalid contact email';end if;
 if coalesce(p->>'phone','')<>'' and (length(regexp_replace(p->>'phone','\D','','g')) not between 7 and 15) then raise exception 'Invalid phone';end if;
 if target is null or lower(trim(old.company))<>lower(trim(p->>'company')) or lower(old.email)<>lower(coalesce(p->>'email','')) or regexp_replace(old.phone,'\D','','g')<>regexp_replace(coalesce(p->>'phone',''),'\D','','g') then
  if exists(select 1 from public.leads l where (target is null or l.id<>target) and (lower(trim(l.company))=lower(trim(p->>'company')) or (coalesce(p->>'email','')<>'' and lower(l.email)=lower(p->>'email')) or (coalesce(p->>'phone','')<>'' and regexp_replace(l.phone,'\D','','g')=regexp_replace(p->>'phone','\D','','g')))) then
   if actor.role<>'Admin' or duplicate_reason='' then raise exception 'DUPLICATE: A matching company, email or phone exists. Admin override reason required.';end if;
  end if;
 end if;
 if target is null then
  insert into public.leads(company,contact,job_title,email,phone,country,industry,source,score,stage,status,value,priority,notes,owner_email,created_by,next_action,next_follow_up,stage_entered_at,closed_at,loss_reason,time_zone,work_status)
  values(trim(p->>'company'),coalesce(p->>'contact',''),coalesce(p->>'job_title',''),coalesce(p->>'email',''),coalesce(p->>'phone',''),coalesce(p->>'country',''),coalesce(p->>'industry',''),coalesce(p->>'source',''),nullif(p->>'score','')::numeric,newstage,coalesce(p->>'status','Active'),coalesce((p->>'value')::numeric,0),coalesce(p->>'priority','Medium'),coalesce(p->>'notes',''),owner,actor.email,coalesce(p->>'next_action',''),nullif(p->>'next_follow_up','')::date,now(),case when newstage in ('Won','Lost') then now() end,coalesce(p->>'loss_reason',''),coalesce(p->>'time_zone',''),coalesce(p->>'work_status','None')) returning * into saved;
 else
  update public.leads set company=trim(p->>'company'),contact=coalesce(p->>'contact',''),job_title=coalesce(p->>'job_title',''),email=coalesce(p->>'email',''),phone=coalesce(p->>'phone',''),country=coalesce(p->>'country',''),industry=coalesce(p->>'industry',''),source=coalesce(p->>'source',''),score=nullif(p->>'score','')::numeric,stage=newstage,status=coalesce(p->>'status','Active'),value=coalesce((p->>'value')::numeric,0),priority=coalesce(p->>'priority','Medium'),notes=coalesce(p->>'notes',''),owner_email=owner,next_action=coalesce(p->>'next_action',''),next_follow_up=nullif(p->>'next_follow_up','')::date,loss_reason=case when newstage='Lost' then coalesce(p->>'loss_reason','') else '' end,
  time_zone=coalesce(p->>'time_zone',old.time_zone),work_status=coalesce(p->>'work_status',old.work_status),stage_entered_at=case when newstage<>old.stage then now() else old.stage_entered_at end,closed_at=case when newstage=old.stage then old.closed_at when newstage in ('Won','Lost') then now() else null end,version=old.version+1,updated_at=now() where id=target returning * into saved;
 end if;
 insert into public.activities(lead_id,actor_email,actor_name,action,details,from_stage,to_stage,deal_value,snapshot)
 values(saved.id,actor.email,actor.display_name,case when old.id is null then 'Created' when old.stage<>saved.stage then 'Stage Changed' else 'Updated' end,case when duplicate_reason<>'' then 'Admin duplicate override: '||left(duplicate_reason,300) else 'Lead saved' end,coalesce(old.stage,''),saved.stage,saved.value,jsonb_build_object('before',to_jsonb(old),'after',to_jsonb(saved)));
 return saved;
end $$;


create schema if not exists crm_private;
revoke all on schema crm_private from public,anon;
grant usage on schema crm_private to authenticated;
-- Only narrow version-checked writes. No unrestricted table write privileges are granted.
create function crm_private.change_leads(p jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor public.team_members; item jsonb; old public.leads; saved public.leads; result jsonb:='[]'; action text:=p->>'action'; nextstage text:=p->>'stage'; category text:=p->>'work_status'; reason text:=trim(coalesce(p->>'loss_reason',''));
begin
 actor:=public.current_member(); if actor.email is null then raise exception 'ACCESS: Active company account required'; end if;
 if action not in ('stage','work_status','archive','restore') or action is null then raise exception 'Invalid action';end if;
 if jsonb_typeof(p->'items') is distinct from 'array' or jsonb_array_length(p->'items') not between 1 and 100 then raise exception 'Select 1–100 leads';end if;
 if (select count(distinct value->>'id') from jsonb_array_elements(p->'items'))<>jsonb_array_length(p->'items') then raise exception 'Duplicate selected IDs';end if;
 if action='stage' and (nextstage is null or nextstage not in ('New','Contacted','Qualified','Meeting Booked','Proposal','Negotiation','Nurture','Won','Lost')) then raise exception 'Invalid stage';end if;
 if action='stage' and nextstage='Lost' and (reason='' or length(reason)>500) then raise exception 'Add a loss reason';end if;
 if action='work_status' and (category is null or category not in ('None','Email sent','AI voicemail','Follow-up','Not ready','Not valid')) then raise exception 'Invalid work category';end if;
 -- Consistent lock ordering prevents deadlocks between overlapping batches. All changes are atomic.
 for item in select value from jsonb_array_elements(p->'items') order by value->>'id' loop
  select * into old from public.leads where id=(item->>'id')::uuid for update;
  if old.id is null or not public.can_view(old.owner_email) then raise exception 'ACCESS: Lead not available';end if;
  if old.version<>coalesce((item->>'version')::integer,0) then raise exception 'CONFLICT: A selected lead changed. Refresh before retrying.';end if;
  if old.archived_at is not null and action not in ('restore','archive') then raise exception 'Restore archived leads before editing';end if;
  if (action='stage' and nextstage=old.stage) or (action='work_status' and category=old.work_status) or (action='archive' and old.archived_at is not null) or (action='restore' and old.archived_at is null) then result:=result||to_jsonb(old);continue;end if;
  update public.leads set
   stage=case when action='stage' then nextstage else old.stage end,
   work_status=case when action='work_status' then category else old.work_status end,
   archived_at=case when action='archive' then now() when action='restore' then null else old.archived_at end,
   stage_entered_at=case when action='stage' then now() else old.stage_entered_at end,
   closed_at=case when action='stage' then case when nextstage in ('Won','Lost') then now() end else old.closed_at end,
   loss_reason=case when action='stage' then case when nextstage='Lost' then reason else '' end else old.loss_reason end,
   updated_at=now(),version=old.version+1 where id=old.id returning * into saved;
  insert into public.activities(lead_id,actor_email,actor_name,action,details,from_stage,to_stage,deal_value,snapshot)
   values(saved.id,actor.email,actor.display_name,case action when 'stage' then 'Stage Changed' when 'work_status' then 'Work Category Changed' when 'archive' then 'Archived' else 'Restored' end,
   case action when 'work_status' then category when 'archive' then 'Lead archived; history retained' when 'restore' then 'Lead restored' else 'Pipeline stage updated' end,
   old.stage,saved.stage,saved.value,jsonb_build_object('before',to_jsonb(old),'after',to_jsonb(saved)));
  result:=result||to_jsonb(saved);
 end loop;
 return result;
end $$;
revoke all on function crm_private.change_leads(jsonb) from public,anon;
grant execute on function crm_private.change_leads(jsonb) to authenticated;
create function public.change_leads(p jsonb) returns jsonb language sql security invoker set search_path='' as $$select crm_private.change_leads(p)$$;
revoke all on function public.change_leads(jsonb) from public,anon;
grant execute on function public.change_leads(jsonb) to authenticated;

create function public.crm_lead_zone(country text,explicit_zone text) returns text language sql immutable security invoker set search_path='' as $$
select case when explicit_zone<>'' then explicit_zone else
case (regexp_match(upper(trim(country)), '^(US|USA|UNITED STATES)[[:space:]]*[-,/][[:space:]]*([A-Z]{2})$'))[2]
 when 'CT' then 'America/New_York' when 'DE' then 'America/New_York' when 'GA' then 'America/New_York' when 'MA' then 'America/New_York' when 'MD' then 'America/New_York' when 'ME' then 'America/New_York' when 'NH' then 'America/New_York' when 'NJ' then 'America/New_York' when 'NY' then 'America/New_York' when 'NC' then 'America/New_York' when 'OH' then 'America/New_York' when 'PA' then 'America/New_York' when 'RI' then 'America/New_York' when 'SC' then 'America/New_York' when 'VA' then 'America/New_York' when 'VT' then 'America/New_York' when 'WV' then 'America/New_York'
 when 'AL' then 'America/Chicago' when 'AR' then 'America/Chicago' when 'IA' then 'America/Chicago' when 'IL' then 'America/Chicago' when 'LA' then 'America/Chicago' when 'MN' then 'America/Chicago' when 'MO' then 'America/Chicago' when 'MS' then 'America/Chicago' when 'OK' then 'America/Chicago' when 'WI' then 'America/Chicago'
 when 'CO' then 'America/Denver' when 'MT' then 'America/Denver' when 'NM' then 'America/Denver' when 'UT' then 'America/Denver' when 'WY' then 'America/Denver'
 when 'CA' then 'America/Los_Angeles' when 'NV' then 'America/Los_Angeles' when 'WA' then 'America/Los_Angeles'
 when 'AZ' then 'America/Phoenix' when 'HI' then 'Pacific/Honolulu' else '' end end $$;
revoke all on function public.crm_lead_zone(text,text) from public,anon;
grant execute on function public.crm_lead_zone(text,text) to authenticated;

create function public.crm_list_leads(p jsonb) returns jsonb language sql stable security invoker set search_path='' as $$
with opts as(select coalesce((p->>'page')::int,0) page,(p->>'today')::date today,coalesce(p->>'search','') term),
rows as materialized (select l.*,public.crm_lead_zone(l.country,l.time_zone) resolved_zone from public.leads l,opts o
where (coalesce(p->>'archived','false')='true')=(l.archived_at is not null)
and (coalesce(p->>'owner','')='' or l.owner_email=p->>'owner')
and (coalesce(p->>'scope','')<>'mine' or l.owner_email=(select (public.current_member()).email))
and (coalesce(p->>'stage','')='' or l.stage=p->>'stage')
and (coalesce(p->>'work_status','')='' or l.work_status=p->>'work_status')
and (coalesce(p->>'date','')='' or case when p->>'date_field'='followup' then l.next_follow_up else coalesce(l.original_created_date,(l.created_at at time zone (select time_zone from public.crm_settings where id))::date) end=nullif(p->>'date','')::date)
and (coalesce(p->>'phone','')<>'true' or length(regexp_replace(l.phone,'\D','','g')) between 7 and 15)
and (o.term='' or l.company ilike '%'||o.term||'%' or l.contact ilike '%'||o.term||'%' or l.email ilike '%'||o.term||'%' or l.legacy_id ilike '%'||o.term||'%' or l.phone ilike '%'||o.term||'%' or (length(regexp_replace(o.term,'\D','','g'))>=3 and regexp_replace(l.phone,'\D','','g') like '%'||regexp_replace(o.term,'\D','','g')||'%'))
and (coalesce(p->>'due','')='' or (l.stage not in ('Won','Lost') and case p->>'due' when 'open' then true when 'unscheduled' then l.next_follow_up is null when 'upcoming' then l.next_follow_up>o.today when 'today' then l.next_follow_up=o.today when 'overdue' then l.next_follow_up<o.today else l.next_follow_up<=o.today end))),
filtered as(select r.* from rows r where case coalesce(p->>'tz','') when '' then true when 'unknown' then resolved_zone='' when 'calling' then resolved_zone<>'' and extract(isodow from now() at time zone nullif(resolved_zone,'')) between 1 and 5 and extract(hour from now() at time zone nullif(resolved_zone,''))>=9 and extract(hour from now() at time zone nullif(resolved_zone,''))<17 else resolved_zone=p->>'tz' end),
paged as(select f.* from filtered f order by case when coalesce(p->>'due','')<>'' then next_follow_up end asc nulls last,updated_at desc,id limit 100 offset (select page*100 from opts))
select jsonb_build_object('leads',coalesce((select jsonb_agg(to_jsonb(t)-'resolved_zone') from paged t),'[]'::jsonb),'total',(select count(*) from filtered),'page',(select page from opts)) $$;
revoke all on function public.crm_list_leads(jsonb) from public,anon;
grant execute on function public.crm_list_leads(jsonb) to authenticated;

-- SECURITY INVOKER: every aggregation uses the caller's RLS permissions.
create or replace function public.crm_report(p_from date default null,p_to date default null) returns jsonb language sql stable security invoker set search_path='' as $$
 with visible as(select * from public.leads where archived_at is null),
 settings as(select time_zone from public.crm_settings where id=true),
 events as(select a.* from public.activities a,settings s where a.action<>'Imported' and exists(select 1 from visible l where l.id=a.lead_id) and (p_from is null or (a.created_at at time zone s.time_zone)::date>=p_from) and (p_to is null or (a.created_at at time zone s.time_zone)::date<=p_to)),
 stage_counts as(select stage label,count(*) count from visible group by stage),
 source_counts as(select coalesce(nullif(source,''),'Unknown') label,count(*) count from visible group by 1),
 outcome_counts as(select coalesce(nullif(outcome,''),'Unknown') label,count(*) count from events where action='Call' group by 1),
 agent_counts as(select actor_name label,count(*) count from events where action='Call' group by actor_name),
 trend_counts as(select to_char(created_at at time zone (select time_zone from settings),'YYYY-MM') label,count(*) count from events where action='Call' group by 1),
 score_counts as(select case when score is null then 'Unknown' when score<25 then '0–24' when score<50 then '25–49' when score<75 then '50–74' else '75–100' end label,count(*) count from visible group by 1)
 select jsonb_build_object(
 'total',(select count(*) from visible),'open',(select count(*) from visible where stage not in ('Won','Lost')),
 'open_value',(select coalesce(sum(value),0) from visible where stage not in ('Won','Lost')),
 'won',(select count(*) from visible where stage='Won'),'won_value',(select coalesce(sum(value),0) from visible where stage='Won'),
 'overdue',(select count(*) from visible where stage not in ('Won','Lost') and next_follow_up<(now() at time zone (select time_zone from settings))::date),
 'unscheduled',(select count(*) from visible where stage not in ('Won','Lost') and next_follow_up is null),
 'calls',(select count(*) from events where action='Call'),'connected',(select count(*) from events where action='Call' and outcome='Connected'),
 'recorded_wins',(select count(*) from events where action in ('Created','Stage Changed') and to_stage='Won' and from_stage<>'Won'),
 'recorded_revenue',(select coalesce(sum(deal_value),0) from events where action in ('Created','Stage Changed') and to_stage='Won' and from_stage<>'Won'),
 'stages',coalesce((select jsonb_agg(to_jsonb(t) order by t.count desc) from stage_counts t),'[]'::jsonb),
 'sources',coalesce((select jsonb_agg(to_jsonb(t) order by t.count desc) from source_counts t),'[]'::jsonb),
 'outcomes',coalesce((select jsonb_agg(to_jsonb(t) order by t.count desc) from outcome_counts t),'[]'::jsonb),
 'agents',coalesce((select jsonb_agg(to_jsonb(t) order by t.count desc) from agent_counts t),'[]'::jsonb),
 'trend',coalesce((select jsonb_agg(to_jsonb(t) order by t.label) from trend_counts t),'[]'::jsonb),
 'scores',coalesce((select jsonb_agg(to_jsonb(t) order by t.label) from score_counts t),'[]'::jsonb)
 )
$$;
revoke execute on function public.crm_report(date,date) from public,anon;
grant execute on function public.crm_report(date,date) to authenticated;

create or replace function public.record_activity(p jsonb) returns public.leads language plpgsql security definer set search_path='' as $$
declare actor public.team_members; old public.leads; saved public.leads; nextdate date; nextaction text; completing boolean;
begin
 actor:=public.current_member();if actor.email is null then raise exception 'ACCESS: Active company account required';end if;
 select * into old from public.leads where id=(p->>'id')::uuid for update;
 if old.id is null or not public.can_view(old.owner_email) then raise exception 'ACCESS: Lead not available';end if;
 if old.archived_at is not null then raise exception 'Restore this archived lead before recording activity';end if;
 if old.version<>coalesce((p->>'version')::integer,0) then raise exception 'CONFLICT: Lead changed. Refresh before saving; keep your draft.';end if;
 if p->>'type' not in ('Call','Email','Meeting','Note') or p->>'outcome' not in ('Connected','No answer','Voicemail','Sent','Completed','Rescheduled','Not interested','Other') or nullif(trim(p->>'details'),'') is null or length(p->>'details')>4000 then raise exception 'Invalid activity';end if;
 nextaction:=trim(coalesce(p->>'next_action',''));nextdate:=nullif(p->>'next_follow_up','')::date;completing:=coalesce((p->>'complete')::boolean,false);
 if length(nextaction)>300 or (nextaction='')<>(nextdate is null) then raise exception 'Provide both next action and date or neither';end if;
 if completing and old.next_follow_up is null then raise exception 'No scheduled follow-up to complete';end if;
 update public.leads set next_action=case when nextdate is not null then nextaction when completing then '' else old.next_action end,next_follow_up=case when nextdate is not null then nextdate when completing then null else old.next_follow_up end,last_activity_at=now(),updated_at=now(),version=old.version+1 where id=old.id returning * into saved;
 insert into public.activities(lead_id,actor_email,actor_name,action,details,outcome,deal_value,next_action,next_follow_up,snapshot)
 values(old.id,actor.email,actor.display_name,p->>'type',p->>'details',p->>'outcome',old.value,nextaction,nextdate,jsonb_build_object('completed_follow_up',completing,'previous_date',old.next_follow_up));return saved;
end $$;
commit;
