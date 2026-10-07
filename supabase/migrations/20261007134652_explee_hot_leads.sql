begin;
create schema if not exists crm_private;
create table crm_private.explee_state (
 project_id integer primary key check(project_id=43138), token_hash text not null,
 cursor timestamptz, lease uuid, lease_until timestamptz,
 owner_email text not null references public.team_members(email), last_success_at timestamptz
);
alter table crm_private.explee_state enable row level security;
revoke all on crm_private.explee_state from public,anon,authenticated;
alter table public.leads add column company_domain text not null default '',
 add column linkedin_url text not null default '', add column why_hot text,
 add column became_hot_at timestamptz;
create table public.explee_hot_leads (
 project_id integer not null check(project_id=43138), person_id text not null,
 campaign_id integer not null, became_hot_at text not null,
 lead_id uuid not null references public.leads(id), contact jsonb not null,
 imported_at timestamptz not null default now(),
 primary key(project_id,person_id,campaign_id,became_hot_at)
);
alter table public.explee_hot_leads enable row level security;
revoke all on public.explee_hot_leads from public,anon,authenticated;
grant select on public.explee_hot_leads to authenticated;
create policy explee_read on public.explee_hot_leads for select to authenticated
 using(exists(select 1 from public.leads l where l.id=lead_id and public.can_view(l.owner_email)));
create index explee_lead_id on public.explee_hot_leads(lead_id);

create function crm_private.explee_sync(token text, operation text, payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare s crm_private.explee_state; item jsonb; target uuid; saved public.leads;
 newest timestamptz; hot timestamptz; added integer:=0; matched integer:=0; processed integer:=0;
begin
 select * into s from crm_private.explee_state where project_id=43138 for update;
 if s.project_id is null or token is null or encode(sha256(convert_to(token,'UTF8')),'hex')<>s.token_hash then
  raise exception 'ACCESS: Invalid ingestion token';
 end if;
 if operation='acquire' then
  if s.lease_until>now() then return null; end if;
  update crm_private.explee_state set lease=gen_random_uuid(),lease_until=now()+interval '6 minutes'
   where project_id=43138 returning * into s;
  return jsonb_build_object('lease',s.lease,'cursor',s.cursor);
 end if;
 if s.lease is null or s.lease::text<>coalesce(payload->>'lease','') then raise exception 'Invalid lease'; end if;
 if operation='release' then
  update crm_private.explee_state set lease=null,lease_until=null where project_id=43138;
  return '{}'::jsonb;
 end if;
 if operation<>'commit' or s.lease_until<=now() or payload->>'project_id'<>'43138'
  or jsonb_typeof(payload->'leads')<>'array' then raise exception 'Invalid sync operation'; end if;
 if not exists(select 1 from public.team_members where email=s.owner_email and active) then
  raise exception 'Sync owner must be an active team member'; end if;
 -- Share the CRM's write lock so normal edits/imports cannot race identity matching.
 perform pg_advisory_xact_lock(710103);
 newest:=s.cursor;
 for item in select value from jsonb_array_elements(payload->'leads') loop
  if coalesce(item->>'person_id','')='' or item->>'campaign_id' is null then raise exception 'Missing contact identity'; end if;
  hot:=nullif(item->>'became_hot_at','')::timestamptz;
  if hot is not null and (newest is null or hot>newest) then newest:=hot; end if;
  if exists(select 1 from public.explee_hot_leads where project_id=43138 and person_id=item->>'person_id'
   and campaign_id=(item->>'campaign_id')::integer and became_hot_at=coalesce(item->>'became_hot_at','')) then continue; end if;
  target:=null;
  select lead_id into target from public.explee_hot_leads where project_id=43138 and person_id=item->>'person_id' order by imported_at limit 1;
  if target is null then
   select id into target from public.leads where
    (coalesce(item->>'email','')<>'' and lower(trim(email))=lower(trim(item->>'email')))
    or (coalesce(item->>'linkedin_url','')<>'' and lower(rtrim(linkedin_url,'/'))=lower(rtrim(item->>'linkedin_url','/')))
    or (length(regexp_replace(coalesce(item->>'phone',''),'\D','','g'))>=7 and
     regexp_replace(phone,'\D','','g')=regexp_replace(item->>'phone','\D','','g'))
    order by created_at,id limit 1;
  end if;
  if target is null then
   insert into public.leads(company,contact,job_title,email,phone,country,source,stage,priority,notes,owner_email,created_by,
    company_domain,linkedin_url,why_hot,became_hot_at,stage_entered_at)
   values(left(coalesce(nullif(trim(item->>'company_name'),''),nullif(item->>'company_domain',''),'Explee contact'),200),
    coalesce(item->>'name',''),coalesce(item->>'job_title',''),coalesce(item->>'email',''),coalesce(item->>'phone',''),
    coalesce(item->>'country',''),'Explee','Qualified','High',coalesce(item->>'why_hot',''),s.owner_email,'Explee',
    coalesce(item->>'company_domain',''),coalesce(item->>'linkedin_url',''),item->>'why_hot',hot,coalesce(hot,now())) returning * into saved;
   target:=saved.id; added:=added+1;
  else
   -- Keep existing ownership and pipeline decisions; retain every original payload below.
   update public.leads set why_hot=case when hot is null or became_hot_at is null or hot>=became_hot_at then item->>'why_hot' else why_hot end,
    became_hot_at=greatest(became_hot_at,hot),
    company_domain=case when company_domain='' then coalesce(item->>'company_domain','') else company_domain end,
    linkedin_url=case when linkedin_url='' then coalesce(item->>'linkedin_url','') else linkedin_url end,
    version=version+1,updated_at=now() where id=target returning * into saved;
   matched:=matched+1;
  end if;
  insert into public.explee_hot_leads(project_id,person_id,campaign_id,became_hot_at,lead_id,contact)
   values(43138,item->>'person_id',(item->>'campaign_id')::integer,coalesce(item->>'became_hot_at',''),target,item);
  insert into public.activities(lead_id,actor_email,actor_name,action,details,to_stage,snapshot)
   values(target,s.owner_email,'Explee','Explee hot lead',coalesce(item->>'why_hot',''),saved.stage,item);
  processed:=processed+1;
 end loop;
 update crm_private.explee_state set cursor=newest,last_success_at=now(),lease=null,lease_until=null where project_id=43138;
 return jsonb_build_object('created',added,'matched',matched,'processed',processed,'cursor',newest);
end $$;
revoke all on function crm_private.explee_sync(text,text,jsonb) from public;
grant usage on schema crm_private to anon,authenticated;
grant execute on function crm_private.explee_sync(text,text,jsonb) to anon,authenticated;
create function public.explee_sync(token text, operation text, payload jsonb default '{}')
returns jsonb language sql security invoker set search_path='' as $$
 select crm_private.explee_sync(token,operation,payload)
$$;
revoke all on function public.explee_sync(text,text,jsonb) from public;
grant execute on function public.explee_sync(text,text,jsonb) to anon,authenticated;
commit;
