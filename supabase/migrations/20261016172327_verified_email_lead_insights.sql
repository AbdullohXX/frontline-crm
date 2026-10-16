begin;
create table public.verified_sent_emails(sender text not null references public.team_members(email),message_id text not null,lead_id uuid not null references public.leads(id),recipient text not null,subject text not null default '',sent_at timestamptz not null,verified_at timestamptz not null default now(),primary key(sender,message_id,lead_id));
create index verified_email_lead_sent on public.verified_sent_emails(lead_id,sent_at desc);
alter table public.verified_sent_emails enable row level security;
revoke all on public.verified_sent_emails from public,anon,authenticated;grant select on public.verified_sent_emails to authenticated;
create policy verified_email_read on public.verified_sent_emails for select to authenticated using(exists(select 1 from public.leads l where l.id=lead_id and public.can_view(l.owner_email)));
create or replace function crm_private.import_verified_gmail(actor_email text,p jsonb) returns integer language plpgsql security definer set search_path='' as $$
declare actor public.team_members;item jsonb;l public.leads;total integer:=0;added integer;recipient text;
begin
select * into actor from public.team_members where email=actor_email and active;if actor.email is null then raise exception 'ACCESS: Active account required';end if;
if jsonb_typeof(p)<>'array' or jsonb_array_length(p)>100 then raise exception 'Invalid batch';end if;
for item in select value from jsonb_array_elements(p) loop
 if nullif(item->>'id','') is null or length(item->>'id')>200 or jsonb_typeof(item->'recipients')<>'array' or (item->>'sent_at')::timestamptz>now()+interval '5 minutes' or nullif(item->>'sent_at','') is null then raise exception 'Invalid verified email';end if;
 for l in select * from public.leads leads where archived_at is null and (lower(leads.email) in(select lower(value) from jsonb_array_elements_text(item->'recipients')) or exists(select 1 from public.lead_contacts c where c.lead_id=leads.id and c.archived_at is null and c.email<>'' and lower(c.email) in(select lower(value) from jsonb_array_elements_text(item->'recipients')))) loop
 select min(lower(value)) into recipient from jsonb_array_elements_text(item->'recipients') where lower(value)=lower(l.email) or exists(select 1 from public.lead_contacts c where c.lead_id=l.id and c.archived_at is null and c.email<>'' and lower(c.email)=lower(value));
 insert into public.verified_sent_emails(sender,message_id,lead_id,recipient,subject,sent_at) values(actor.email,item->>'id',l.id,recipient,left(coalesce(item->>'subject',''),300),(item->>'sent_at')::timestamptz) on conflict do nothing;
 get diagnostics added=row_count;total:=total+added;
 insert into public.gmail_imports values(actor.email,item->>'id',l.id) on conflict do nothing;get diagnostics added=row_count;
 if added=1 then insert into public.activities(lead_id,actor_email,actor_name,action,details,outcome,created_at,snapshot) values(l.id,actor.email,actor.display_name,'Email','Verified Gmail sent email: '||left(coalesce(item->>'subject','(No subject)'),300),'Sent',(item->>'sent_at')::timestamptz,jsonb_build_object('source','gmail_verified','message_id',item->>'id','recipient',recipient));end if;
 end loop;
end loop;return total;
end $$;
revoke all on function crm_private.import_verified_gmail(text,jsonb) from public,anon,authenticated;
commit;