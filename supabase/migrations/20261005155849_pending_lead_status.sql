begin;
alter table public.leads drop constraint leads_status_check;
alter table public.leads add constraint leads_status_check check(status in ('Active','Inactive','Pending'));
commit;
