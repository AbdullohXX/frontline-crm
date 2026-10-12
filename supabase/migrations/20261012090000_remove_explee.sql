begin;
-- Retire ingestion completely; keep imported leads, audit and historical source records.
drop function if exists public.explee_sync(text,text,jsonb);
drop function if exists crm_private.explee_sync(text,text,jsonb);
update crm_private.explee_state set token_hash=encode(sha256(convert_to(gen_random_uuid()::text,'UTF8')),'hex');
commit;
