import { test } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
test("Shared Quo attributes one unique attempt, rejects competing attempts and protects outcomes", async () => {
  const db = new PGlite();
  try {
    await db.exec(
      `create role anon;create role authenticated;create schema crm_private;create table team_members(email text primary key,display_name text,role text,active boolean default true);create table leads(id uuid primary key,phone text,country text,archived_at timestamptz);create table activities(id uuid primary key default gen_random_uuid(),lead_id uuid,actor_email text,actor_name text,action text,details text,outcome text,created_at timestamptz default now());create table quo_events(id text primary key,kind text,direction text,phone text,occurred_at timestamptz,lead_id uuid,activity_id uuid);create function public.current_member() returns team_members language sql stable security definer set search_path='' as $$select * from public.team_members where email=current_setting('test.email',true) and active$$;create function crm_private.quo_phone(text,text) returns text language sql immutable as $$select regexp_replace($1,'[^0-9]','','g')$$;grant usage on schema public to authenticated;insert into team_members values('archie.a@frontline-x.com','Archie','Agent',true),('dora.d@frontline-x.com','Dora','Agent',true),('lucy.m@frontline-x.com','Lucy','Agent',true),('info@frontline-x.com','Admin','Admin',true);insert into leads values('00000000-0000-4000-8000-000000000001','+14155550123','US',null),('00000000-0000-4000-8000-000000000002','+14155550124','US',null);`,
    );
    for (const f of [
      "20261012110000_sales_call_attribution.sql",
      "20261012110500_sales_match_consumed_attempts.sql",
      "20261012111000_sales_match_lead_identity.sql",
    ])
      await db.exec(readFileSync("supabase/migrations/" + f, "utf8"));
    async function identity(email: string) {
      await db.exec("reset role");
      await db.query("select set_config('test.email',$1,false)", [email]);
      await db.exec("set role authenticated");
    }
    async function action(p: any) {
      return (
        await db.query<any>("select sales_call_action($1::jsonb) result", [
          JSON.stringify(p),
        ])
      ).rows[0].result;
    }
    await identity("lucy.m@frontline-x.com");
    await assert.rejects(() => action({ action: "start" }), /Sales rep/);
    await identity("archie.a@frontline-x.com");
    await action({ action: "start" });
    await action({
      action: "attempt",
      lead_id: "00000000-0000-4000-8000-000000000001",
    });
    await db.exec(
      `reset role;insert into quo_events values('AC1','call','outgoing','14155550123',now(),'00000000-0000-4000-8000-000000000001',null);`,
    );
    assert.equal(
      (await db.query<any>("select rep from sales_calls where call_id='AC1'"))
        .rows[0].rep,
      "archie.a@frontline-x.com",
    );
    await identity("dora.d@frontline-x.com");
    await assert.rejects(
      () =>
        action({
          action: "outcome",
          call_id: "AC1",
          outcome: "Spoke to person",
        }),
      /ACCESS/,
    );
    await action({ action: "start" });
    await action({
      action: "attempt",
      lead_id: "00000000-0000-4000-8000-000000000002",
    });
    await identity("archie.a@frontline-x.com");
    await action({ action: "outcome", call_id: "AC1", outcome: "Voicemail" });
    await action({
      action: "attempt",
      lead_id: "00000000-0000-4000-8000-000000000002",
    });
    await db.exec(
      `reset role;insert into quo_events values('AC2','call','outgoing','14155550124',now(),'00000000-0000-4000-8000-000000000002',null);`,
    );
    assert.equal(
      (await db.query("select * from sales_calls where call_id='AC2'")).rows
        .length,
      0,
    );
    assert.equal(
      (
        await db.query<any>(
          "select outcome from sales_calls where call_id='AC1'",
        )
      ).rows[0].outcome,
      "Voicemail",
    );
    await identity("dora.d@frontline-x.com");
    await assert.rejects(
      () =>
        action({
          action: "assign",
          call_id: "AC2",
          rep: "dora.d@frontline-x.com",
        }),
      /Admin review/,
    );
    await identity("info@frontline-x.com");
    await action({
      action: "assign",
      call_id: "AC2",
      rep: "dora.d@frontline-x.com",
    });
    assert.equal(
      (
        await db.query<any>(
          "select attribution from sales_calls where call_id='AC2'",
        )
      ).rows[0].attribution,
      "Admin reviewed",
    );
    await db.exec("reset role;set role anon");
    await assert.rejects(
      () => action({ action: "start" }),
      /permission denied/,
    );
  } finally {
    await db.close();
  }
});
