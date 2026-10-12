import {test} from "node:test";
import assert from "node:assert/strict";
import {PGlite} from "@electric-sql/pglite";
import {readFileSync} from "node:fs";
test("Explee removal retires both ingestion RPCs and preserves historical records",async()=>{
const db=new PGlite();try{
await db.exec(`create schema crm_private;create table crm_private.explee_state(token_hash text);insert into crm_private.explee_state values('old');create table public.leads(id int);insert into public.leads values(1);create table public.explee_hot_leads(id int);insert into public.explee_hot_leads values(1);create function crm_private.explee_sync(text,text,jsonb) returns jsonb language sql as $$select '{}'::jsonb$$;create function public.explee_sync(text,text,jsonb) returns jsonb language sql as $$select '{}'::jsonb$$;`);
await db.exec(readFileSync('supabase/migrations/20261012090000_remove_explee.sql','utf8'));
assert.equal((await db.query<any>("select count(*)::int n from pg_proc where proname='explee_sync'")).rows[0].n,0);
assert.equal((await db.query('select * from leads')).rows.length,1);
assert.equal((await db.query('select * from explee_hot_leads')).rows.length,1);
assert.notEqual((await db.query<any>('select token_hash from crm_private.explee_state')).rows[0].token_hash,'old');
}finally{await db.close();}});
