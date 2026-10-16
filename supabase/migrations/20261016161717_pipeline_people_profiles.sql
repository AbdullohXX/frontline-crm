begin;
alter table public.leads add column stage_actor text references public.team_members(email);
create index leads_stage_actor on public.leads(stage_actor) where stage_actor is not null;
alter table public.team_members add column avatar_color text not null default '' check(avatar_color='' or avatar_color ~ '^#[0-9a-fA-F]{6}$'),add column avatar_image text not null default '' check(avatar_image='' or (length(avatar_image)<=30000 and avatar_image ~ '^data:image/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$'));
-- Recover responsibility only from an actual stage-change audit entry.
update public.leads l set stage_actor=a.actor_email from (select distinct on(lead_id) lead_id,actor_email,to_stage from public.activities where action='Stage Changed' and from_stage<>to_stage order by lead_id,created_at desc,id desc) a where l.id=a.lead_id and l.stage=a.to_stage and exists(select 1 from public.team_members m where m.email=a.actor_email);
alter table public.leads drop constraint leads_stage_check;
alter table public.leads add constraint leads_stage_check check(stage in ('New','Contacted','Follow-up 1','Follow-up 2','Follow-up 3','Meeting Booked','Negotiation','Won','Lost')) not valid;
insert into public.activities(lead_id,actor_email,actor_name,action,details,from_stage,to_stage,snapshot)
 select id,'info@frontline-x.com','Frontline Administrator','Pipeline migration','User-approved stage mapping; historical responsibility preserved',stage,case when stage in ('Qualified','Proposal') then 'Meeting Booked' else 'Follow-up 1' end,jsonb_build_object('previous_stage',stage) from public.leads where stage in ('Qualified','Proposal','Nurture');
update public.leads set next_follow_up=case when stage='Nurture' and next_follow_up is null then ((now() at time zone (select time_zone from public.crm_settings where id))::date+1) else next_follow_up end,next_action=case when stage='Nurture' and next_action='' then 'Call: Follow-up 1' else next_action end,stage=case when stage in ('Qualified','Proposal') then 'Meeting Booked' else 'Follow-up 1' end,version=version+1,updated_at=now() where stage in ('Qualified','Proposal','Nurture');
alter table public.leads validate constraint leads_stage_check;
do $patch$ declare f record;source text;begin
for f in select p.oid as function_oid,n.nspname,p.proname,pg_get_function_identity_arguments(p.oid) args from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','crm_private') and p.proname in ('change_leads_legacy','sales_call_action') loop
 source:=pg_get_functiondef(f.function_oid);
 source:=replace(source,'''New'',''Contacted'',''Qualified'',''Meeting Booked'',''Proposal'',''Negotiation'',''Nurture'',''Won'',''Lost''','''New'',''Contacted'',''Follow-up 1'',''Follow-up 2'',''Follow-up 3'',''Meeting Booked'',''Negotiation'',''Won'',''Lost''');
 source:=replace(source,'when ''Qualified'' then ''Qualified''','when ''Qualified'' then ''Meeting Booked''');
 execute source;
end loop;end $patch$;
create function crm_private.track_stage_responsibility() returns trigger language plpgsql security definer set search_path='' as $$
declare actor public.team_members:=public.current_member();tz text;begin
 if new.stage is distinct from old.stage then
 if actor.email is not null then new.stage_actor:=actor.email;end if;
 if new.stage in ('Follow-up 1','Follow-up 2','Follow-up 3') then
 select time_zone into tz from public.crm_settings where id;
 if new.next_follow_up is null or new.next_follow_up is not distinct from old.next_follow_up then new.next_follow_up:=(now() at time zone tz)::date+1;end if;
 if new.next_action='' or new.next_action is not distinct from old.next_action then new.next_action:='Call: '||new.stage;end if;
 end if;end if;return new;end $$;
revoke all on function crm_private.track_stage_responsibility() from public,anon,authenticated;
create trigger lead_stage_responsibility before update of stage on public.leads for each row execute function crm_private.track_stage_responsibility();
create function public.save_profile(p jsonb) returns public.team_members language plpgsql security definer set search_path='' as $$
declare actor public.team_members:=public.current_member();saved public.team_members;begin
 if actor.email is null then raise exception 'ACCESS: Active account required';end if;
 update public.team_members set avatar_color=coalesce(p->>'avatar_color',''),avatar_image=coalesce(p->>'avatar_image','') where email=actor.email returning * into saved;return saved;end $$;
revoke all on function public.save_profile(jsonb) from public,anon;grant execute on function public.save_profile(jsonb) to authenticated;
commit;