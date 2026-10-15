begin;
create table public.lead_contacts (
 id uuid primary key default gen_random_uuid(),
 lead_id uuid not null references public.leads(id),
 name text not null check(length(trim(name)) between 1 and 200),
 label text not null default '' check(length(label)<=100),
 email text not null default '' check(length(email)<=200),
 phone text not null default '' check(phone='' or phone ~ '^\+[1-9][0-9]{6,14}$'),
 created_by text not null references public.team_members(email),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 archived_at timestamptz, version integer not null default 1 check(version>0)
);
create index lead_contacts_lead on public.lead_contacts(lead_id,created_at,id);
create index lead_contacts_creator on public.lead_contacts(created_by);
create index lead_contacts_phone on public.lead_contacts(phone) where archived_at is null and phone<>'';
alter table public.lead_contacts enable row level security;
revoke all on public.lead_contacts from public,anon,authenticated;
grant select on public.lead_contacts to authenticated;
create policy lead_contacts_read on public.lead_contacts for select to authenticated using (
 exists(select 1 from public.leads l where l.id=lead_id and public.can_view(l.owner_email))
);
create function public.save_lead_contact(p jsonb) returns public.lead_contacts
language plpgsql security definer set search_path='' as $$
declare actor public.team_members; l public.leads; old public.lead_contacts; saved public.lead_contacts; op text:=coalesce(p->>'action','save');
begin
 actor:=public.current_member();
 if actor.email is null then raise exception 'ACCESS: Active team membership required';end if;
 select * into l from public.leads where id=(p->>'lead_id')::uuid for update;
 if l.id is null or not public.can_view(l.owner_email) or l.archived_at is not null then raise exception 'ACCESS: Active lead required';end if;
 if nullif(p->>'id','') is not null then
  select * into old from public.lead_contacts where id=(p->>'id')::uuid and lead_id=l.id for update;
  if old.id is null then raise exception 'Contact not available';end if;
  if old.version is distinct from (p->>'version')::integer then raise exception 'Contact changed. Refresh before saving';end if;
 end if;
 if op not in ('save','archive','restore') then raise exception 'Invalid contact action';end if;
 if op in ('archive','restore') then
  if old.id is null then raise exception 'Choose an existing contact';end if;
  update public.lead_contacts set archived_at=case when op='archive' then now() else null end,updated_at=now(),version=version+1 where id=old.id returning * into saved;
 else
  if length(trim(coalesce(p->>'name',''))) not between 1 and 200 or length(coalesce(p->>'label',''))>100 or length(coalesce(p->>'email',''))>200 then raise exception 'Invalid contact details';end if;
  if coalesce(p->>'email','')<>'' and not (p->>'email' ~ '^[^\s@]+@[^\s@]+\.[^\s@]+$') then raise exception 'Invalid email';end if;
  if old.id is null then
   if (select count(*) from public.lead_contacts where lead_id=l.id)>=50 then raise exception 'Maximum 50 additional contacts per lead';end if;
   insert into public.lead_contacts(lead_id,name,label,email,phone,created_by) values(l.id,trim(p->>'name'),coalesce(p->>'label',''),coalesce(p->>'email',''),coalesce(p->>'phone',''),actor.email) returning * into saved;
  else
   if old.archived_at is not null then raise exception 'Restore this contact before editing';end if;
   update public.lead_contacts set name=trim(p->>'name'),label=coalesce(p->>'label',''),email=coalesce(p->>'email',''),phone=coalesce(p->>'phone',''),updated_at=now(),version=version+1 where id=old.id returning * into saved;
  end if;
 end if;
 insert into public.activities(lead_id,actor_email,actor_name,action,details,snapshot)
 values(l.id,actor.email,actor.display_name,'Contact '||case when op='archive' then 'archived' when op='restore' then 'restored' when old.id is null then 'added' else 'updated' end,saved.name,jsonb_build_object('before',to_jsonb(old),'after',to_jsonb(saved)));
 return saved;
end $$;
revoke all on function public.save_lead_contact(jsonb) from public,anon;
grant execute on function public.save_lead_contact(jsonb) to authenticated;

-- A secondary number can resolve an incoming call, but ambiguous numbers never
-- choose a lead. Only webhook ingestion can use this private matching helper.
create function crm_private.quo_match_phone(p_phone text) returns uuid language sql stable set search_path='' as $$
 with matches as (
  select l.id from public.leads l where l.archived_at is null and crm_private.quo_phone(l.phone,l.country)=p_phone and p_phone<>''
  union
  select l.id from public.lead_contacts c join public.leads l on l.id=c.lead_id where l.archived_at is null and c.archived_at is null and regexp_replace(c.phone,'\D','','g')=p_phone and p_phone<>''
 ) select case when count(*)=1 then (array_agg(id))[1] end from matches
$$;
revoke all on function crm_private.quo_match_phone(text) from public,anon,authenticated;
do $migration$
declare source text; previous text := $old$select count(*) into hits from public.leads l where archived_at is null and crm_private.quo_phone(l.phone,l.country)=item->>'phone';
   if hits=1 then select l.id into target from public.leads l where archived_at is null and crm_private.quo_phone(l.phone,l.country)=item->>'phone';end if;$old$;
begin
 source:=pg_get_functiondef('crm_private.quo_ingest(text,text,jsonb)'::regprocedure);
 source:=replace(source,E'\r\n',E'\n');
 previous:=replace(previous,E'\r\n',E'\n');
 if position(previous in source)=0 then raise exception 'Review current Quo matching function before applying contact matching';end if;
 execute replace(source,previous,$new$target:=crm_private.quo_match_phone(item->>'phone');$new$);
end $migration$;
commit;
