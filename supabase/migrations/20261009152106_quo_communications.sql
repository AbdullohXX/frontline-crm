begin;
create table crm_private.quo_state(id boolean primary key default true check(id), token_hash text not null, last_sync_at timestamptz);
alter table crm_private.quo_state enable row level security;
revoke all on crm_private.quo_state from public,anon,authenticated;
create table crm_private.quo_deliveries(id text primary key, received_at timestamptz not null default now());
alter table crm_private.quo_deliveries enable row level security;
revoke all on crm_private.quo_deliveries from public,anon,authenticated;
create table public.quo_users(id text primary key, name text not null, email text not null, member_email text references public.team_members(email));
alter table public.quo_users enable row level security;
revoke all on public.quo_users from public,anon,authenticated;
grant select on public.quo_users to authenticated;
create policy quo_users_read on public.quo_users for select to authenticated using((select (public.current_member()).email) is not null);
create table public.quo_events(
 id text primary key, kind text not null check(kind in ('call','message')), lead_id uuid references public.leads(id),
 activity_id uuid unique references public.activities(id), phone text not null default '', phone_number_id text not null default '',
 user_id text not null default '', direction text not null default '', status text not null default '',
 connected boolean not null default false, duration integer not null default 0 check(duration>=0),
 content text not null default '', occurred_at timestamptz not null, source_updated_at timestamptz not null,
 payload jsonb not null default '{}', updated_at timestamptz not null default now()
);
create index quo_events_lead_date on public.quo_events(lead_id,occurred_at desc);
create index quo_events_date on public.quo_events(occurred_at desc);
alter table public.quo_events enable row level security;
revoke all on public.quo_events from public,anon,authenticated;
grant select on public.quo_events to authenticated;
create policy quo_events_read on public.quo_events for select to authenticated using(
 (select (public.current_member()).email) is not null and (public.is_admin() or exists(select 1 from public.leads l where l.id=lead_id and public.can_view(l.owner_email)))
);
create table crm_private.quo_sms_requests(id uuid primary key, actor text not null, fingerprint text not null, status text not null default 'reserved', provider_id text, created_at timestamptz not null default now());
alter table crm_private.quo_sms_requests enable row level security;
revoke all on crm_private.quo_sms_requests from public,anon,authenticated;
create table crm_private.quo_contact_queue(lead_id uuid primary key references public.leads(id),version integer not null,lease uuid,lease_until timestamptz, retry_at timestamptz not null default now());
alter table crm_private.quo_contact_queue enable row level security;
revoke all on crm_private.quo_contact_queue from public,anon,authenticated;
insert into crm_private.quo_contact_queue(lead_id,version) select id,version from public.leads where archived_at is null and phone<>'';
create function crm_private.quo_queue_contact() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.archived_at is null and new.phone<>'' then
  insert into crm_private.quo_contact_queue(lead_id,version) values(new.id,new.version) on conflict(lead_id) do update set version=excluded.version,retry_at=now();
 end if;return new;
end $$;
revoke all on function crm_private.quo_queue_contact() from public,anon,authenticated;
create trigger quo_contact_changed after insert or update of company,contact,email,phone,job_title,country on public.leads for each row execute function crm_private.quo_queue_contact();

-- International numbers retain their country code. Ten-digit US/Canadian CRM
-- numbers get +1 only when their country is explicitly US/Canada.
create function crm_private.quo_phone(value text,country text default '') returns text language sql immutable set search_path='' as $$
 select case when length(d)=10 and lower(country) in ('us','usa','united states','united states of america','ca','canada') then '1'||d when length(d) between 7 and 15 then d else '' end
 from (select regexp_replace(coalesce(value,''),'[^0-9]','','g') d) n
$$;
revoke all on function crm_private.quo_phone(text,text) from public,anon,authenticated;

