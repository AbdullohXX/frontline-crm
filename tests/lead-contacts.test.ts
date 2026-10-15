import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
test("additional contacts preserve audit, reject stale writes and keep ambiguous Quo calls unmatched", async () => {
  const db = new PGlite();
  await db.exec(
    `create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,raw_app_meta_data jsonb);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.uid',true),'')::uuid$$;grant usage on schema public,auth to authenticated;grant execute on function auth.uid() to authenticated;`,
  );
  for (const file of [
    "001_crm.sql",
    "002_reports.sql",
    "20261005123730_workflow_and_performance.sql",
    "20261005155849_pending_lead_status.sql",
    "20261006205049_shared_team_lead_access.sql",
    "20261009152106_quo_communications.sql",
    "20261009154356_quo_explicit_sms_target.sql",
    "20261015204110_lead_contact_cards.sql",
  ])
    await db.exec(readFileSync("supabase/migrations/" + file, "utf8"));
  await db.exec(
    `insert into auth.users values('00000000-0000-4000-8000-000000000001','info@frontline-x.com',now(),'{"provider":"google"}'),('00000000-0000-4000-8000-000000000002','agent@frontline-x.com',now(),'{"provider":"google"}'),('00000000-0000-4000-8000-000000000003','outside@frontline-x.com',now(),'{"provider":"google"}');insert into public.team_members(email,display_name,role) values('info@frontline-x.com','Admin','Admin'),('agent@frontline-x.com','Agent','Agent');`,
  );
  async function identity(n: number) {
    await db.exec("reset role");
    await db.query("select set_config('test.uid',$1,false)", [
      "00000000-0000-4000-8000-00000000000" + n,
    ]);
    await db.exec("set role authenticated");
  }
  async function rpc(name: string, p: any) {
    return (
      await db.query<any>(`select to_jsonb(public.${name}($1::jsonb)) result`, [
        JSON.stringify(p),
      ])
    ).rows[0].result;
  }
  await identity(1);
  const lead = await rpc("save_lead", {
    company: "Primary company",
    stage: "New",
    owner_email: "info@frontline-x.com",
    phone: "+13075550111",
    country: "US",
  });
  await identity(2);
  const contact = await rpc("save_lead_contact", {
    lead_id: lead.id,
    name: "Finance desk",
    label: "Billing",
    phone: "+13075550222",
    email: "finance@example.test",
    created_by: "info@frontline-x.com",
  });
  assert.equal(contact.created_by, "agent@frontline-x.com");
  assert.equal(
    (await db.query("select * from public.lead_contacts")).rows.length,
    1,
  );
  await assert.rejects(
    () => db.exec("update public.lead_contacts set name='bypass'"),
    /permission/,
  );
  await assert.rejects(
    () =>
      rpc("save_lead_contact", { ...contact, action: "save", version: 999 }),
    /changed/,
  );
  const changed = await rpc("save_lead_contact", {
    ...contact,
    action: "save",
    name: "Accounts",
  });
  assert.equal(changed.version, 2);
  const archived = await rpc("save_lead_contact", {
    ...changed,
    action: "archive",
  });
  assert.ok(archived.archived_at);
  const restored = await rpc("save_lead_contact", {
    ...archived,
    action: "restore",
  });
  assert.equal(restored.archived_at, null);
  assert.equal(
    (
      await db.query(
        "select * from public.activities where action like 'Contact %'",
      )
    ).rows.length,
    4,
  );
  await identity(3);
  assert.equal(
    (await db.query("select * from public.lead_contacts")).rows.length,
    0,
  );
  await assert.rejects(
    () => rpc("save_lead_contact", { lead_id: lead.id, name: "Denied" }),
    /ACCESS/,
  );
  await db.exec("reset role;set role anon");
  await assert.rejects(
    () => db.exec("select * from public.lead_contacts"),
    /permission/,
  );
  await identity(1);
  await db.exec("reset role");
  assert.equal(
    (
      await db.query<any>(
        "select crm_private.quo_match_phone('13075550222') id",
      )
    ).rows[0].id,
    lead.id,
  );
  await identity(1);
  const second = await rpc("save_lead", {
    company: "Different company",
    stage: "New",
    owner_email: "info@frontline-x.com",
    phone: "+13075550333",
    country: "US",
  });
  await rpc("save_lead_contact", {
    lead_id: second.id,
    name: "Shared desk",
    phone: "+13075550222",
  });
  await db.exec("reset role");
  assert.equal(
    (
      await db.query<any>(
        "select crm_private.quo_match_phone('13075550222') id",
      )
    ).rows[0].id,
    null,
  );
  // Pipeline stages must be countable and pageable independently beyond 100 rows.
  await db.exec(
    `insert into public.leads(company,owner_email,stage) select 'Board fixture '||n,'info@frontline-x.com','Contacted' from generate_series(1,205) n;`,
  );
  await identity(2);
  const first = await rpc("crm_list_leads", { stage: "Contacted", page: 0 }),
    last = await rpc("crm_list_leads", { stage: "Contacted", page: 2 });
  assert.equal(first.total, 205);
  assert.equal(first.leads.length, 100);
  assert.equal(last.total, 205);
  assert.equal(last.leads.length, 5);
  assert.equal(
    new Set([...first.leads, ...last.leads].map((l: any) => l.id)).size,
    105,
  );
  await db.close();
});

