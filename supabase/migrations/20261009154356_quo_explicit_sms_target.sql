begin;
alter table crm_private.quo_sms_requests add column lead_id uuid references public.leads(id);
create or replace function crm_private.quo_ingest(token text,operation text,payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare item jsonb; target uuid; hits integer; ev public.quo_events; old public.quo_events; actor public.team_members;
 request_row crm_private.quo_sms_requests; changed boolean; provider_user public.quo_users; inserted integer:=0; result jsonb;
begin
 if token is null or not exists(select 1 from crm_private.quo_state where id and token_hash=encode(sha256(convert_to(token,'UTF8')),'hex')) then raise exception 'ACCESS: Invalid Quo ingestion token';end if;
 if operation='reserve_sms' then
  if not exists(select 1 from public.team_members where email=payload->>'actor' and active) then raise exception 'ACCESS: Inactive sender';end if;
  insert into crm_private.quo_sms_requests(id,actor,fingerprint,lead_id) values((payload->>'id')::uuid,payload->>'actor',payload->>'fingerprint',(payload->>'lead_id')::uuid) on conflict do nothing;
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
  if item->>'kind'='message' and target is null then
   target:=nullif(item->>'lead_id','')::uuid;
   if target is null then select lead_id into target from crm_private.quo_sms_requests where provider_id=item->>'id' order by created_at desc limit 1;end if;
   if target is not null and not exists(select 1 from public.leads where id=target) then raise exception 'Selected SMS lead unavailable';end if;
  end if;
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

commit;