-- Only the server ingestion credential can invoke this internal writer. It
-- grants no general database access and never changes lead stage/ownership.
create function crm_private.quo_ingest(token text,operation text,payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare item jsonb; target uuid; hits integer; ev public.quo_events; old public.quo_events; actor public.team_members;
 request_row crm_private.quo_sms_requests; changed boolean; provider_user public.quo_users; inserted integer:=0; result jsonb;
begin
 if token is null or not exists(select 1 from crm_private.quo_state where id and token_hash=encode(sha256(convert_to(token,'UTF8')),'hex')) then raise exception 'ACCESS: Invalid Quo ingestion token';end if;
 if operation='reserve_sms' then
  if not exists(select 1 from public.team_members where email=payload->>'actor' and active) then raise exception 'ACCESS: Inactive sender';end if;
  insert into crm_private.quo_sms_requests(id,actor,fingerprint) values((payload->>'id')::uuid,payload->>'actor',payload->>'fingerprint') on conflict do nothing;
  get diagnostics hits=row_count;
  select * into request_row from crm_private.quo_sms_requests where id=(payload->>'id')::uuid;
  if request_row.actor<>payload->>'actor' or request_row.fingerprint<>payload->>'fingerprint' then raise exception 'SMS request mismatch';end if;
  return jsonb_build_object('reserved',hits=1,'status',request_row.status,'provider_id',request_row.provider_id);
 elsif operation='finish_sms' then
  update crm_private.quo_sms_requests set status=payload->>'status',provider_id=payload->>'provider_id' where id=(payload->>'id')::uuid;
  return '{}';
 elsif operation='users' then
  for item in select value from jsonb_array_elements(payload) loop
   insert into public.quo_users(id,name,email,member_email) values(item->>'id',item->>'name',lower(item->>'email'),(select email from public.team_members where email=lower(item->>'email') and active))
   on conflict(id) do update set name=excluded.name,email=excluded.email;
  end loop;
  return '{}';
 elsif operation='synced' then
  update crm_private.quo_state set last_sync_at=now() where id;return '{}';
 elsif operation='status' then
  return jsonb_build_object('lastSync',(select last_sync_at from crm_private.quo_state where id),'pendingContacts',(select count(*) from crm_private.quo_contact_queue));
 elsif operation='contacts' then
  with claimed as (
   select q.lead_id from crm_private.quo_contact_queue q join public.leads l on l.id=q.lead_id
   where l.archived_at is null and q.retry_at<=now() and (q.lease_until is null or q.lease_until<now()) and (coalesce(payload->>'lead','')='' or q.lead_id::text=payload->>'lead')
   order by q.retry_at limit least(25,greatest(1,coalesce((payload->>'limit')::integer,25))) for update of q skip locked
  ), leased as (update crm_private.quo_contact_queue q set lease=gen_random_uuid(),lease_until=now()+interval '5 minutes' from claimed c where q.lead_id=c.lead_id returning q.*)
  select coalesce(jsonb_agg(jsonb_build_object('lead',to_jsonb(l),'lease',q.lease,'version',q.version)),'[]') into result from leased q join public.leads l on l.id=q.lead_id;
  return result;
 elsif operation='contact_done' then
  if payload->>'ok'='true' then delete from crm_private.quo_contact_queue where lead_id=(payload->>'lead')::uuid and lease::text=payload->>'lease' and version=(payload->>'version')::integer;end if;
  update crm_private.quo_contact_queue set lease=null,lease_until=null,retry_at=now()+interval '1 hour' where lead_id=(payload->>'lead')::uuid and lease::text=payload->>'lease';return '{}';
 elsif operation<>'events' then raise exception 'Invalid Quo operation';end if;
 if jsonb_typeof(payload->'events') is distinct from 'array' or jsonb_array_length(payload->'events')>100 then raise exception 'Invalid Quo batch';end if;
 if coalesce(payload->>'delivery','')<>'' then
  insert into crm_private.quo_deliveries(id) values(payload->>'delivery') on conflict do nothing;
  get diagnostics hits=row_count;if hits=0 then return jsonb_build_object('duplicate',true);end if;
 end if;
 for item in select value from jsonb_array_elements(payload->'events') loop
  if length(item->>'id') not between 1 and 150 or item->>'kind' not in ('call','message') or length(coalesce(item->>'content',''))>20000 then raise exception 'Invalid Quo event';end if;
  perform pg_advisory_xact_lock(hashtextextended(item->>'id',730901));
  select * into old from public.quo_events where id=item->>'id';
  target:=old.lead_id;
  if target is null and coalesce(item->>'phone','')<>'' then
   select count(*) into hits from public.leads l where archived_at is null and crm_private.quo_phone(l.phone,l.country)=item->>'phone';
   if hits=1 then select l.id into target from public.leads l where archived_at is null and crm_private.quo_phone(l.phone,l.country)=item->>'phone';end if;
  end if;
  -- Sparse artifact webhooks merge only their own fields. Late lifecycle
  -- events cannot downgrade an already stored terminal call/message state.
  insert into public.quo_events(id,kind,lead_id,phone,phone_number_id,user_id,direction,status,connected,duration,content,occurred_at,source_updated_at,payload)
  values(item->>'id',item->>'kind',target,coalesce(item->>'phone',''),coalesce(item->>'phone_number_id',''),coalesce(item->>'user_id',''),coalesce(item->>'direction',''),coalesce(item->>'status',''),coalesce((item->>'connected')::boolean,false),coalesce((item->>'duration')::integer,0),coalesce(item->>'content',''),(item->>'occurred_at')::timestamptz,(item->>'source_updated_at')::timestamptz,coalesce(item->'payload','{}'))
  on conflict(id) do update set
   lead_id=coalesce(public.quo_events.lead_id,excluded.lead_id),
   phone=coalesce(nullif(excluded.phone,''),public.quo_events.phone),phone_number_id=coalesce(nullif(excluded.phone_number_id,''),public.quo_events.phone_number_id),
   user_id=coalesce(nullif(excluded.user_id,''),public.quo_events.user_id),direction=coalesce(nullif(excluded.direction,''),public.quo_events.direction),
   status=case when excluded.status<>'' and excluded.source_updated_at>=public.quo_events.source_updated_at then excluded.status else public.quo_events.status end,
   connected=public.quo_events.connected or excluded.connected,duration=greatest(public.quo_events.duration,excluded.duration),
   content=coalesce(nullif(excluded.content,''),public.quo_events.content),
   occurred_at=least(public.quo_events.occurred_at,excluded.occurred_at),
   source_updated_at=greatest(public.quo_events.source_updated_at,excluded.source_updated_at),
   payload=public.quo_events.payload||excluded.payload,updated_at=now()
  returning * into ev;
  changed:=old.id is null or (to_jsonb(old)-'updated_at'-'activity_id') is distinct from (to_jsonb(ev)-'updated_at'-'activity_id');
  if ev.lead_id is not null and changed then
   select * into provider_user from public.quo_users where id=ev.user_id;
   select * into actor from public.team_members where email=coalesce(item->>'actor_email',provider_user.member_email) and active and not (ev.kind='message' and ev.direction='incoming');
   if ev.activity_id is null then
    insert into public.activities(lead_id,actor_email,actor_name,action,details,outcome,created_at)
    values(ev.lead_id,coalesce(actor.email,''),case when ev.kind='message' and ev.direction='incoming' then 'Customer · Quo' else coalesce(actor.display_name,nullif(provider_user.name,''),'Quo · unmapped user') end,
     case when ev.kind='call' then 'Quo Call' else 'Quo SMS' end,
     case when ev.kind='call' then initcap(ev.direction)||' call · '||ev.duration||' seconds' else ev.content end,ev.status,ev.occurred_at) returning id into ev.activity_id;
    update public.quo_events set activity_id=ev.activity_id where id=ev.id;
   else
    update public.activities set details=case when ev.kind='call' then initcap(ev.direction)||' call · '||ev.duration||' seconds' else ev.content end,outcome=ev.status where id=ev.activity_id;
   end if;
   update public.leads set last_activity_at=greatest(coalesce(last_activity_at,ev.occurred_at),ev.occurred_at),updated_at=now(),version=version+1 where id=ev.lead_id;
  end if;
  inserted:=inserted+1;
 end loop;
 return jsonb_build_object('processed',inserted);
end $$;
revoke all on function crm_private.quo_ingest(text,text,jsonb) from public;
grant execute on function crm_private.quo_ingest(text,text,jsonb) to anon,authenticated;
create function public.quo_ingest(token text,operation text,payload jsonb) returns jsonb language sql security invoker set search_path='' as $$select crm_private.quo_ingest(token,operation,payload)$$;
revoke all on function public.quo_ingest(text,text,jsonb) from public;
grant execute on function public.quo_ingest(text,text,jsonb) to anon,authenticated;
grant usage on schema crm_private to anon;

create function crm_private.quo_manage(p jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor public.team_members; ev public.quo_events; aid uuid;
begin
 actor:=public.current_member();if actor.role is distinct from 'Admin' then raise exception 'ACCESS: Admin required';end if;
 if p->>'operation'='map_user' then
  if not exists(select 1 from public.team_members where email=p->>'email' and active) then raise exception 'Active member required';end if;
  update public.quo_users set member_email=p->>'email' where id=p->>'id';
 elsif p->>'operation'='link' then
  if not exists(select 1 from public.leads where id=(p->>'lead')::uuid and archived_at is null) then raise exception 'Lead unavailable';end if;
  select * into ev from public.quo_events where id=p->>'id' for update;
  if ev.id is null or ev.lead_id is not null then raise exception 'Event already linked or unavailable';end if;
  insert into public.activities(lead_id,actor_email,actor_name,action,details,outcome,created_at) values((p->>'lead')::uuid,'','Quo · linked by administrator',case when ev.kind='call' then 'Quo Call' else 'Quo SMS' end,case when ev.kind='call' then initcap(ev.direction)||' call · '||ev.duration||' seconds' else ev.content end,ev.status,ev.occurred_at) returning id into aid;
  update public.quo_events set lead_id=(p->>'lead')::uuid,activity_id=aid where id=ev.id;
  update public.leads set last_activity_at=greatest(coalesce(last_activity_at,ev.occurred_at),ev.occurred_at),updated_at=now(),version=version+1 where id=(p->>'lead')::uuid;
 else raise exception 'Unknown operation';end if;
 insert into public.admin_audit(actor_email,action,details) values(actor.email,'Quo integration mapping',p);
 return '{}';
end $$;
revoke all on function crm_private.quo_manage(jsonb) from public,anon;
grant execute on function crm_private.quo_manage(jsonb) to authenticated;
create function public.quo_manage(p jsonb) returns jsonb language sql security invoker set search_path='' as $$select crm_private.quo_manage(p)$$;
revoke all on function public.quo_manage(jsonb) from public,anon;
grant execute on function public.quo_manage(jsonb) to authenticated;
create function public.quo_report(start_at timestamptz,end_at timestamptz,actor_id text default '',tz text default 'America/New_York') returns jsonb language sql stable security invoker set search_path='' as $$
 with e as (select * from public.quo_events where occurred_at>=((start_at at time zone 'UTC')::date::timestamp at time zone tz) and occurred_at<((end_at at time zone 'UTC')::date::timestamp at time zone tz) and (actor_id='' or user_id=actor_id)),
 c as (select * from e where kind='call'),
 terminal as (select * from c where status not in ('queued','initiated','ringing','in-progress',''))
 select jsonb_build_object(
 'calls',(select count(*) from c),'terminal',(select count(*) from terminal),'answered',(select count(*) from terminal where connected),
 'missed',(select count(*) from terminal where direction='incoming' and not connected),
 'seconds',(select coalesce(sum(duration),0) from terminal where connected),'average',(select coalesce(avg(duration),0) from terminal where connected),
 'messages',(select count(*) from e where kind='message'),
 'daily',coalesce((select jsonb_agg(x order by label) from (select to_char(occurred_at at time zone tz,'YYYY-MM-DD') label,count(*) value from c group by 1) x),'[]'),
 'agents',coalesce((select jsonb_agg(x order by value desc) from (select coalesce(nullif(user_id,''),'Unmapped') label,count(*) value from c group by 1) x),'[]'),
 'statuses',coalesce((select jsonb_agg(x order by value desc) from (select coalesce(nullif(status,''),'Unknown') label,count(*) value from c group by 1) x),'[]'),
 'directions',coalesce((select jsonb_agg(x) from (select coalesce(nullif(direction,''),'Unknown') label,count(*) value from c group by 1) x),'[]')
 )
$$;
revoke all on function public.quo_report(timestamptz,timestamptz,text,text) from public,anon;
grant execute on function public.quo_report(timestamptz,timestamptz,text,text) to authenticated;
commit;
