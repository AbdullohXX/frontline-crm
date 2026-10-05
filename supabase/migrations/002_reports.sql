begin;
-- SECURITY INVOKER: every aggregation uses the caller's RLS permissions.
create function public.crm_report(p_from date default null,p_to date default null) returns jsonb language sql stable security invoker set search_path='' as $$
 with visible as(select * from public.leads),
 settings as(select time_zone from public.crm_settings where id=true),
 events as(select a.* from public.activities a,settings s where a.action<>'Imported' and (p_from is null or (a.created_at at time zone s.time_zone)::date>=p_from) and (p_to is null or (a.created_at at time zone s.time_zone)::date<=p_to)),
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
commit;
