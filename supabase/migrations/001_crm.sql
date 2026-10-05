-- Run once in a NEW Supabase project. Uses verified Google identities and an explicit allowlist.
begin;
create table public.crm_settings(id boolean primary key default true check(id), domain text not null default 'frontline-x.com', time_zone text not null default 'America/New_York');
insert into public.crm_settings(id) values(true);
create table public.team_members(email text primary key check(email=lower(email) and email like '%@frontline-x.com'),display_name text not null check(length(display_name) between 1 and 80),role text not null check(role in ('Admin','Agent')),active boolean not null default true,aliases text[] not null default '{}');
create table public.leads(
 id uuid primary key default gen_random_uuid(), legacy_id text, import_key text unique,
 company text not null check(length(trim(company)) between 1 and 200),contact text not null default '',job_title text not null default '',email text not null default '',phone text not null default '',country text not null default '',industry text not null default '',source text not null default '',
 score numeric check(score between 0 and 100),stage text not null default 'New' check(stage in ('New','Contacted','Qualified','Meeting Booked','Proposal','Negotiation','Nurture','Won','Lost')),status text not null default 'Active' check(status in ('Active','Inactive')),
 value numeric not null default 0 check(value between 0 and 1000000000000),priority text not null default 'Medium' check(priority in ('High','Medium','Low')),notes text not null default '',owner_email text not null references public.team_members(email),
 created_by text,created_at timestamptz not null default now(),original_created_date date,updated_at timestamptz not null default now(),
 next_action text not null default '',next_follow_up date,stage_entered_at timestamptz,closed_at timestamptz,loss_reason text not null default '',last_activity_at timestamptz,version integer not null default 1,
 legacy_stage text not null default '',legacy_owner text not null default '',
 check(stage <> 'Lost' or length(trim(loss_reason))>0),check(next_action='' or next_follow_up is not null)
);
create index leads_owner_follow_up on public.leads(owner_email,next_follow_up);
create index leads_stage on public.leads(stage);
create index leads_updated on public.leads(updated_at desc,id);
create table public.activities(
 id uuid primary key default gen_random_uuid(),lead_id uuid not null references public.leads(id),actor_email text not null,actor_name text not null,action text not null,details text not null default '',outcome text not null default '',from_stage text not null default '',to_stage text not null default '',deal_value numeric not null default 0,next_action text not null default '',next_follow_up date,created_at timestamptz not null default now(),snapshot jsonb
);
create index activities_lead_time on public.activities(lead_id,created_at desc);
create index activities_time on public.activities(created_at desc);
create table public.admin_audit(id uuid primary key default gen_random_uuid(),actor_email text not null,action text not null,details jsonb not null,created_at timestamptz not null default now());

-- Do not rely on user-editable profile metadata or a client-supplied domain.
create function public.current_member() returns public.team_members language sql stable security definer set search_path='' as $$
 select m from public.team_members m join auth.users u on u.id=auth.uid()
 where m.email=lower(u.email) and m.active and u.email_confirmed_at is not null
 and u.raw_app_meta_data->>'provider'='google' and split_part(lower(u.email),'@',2)='frontline-x.com'
$$;
create function public.is_admin() returns boolean language sql stable security definer set search_path='' as $$ select coalesce((public.current_member()).role='Admin',false) $$;
create function public.can_view(p_owner text) returns boolean language sql stable security definer set search_path='' as $$ select coalesce((public.current_member()).role='Admin' or (public.current_member()).email=p_owner,false) $$;

alter table public.crm_settings enable row level security;
alter table public.team_members enable row level security;
alter table public.leads enable row level security;
alter table public.activities enable row level security;
alter table public.admin_audit enable row level security;
create policy settings_read on public.crm_settings for select to authenticated using((public.current_member()).email is not null);
create policy team_read on public.team_members for select to authenticated using((public.current_member()).email is not null and (active or public.is_admin()));
create policy leads_read on public.leads for select to authenticated using(public.can_view(owner_email));
create policy activities_read on public.activities for select to authenticated using(exists(select 1 from public.leads l where l.id=lead_id and public.can_view(l.owner_email)));
create policy admin_audit_read on public.admin_audit for select to authenticated using(public.is_admin());
revoke all on public.crm_settings,public.team_members,public.leads,public.activities,public.admin_audit from anon,authenticated;
grant select on public.crm_settings,public.team_members,public.leads,public.activities,public.admin_audit to authenticated;

