begin;
-- Every verified, allowlisted active company member can work on shared leads.
-- Ownership is assignment metadata; reassignment and team management remain admin-only.
create or replace function public.can_view(p_owner text) returns boolean language sql stable security definer set search_path='' as $$
 select (public.current_member()).email is not null
$$;
alter policy leads_read on public.leads using ((select (public.current_member()).email) is not null);
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
 if actor.role<>'Admin' and ((old.id is null and owner<>actor.email) or (old.id is not null and owner<>old.owner_email)) then raise exception 'ACCESS: Only admins can reassign leads';end if;
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
commit;
