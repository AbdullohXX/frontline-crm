-- Run after 001_crm.sql and 002_reports.sql, using the Supabase SQL Editor.
-- Bootstrap only: the member still has to authenticate with their verified Google account.
insert into public.team_members(email, display_name, role, active, aliases)
values ('info@frontline-x.com', 'Frontline Administrator', 'Admin', true, '{}')
on conflict (email) do nothing;
