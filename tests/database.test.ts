import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
const owner = "00000000-0000-4000-8000-000000000001",
  agent = "00000000-0000-4000-8000-000000000002",
  outsider = "00000000-0000-4000-8000-000000000003";
test("Database RLS, atomic audit, stale versions, reassignment, activity and imports", async () => {
  const db = new PGlite();
  await db.exec(
    `create role anon; create role authenticated; create schema auth; create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,raw_app_meta_data jsonb);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.uid',true),'')::uuid$$;grant usage on schema public,auth to authenticated;grant execute on function auth.uid() to authenticated;`,
  );
  await db.exec(readFileSync("supabase/migrations/001_crm.sql", "utf8"));
  await db.exec(readFileSync("supabase/migrations/002_reports.sql", "utf8"));
  await db.exec(
    readFileSync(
      "supabase/migrations/20261005123730_workflow_and_performance.sql",
      "utf8",
    ),
  );
  await db.exec(
    readFileSync(
      "supabase/migrations/20261005155849_pending_lead_status.sql",
      "utf8",
    ),
  );
  await db.query(
    `insert into auth.users values ($1,'owner@frontline-x.com',now(),' {"provider":"google"}'),($2,'agent@frontline-x.com',now(),'{"provider":"google"}'),($3,'outsider@frontline-x.com',now(),'{"provider":"google"}')`,
    [owner, agent, outsider],
  );
  await db.exec(
    `insert into public.team_members(email,display_name,role) values('owner@frontline-x.com','Owner','Admin'),('agent@frontline-x.com','Agent','Agent');`,
  );
  async function identity(id: string) {
    await db.exec("reset role");
    await db.query(`select set_config('test.uid',$1,false)`, [id]);
    await db.exec("set role authenticated");
  }
  async function rpc(name: string, p: unknown) {
    return (
      await db.query<{ result: any }>(
        `select to_jsonb(public.${name}($1::jsonb)) as result`,
        [JSON.stringify(p)],
      )
    ).rows[0].result;
  }
  const input = {
    company: "First lead",
    email: "a@example.test",
    phone: "+14155550123",
    stage: "New",
    status: "Pending",
    priority: "High",
    owner_email: "owner@frontline-x.com",
    value: 1000,
    score: 0,
    next_action: "Call",
    next_follow_up: "2026-10-02",
  };
  await identity(owner);
  let first = await rpc("save_lead", input);
  assert.equal(first.score, 0);
  assert.equal(first.status, "Pending");
  assert.equal(
    (await db.query("select * from public.activities")).rows.length,
    1,
  );
  await assert.rejects(() => rpc("save_lead", input), /DUPLICATE/);
  assert.equal((await db.query("select * from public.leads")).rows.length, 1);
  const second = await rpc("save_lead", {
    ...input,
    company: "Second lead",
    email: "b@example.test",
    phone: "+14155550124",
    owner_email: "agent@frontline-x.com",
  });
  await identity(agent);
  assert.equal((await db.query("select * from public.leads")).rows.length, 1);
  await assert.rejects(
    () => rpc("save_lead", { ...first, company: "Hacked" }),
    /ACCESS/,
  );
  await assert.rejects(
    () => rpc("save_lead", { ...second, owner_email: "owner@frontline-x.com" }),
    /ACCESS/,
  );
  await assert.rejects(
    () => db.query(`update public.leads set company='Hacked'`),
    /permission denied/,
  );
  await assert.rejects(
    () =>
      rpc("save_member", {
        email: "outsider@frontline-x.com",
        display_name: "X",
        role: "Admin",
        active: true,
      }),
    /ACCESS/,
  );
  const changed = await rpc("record_activity", {
    id: second.id,
    version: second.version,
    type: "Call",
    outcome: "No answer",
    details: "No answer",
    next_action: "Retry",
    next_follow_up: "2026-10-05",
  });
  assert.equal(changed.version, 2);
  assert.equal(changed.next_follow_up, "2026-10-05");
  await assert.rejects(
    () =>
      rpc("record_activity", {
        id: second.id,
        version: second.version,
        type: "Call",
        outcome: "Connected",
        details: "Stale",
      }),
    /CONFLICT/,
  );
  assert.equal(
    (await db.query("select * from public.activities")).rows.length,
    2,
  );
  const completed = await rpc("record_activity", {
    id: second.id,
    version: changed.version,
    type: "Note",
    outcome: "Completed",
    details: "Done",
    complete: true,
  });
  assert.equal(completed.next_follow_up, null);
  const agentReport = (
    await db.query<{ r: any }>("select public.crm_report() r")
  ).rows[0].r;
  assert.equal(agentReport.total, 1);
  assert.equal(agentReport.calls, 1);
  await identity(outsider);
  assert.equal((await db.query("select * from public.leads")).rows.length, 0);
  await assert.rejects(() => rpc("save_lead", input), /ACCESS/);
  await identity(owner);
  first = await rpc("save_lead", { ...first, stage: "Won" });
  assert(first.closed_at);
  await assert.rejects(
    () => rpc("save_lead", { ...first, version: 1, stage: "New" }),
    /CONFLICT/,
  );
  const report = (await db.query<{ r: any }>("select public.crm_report() r"))
    .rows[0].r;
  assert.equal(report.total, 2);
  assert.equal(report.recorded_revenue, 1000);
  // Failed audit insert must roll the lead update back.
  await db.exec("reset role");
  await db.exec(
    `create function public.fail_audit() returns trigger language plpgsql as $$begin raise exception 'TEST AUDIT FAILURE';end$$;create trigger test_audit before insert on public.activities for each row execute function public.fail_audit();`,
  );
  await identity(owner);
  await assert.rejects(
    () => rpc("save_lead", { ...first, company: "Should roll back" }),
    /TEST AUDIT FAILURE/,
  );
  assert.equal(
    (
      await db.query<{ company: string }>(
        "select company from public.leads where id=$1",
        [first.id],
      )
    ).rows[0].company,
    "First lead",
  );
  await db.exec("reset role");
  await db.exec("drop trigger test_audit on public.activities");
  await identity(owner);
  const imported = {
    ...input,
    company: "Legacy won",
    email: "old@example.test",
    phone: "",
    stage: "Won",
    import_key: "sheet:1",
    legacy_id: "1",
    original_created_date: "2025-01-02",
    legacy_stage: "Won",
  };
  const batch = await rpc("import_leads", [imported]);
  assert.equal(batch.imported, 1);
  assert.equal((await rpc("import_leads", [imported])).skipped, 1);
  const old = (
    await db.query<{ closed_at: string | null }>(
      "select closed_at from public.leads where import_key=$1",
      ["sheet:1"],
    )
  ).rows[0];
  assert.equal(old.closed_at, null);
  assert.equal(
    (await db.query<{ r: any }>("select public.crm_report() r")).rows[0].r
      .recorded_revenue,
    1000,
  );
  const before = (await db.query("select * from public.leads")).rows.length;
  await assert.rejects(() =>
    rpc("import_leads", [
      { ...imported, company: "Valid batch row", import_key: "sheet:2" },
      { ...imported, company: "", import_key: "sheet:3" },
    ]),
  );
  assert.equal(
    (await db.query("select * from public.leads")).rows.length,
    before,
  );

  const items = [{ id: first.id, version: first.version }];
  await assert.rejects(
    () => rpc("change_leads", { action: "stage", stage: "Lost", items }),
    /reason/i,
  );
  const moved = (
    await rpc("change_leads", { action: "stage", stage: "Qualified", items })
  )[0];
  assert.equal(moved.stage, "Qualified");
  assert.equal(moved.value, 1000);
  const beforeBulk = (await db.query("select * from public.activities")).rows
    .length;
  await assert.rejects(
    () =>
      rpc("change_leads", {
        action: "stage",
        stage: "Proposal",
        items: [
          { id: moved.id, version: moved.version },
          { id: second.id, version: 0 },
        ],
      }),
    /CONFLICT/,
  );
  assert.equal(
    (
      await db.query<{ stage: string }>(
        "select stage from public.leads where id=$1",
        [first.id],
      )
    ).rows[0].stage,
    "Qualified",
  );
  assert.equal(
    (await db.query("select * from public.activities")).rows.length,
    beforeBulk,
  );
  const categorized = (
    await rpc("change_leads", {
      action: "work_status",
      work_status: "AI voicemail",
      items: [{ id: moved.id, version: moved.version }],
    })
  )[0];
  assert.equal(categorized.work_status, "AI voicemail");
  const search = await rpc("crm_list_leads", {
    search: "4155550123",
    date: "",
    archived: "false",
  });
  assert.equal(search.total, 1);
  const archived = (
    await rpc("change_leads", {
      action: "archive",
      items: [{ id: categorized.id, version: categorized.version }],
    })
  )[0];
  assert.equal((await rpc("crm_list_leads", {})).total, 2);
  assert.equal((await rpc("crm_list_leads", { archived: "true" })).total, 1);
  await assert.rejects(
    () => rpc("save_lead", { ...archived, company: "Archive edit" }),
    /Restore/,
  );
  await assert.rejects(
    () =>
      rpc("record_activity", {
        id: archived.id,
        version: archived.version,
        type: "Note",
        details: "x",
      }),
    /Restore/,
  );
  const restored = (
    await rpc("change_leads", {
      action: "restore",
      items: [{ id: archived.id, version: archived.version }],
    })
  )[0];
  assert.equal(restored.archived_at, null);
  assert.equal(restored.work_status, "AI voicemail");
  await identity(agent);
  await assert.rejects(
    () =>
      rpc("change_leads", {
        action: "stage",
        stage: "New",
        items: [{ id: restored.id, version: restored.version }],
      }),
    /ACCESS/,
  );
  assert.equal(
    (await rpc("crm_list_leads", { owner: "owner@frontline-x.com" })).total,
    0,
  );
  // Shared access upgrade: cross-owner work is allowed, reassignment/admin access is not.
  await db.exec("reset role");
  await db.exec(
    readFileSync(
      "supabase/migrations/20261006205049_shared_team_lead_access.sql",
      "utf8",
    ),
  );
  await identity(agent);
  assert.equal((await db.query("select * from public.leads")).rows.length, 3);
  assert.equal(
    (await rpc("crm_list_leads", { owner: "owner@frontline-x.com" })).total,
    2,
  );
  assert.equal((await rpc("crm_list_leads", { scope: "mine" })).total, 1);
  assert.equal(
    (await db.query("select * from public.admin_audit")).rows.length,
    0,
  );
  let shared = await rpc("save_lead", {
    ...restored,
    notes: "Collaborative edit",
  });
  assert.equal(shared.owner_email, "owner@frontline-x.com");
  assert.equal(shared.notes, "Collaborative edit");
  await assert.rejects(
    () => rpc("save_lead", { ...shared, owner_email: "agent@frontline-x.com" }),
    /ACCESS/,
  );
  shared = (
    await rpc("change_leads", {
      action: "stage",
      stage: "Proposal",
      items: [{ id: shared.id, version: shared.version }],
    })
  )[0];
  shared = await rpc("record_activity", {
    id: shared.id,
    version: shared.version,
    type: "Note",
    outcome: "Other",
    details: "Shared follow-up",
  });
  assert.equal(shared.owner_email, "owner@frontline-x.com");
  assert.equal(
    (
      await db.query("select * from public.activities where lead_id=$1", [
        shared.id,
      ])
    ).rows.length > 0,
    true,
  );
  await assert.rejects(
    () =>
      rpc("save_member", {
        email: "outsider@frontline-x.com",
        display_name: "X",
        role: "Admin",
        active: true,
      }),
    /ACCESS/,
  );
  await assert.rejects(() => rpc("import_leads", []), /ACCESS/);
  await identity(outsider);
  assert.equal((await db.query("select * from public.leads")).rows.length, 0);
  await assert.rejects(() => rpc("save_lead", { ...shared }), /ACCESS/);
  await identity(owner);
  await rpc("save_member", {
    email: "agent@frontline-x.com",
    display_name: "Agent",
    role: "Agent",
    active: false,
    aliases: [],
  });
  await identity(agent);
  assert.equal((await db.query("select * from public.leads")).rows.length, 0);
  await identity(owner);
  await assert.rejects(
    () =>
      rpc("save_member", {
        email: "owner@frontline-x.com",
        display_name: "Owner",
        role: "Agent",
        active: true,
      }),
    /cannot disable/,
  );
  await db.close();
});
