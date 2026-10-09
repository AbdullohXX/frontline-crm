import { test } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
test("productivity protects targets, deduplicates active minutes and Gmail history", async () => {
  const db = new PGlite();
  try {
    await db.exec(
      `create role anon;create role authenticated;create table team_members(email text primary key,display_name text,role text,active boolean default true);create table crm_settings(time_zone text);insert into crm_settings values('America/New_York');create table leads(id uuid primary key,email text,archived_at timestamptz);create table activities(lead_id uuid,actor_email text,actor_name text,action text,details text,outcome text,created_at timestamptz);create function current_member() returns team_members language sql stable security definer as $$select * from public.team_members where email=current_setting('test.email',true) and active$$;create function is_admin() returns boolean language sql stable security definer as $$select coalesce((public.current_member()).role='Admin',false)$$;grant usage on schema public to authenticated;insert into team_members values('admin@frontline-x.com','Admin','Admin',true),('agent@frontline-x.com','Agent','Agent',true);insert into leads values('00000000-0000-4000-8000-000000000001','customer@example.com',null);`,
    );
    await db.exec(
      readFileSync(
        "supabase/migrations/20261009190000_agent_productivity.sql",
        "utf8",
      ),
    );
    await db.query("select set_config('test.email',$1,false)", [
      "agent@frontline-x.com",
    ]);
    await db.exec("set role authenticated");
    await assert.rejects(
      () =>
        db.exec(
          "insert into agent_targets values('agent@frontline-x.com',10,10)",
        ),
      /row-level security/,
    );
    await db.exec("select record_presence();select record_presence()");
    assert.equal(
      (await db.query<any>("select minutes from agent_usage")).rows[0].minutes,
      1,
    );
    const payload = [
      {
        id: "m1",
        recipients: ["CUSTOMER@example.com"],
        subject: "Proposal",
        sent_at: new Date().toISOString(),
      },
    ];
    assert.equal(
      (
        await db.query<any>("select import_gmail($1::jsonb) n", [
          JSON.stringify(payload),
        ])
      ).rows[0].n,
      1,
    );
    assert.equal(
      (
        await db.query<any>("select import_gmail($1::jsonb) n", [
          JSON.stringify(payload),
        ])
      ).rows[0].n,
      0,
    );
    await db.exec("reset role");
    assert.equal(
      (await db.query<any>("select count(*)::int n from activities")).rows[0].n,
      1,
    );
    await db.query("select set_config('test.email',$1,false)", [
      "outside@example.com",
    ]);
    await db.exec("set role authenticated");
    await assert.rejects(() => db.exec("select record_presence()"), /ACCESS/);
    assert.equal((await db.query("select * from agent_usage")).rows.length, 0);
    await db.exec("reset role;set role anon");
    await assert.rejects(
      () => db.exec("select record_presence()"),
      /permission denied/,
    );
  } finally {
    await db.close();
  }
});
