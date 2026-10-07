begin;
create table public.lead_attachments(
 id uuid primary key default gen_random_uuid(), activity_id uuid not null references public.activities(id),
 path text not null unique, name text not null check(length(name) between 1 and 200),
 mime text not null check(mime in ('image/jpeg','image/png','image/webp','image/gif','audio/mpeg','audio/wav','audio/x-wav','audio/ogg','audio/mp4','audio/webm')),
 size bigint not null check(size>0 and size<=26214400), created_at timestamptz not null default now()
);
create index lead_attachments_activity on public.lead_attachments(activity_id);
alter table public.lead_attachments enable row level security;
revoke all on public.lead_attachments from anon,authenticated;
grant select on public.lead_attachments to authenticated;
create policy attachment_read on public.lead_attachments for select to authenticated using(exists(select 1 from public.activities a where a.id=activity_id));
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('lead-media','lead-media',false,26214400,array['image/jpeg','image/png','image/webp','image/gif','audio/mpeg','audio/wav','audio/x-wav','audio/ogg','audio/mp4','audio/webm']);
create policy lead_media_read on storage.objects for select to authenticated using(bucket_id='lead-media' and (select (public.current_member()).email) is not null and exists(select 1 from public.leads l where l.id::text=split_part(name,'/',1)));
create policy lead_media_upload on storage.objects for insert to authenticated with check(bucket_id='lead-media' and (select (public.current_member()).email) is not null and exists(select 1 from public.leads l where l.id::text=split_part(name,'/',1) and archived_at is null));
-- Failed message uploads can be removed by their uploader; posted media is immutable.
create policy lead_media_cleanup on storage.objects for delete to authenticated using(bucket_id='lead-media' and owner_id=(select auth.uid())::text and (select (public.current_member()).email) is not null and not exists(select 1 from public.lead_attachments a where a.path=storage.objects.name));
create function crm_private.post_lead_message(p jsonb) returns public.leads language plpgsql security definer set search_path='' as $$
declare actor public.team_members; saved public.leads; target public.leads; event_id uuid; f jsonb; object_meta jsonb; message text:=trim(coalesce(p->>'message','')); files jsonb:=coalesce(p->'attachments','[]');
begin
 actor:=public.current_member();if actor.email is null then raise exception 'ACCESS: Active company account required';end if;
 select * into target from public.leads where id=(p->>'lead_id')::uuid for update;
 if target.id is null or not public.can_view(target.owner_email) then raise exception 'ACCESS: Lead not available';end if;
 if target.archived_at is not null then raise exception 'Restore archived leads before posting';end if;
 if jsonb_typeof(files) is distinct from 'array' or jsonb_array_length(files)>4 or length(message)>4000 or (message='' and jsonb_array_length(files)=0) then raise exception 'Add a message or attachment (maximum four)';end if;
 insert into public.activities(lead_id,actor_email,actor_name,action,details,outcome,deal_value)
 values(target.id,actor.email,actor.display_name,'Note',message,'Other',target.value) returning id into event_id;
 for f in select value from jsonb_array_elements(files) loop
  select metadata into object_meta from storage.objects where bucket_id='lead-media' and name=f->>'path' and split_part(name,'/',1)=target.id::text and owner_id=auth.uid()::text;
  if object_meta is null then raise exception 'Attachment upload not available';end if;
  if (object_meta->>'size')::bigint<>(f->>'size')::bigint or object_meta->>'mimetype'<>f->>'mime' then raise exception 'Attachment metadata mismatch';end if;
  if (f->>'mime') like 'image/%' and (f->>'size')::bigint>8388608 then raise exception 'Images must be 8 MB or less';end if;
  insert into public.lead_attachments(activity_id,path,name,mime,size) values(event_id,f->>'path',f->>'name',f->>'mime',(f->>'size')::bigint);
 end loop;
 update public.leads set last_activity_at=now(),updated_at=now(),version=version+1 where id=target.id returning * into saved;
 return saved;
end $$;
revoke all on function crm_private.post_lead_message(jsonb) from public,anon;
grant execute on function crm_private.post_lead_message(jsonb) to authenticated;
create function public.post_lead_message(p jsonb) returns public.leads language sql security invoker set search_path='' as $$select crm_private.post_lead_message(p)$$;
revoke all on function public.post_lead_message(jsonb) from public,anon;
grant execute on function public.post_lead_message(jsonb) to authenticated;
commit;