-- All writes go through these RPCs. A failed audit insert rolls back the lead write.
create function public.save_lead(p jsonb) returns public.leads language plpgsql security definer set search_path='' as $$
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
  insert into public.leads(company,contact,job_title,email,phone,country,industry,source,score,stage,status,value,priority,notes,owner_email,created_by,next_action,next_follow_up,stage_entered_at,closed_at,loss_reason)
  values(trim(p->>'company'),coalesce(p->>'contact',''),coalesce(p->>'job_title',''),coalesce(p->>'email',''),coalesce(p->>'phone',''),coalesce(p->>'country',''),coalesce(p->>'industry',''),coalesce(p->>'source',''),nullif(p->>'score','')::numeric,newstage,coalesce(p->>'status','Active'),coalesce((p->>'value')::numeric,0),coalesce(p->>'priority','Medium'),coalesce(p->>'notes',''),owner,actor.email,coalesce(p->>'next_action',''),nullif(p->>'next_follow_up','')::date,now(),case when newstage in ('Won','Lost') then now() end,coalesce(p->>'loss_reason','')) returning * into saved;
 else
  update public.leads set company=trim(p->>'company'),contact=coalesce(p->>'contact',''),job_title=coalesce(p->>'job_title',''),email=coalesce(p->>'email',''),phone=coalesce(p->>'phone',''),country=coalesce(p->>'country',''),industry=coalesce(p->>'industry',''),source=coalesce(p->>'source',''),score=nullif(p->>'score','')::numeric,stage=newstage,status=coalesce(p->>'status','Active'),value=coalesce((p->>'value')::numeric,0),priority=coalesce(p->>'priority','Medium'),notes=coalesce(p->>'notes',''),owner_email=owner,next_action=coalesce(p->>'next_action',''),next_follow_up=nullif(p->>'next_follow_up','')::date,loss_reason=case when newstage='Lost' then coalesce(p->>'loss_reason','') else '' end,
  stage_entered_at=case when newstage<>old.stage then now() else old.stage_entered_at end,closed_at=case when newstage=old.stage then old.closed_at when newstage in ('Won','Lost') then now() else null end,version=old.version+1,updated_at=now() where id=target returning * into saved;
 end if;
 insert into public.activities(lead_id,actor_email,actor_name,action,details,from_stage,to_stage,deal_value,snapshot)
 values(saved.id,actor.email,actor.display_name,case when old.id is null then 'Created' when old.stage<>saved.stage then 'Stage Changed' else 'Updated' end,case when duplicate_reason<>'' then 'Admin duplicate override: '||left(duplicate_reason,300) else 'Lead saved' end,coalesce(old.stage,''),saved.stage,saved.value,jsonb_build_object('before',to_jsonb(old),'after',to_jsonb(saved)));
 return saved;
end $$;

create function public.record_activity(p jsonb) returns public.leads language plpgsql security definer set search_path='' as $$
declare actor public.team_members; old public.leads; saved public.leads; nextdate date; nextaction text; completing boolean;
begin
 actor:=public.current_member();if actor.email is null then raise exception 'ACCESS: Active company account required';end if;
 select * into old from public.leads where id=(p->>'id')::uuid for update;
 if old.id is null or not public.can_view(old.owner_email) then raise exception 'ACCESS: Lead not available';end if;
 if old.version<>coalesce((p->>'version')::integer,0) then raise exception 'CONFLICT: Lead changed. Refresh before saving; keep your draft.';end if;
 if p->>'type' not in ('Call','Email','Meeting','Note') or p->>'outcome' not in ('Connected','No answer','Voicemail','Sent','Completed','Rescheduled','Not interested','Other') or nullif(trim(p->>'details'),'') is null or length(p->>'details')>4000 then raise exception 'Invalid activity';end if;
 nextaction:=trim(coalesce(p->>'next_action',''));nextdate:=nullif(p->>'next_follow_up','')::date;completing:=coalesce((p->>'complete')::boolean,false);
 if length(nextaction)>300 or (nextaction='')<>(nextdate is null) then raise exception 'Provide both next action and date or neither';end if;
 if completing and old.next_follow_up is null then raise exception 'No scheduled follow-up to complete';end if;
 update public.leads set next_action=case when nextdate is not null then nextaction when completing then '' else old.next_action end,next_follow_up=case when nextdate is not null then nextdate when completing then null else old.next_follow_up end,last_activity_at=now(),updated_at=now(),version=old.version+1 where id=old.id returning * into saved;
 insert into public.activities(lead_id,actor_email,actor_name,action,details,outcome,deal_value,next_action,next_follow_up,snapshot)
 values(old.id,actor.email,actor.display_name,p->>'type',p->>'details',p->>'outcome',old.value,nextaction,nextdate,jsonb_build_object('completed_follow_up',completing,'previous_date',old.next_follow_up));return saved;
