import {test} from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {readFileSync} from 'node:fs';
test('User job functions persist through creation, editing and legacy saves; agents cannot manage users',async()=>{
const db=new PGlite();try{await db.exec(`create table team_members(email text primary key,display_name text,role text,active boolean,aliases text[],job_role text check(job_role in ('Sales rep','Lead generator','Other')));create table admin_audit(actor_email text,action text,details jsonb);create function current_member() returns team_members language sql as $$select * from public.team_members where email=current_setting('test.email',true)$$;insert into team_members values('info@frontline-x.com','Admin','Admin',true,'{}','Other');select set_config('test.email','info@frontline-x.com',false);`);await db.exec(readFileSync('supabase/migrations/20261012120000_member_job_functions.sql','utf8'));
const member={email:'new@frontline-x.com',display_name:'New user',role:'Agent',active:true,aliases:[],job_role:'Lead generator'};
async function save(p:unknown){return db.query('select save_member($1::jsonb)',[JSON.stringify(p)]);}
await save(member);assert.equal((await db.query<any>("select job_role from team_members where email='new@frontline-x.com'")).rows[0].job_role,'Lead generator');await save({...member,job_role:'Sales rep'});await save({...member,job_role:undefined});assert.equal((await db.query<any>("select job_role from team_members where email='new@frontline-x.com'")).rows[0].job_role,'Sales rep');await db.exec("select set_config('test.email','new@frontline-x.com',false)");await assert.rejects(()=>save(member),/ACCESS/);
}finally{await db.close();}});