end $$;

create function public.save_member(p jsonb) returns void language plpgsql security definer set search_path='' as $$
declare actor public.team_members; target text;
begin
 actor:=public.current_member();if actor.role is distinct from 'Admin' then raise exception 'ACCESS: Admin required';end if;
 perform pg_advisory_xact_lock(710104);target:=lower(p->>'email');
 if split_part(target,'@',2)<>'frontline-x.com' or target !~ '^[^\s@]+@frontline-x\.com$' then raise exception 'Use company email';end if;
 if target=actor.email and (p->>'role'<>'Admin' or not (p->>'active')::boolean) then raise exception 'You cannot disable or demote your own admin account';end if;
 insert into public.team_members(email,display_name,role,active,aliases) values(target,trim(p->>'display_name'),p->>'role',(p->>'active')::boolean,array(select lower(jsonb_array_elements_text(coalesce(p->'aliases','[]'::jsonb)))))
 on conflict(email) do update set display_name=excluded.display_name,role=excluded.role,active=excluded.active,aliases=excluded.aliases;
 insert into public.admin_audit(actor_email,action,details) values(actor.email,'Team member saved',p);
end $$;

create function public.import_leads(p_rows jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor public.team_members; item jsonb; saved public.leads; imported integer:=0; skipped integer:=0;
begin
 actor:=public.current_member();if actor.role is distinct from 'Admin' then raise exception 'ACCESS: Admin required';end if;
 if jsonb_typeof(p_rows)<>'array' or jsonb_array_length(p_rows)>5000 then raise exception 'Import must contain at most 5000 rows';end if;
 perform pg_advisory_xact_lock(710103);
 for item in select value from jsonb_array_elements(p_rows) loop
  if nullif(item->>'import_key','') is null then raise exception 'Import source key missing';end if;
  if exists(select 1 from public.leads where import_key=item->>'import_key') then skipped:=skipped+1;continue;end if;
  -- Known historical duplicates are kept, with an explicit migration audit reason.
  saved:=public.save_lead((item-'id'-'version')||jsonb_build_object('duplicate_reason','Imported historical CRM row'));
  update public.leads set legacy_id=item->>'legacy_id',import_key=item->>'import_key',legacy_stage=coalesce(item->>'legacy_stage',''),legacy_owner=coalesce(item->>'legacy_owner',''),original_created_date=nullif(item->>'original_created_date','')::date,created_by=nullif(item->>'original_creator',''),stage_entered_at=null,closed_at=null where id=saved.id;
  update public.activities set action='Imported',details='Imported historical lead. Historical stage/close times unknown.',from_stage='',to_stage='',snapshot=jsonb_build_object('source',item->>'import_key') where lead_id=saved.id;
  imported:=imported+1;
 end loop;
 insert into public.admin_audit(actor_email,action,details) values(actor.email,'CSV import',jsonb_build_object('imported',imported,'skipped',skipped));
 return jsonb_build_object('imported',imported,'skipped',skipped);
end $$;
revoke execute on function public.current_member(),public.is_admin(),public.can_view(text),public.save_lead(jsonb),public.record_activity(jsonb),public.save_member(jsonb),public.import_leads(jsonb) from public,anon;
grant execute on function public.current_member(),public.is_admin(),public.can_view(text),public.save_lead(jsonb),public.record_activity(jsonb),public.save_member(jsonb),public.import_leads(jsonb) to authenticated;
commit;
