const fs = require("fs"),
  assert = require("node:assert/strict"),
  { createRequire } = require("module"),
  root = process.cwd() + "/";
const { PGlite } = createRequire(root + "package.json")("@electric-sql/pglite");
const { test } = require("node:test");
test("role and verified workflow regressions", async () => {
  const db = new PGlite();
  try {
    await db.exec(
      fs
        .readFileSync(root + "tests/lead-contacts.test.ts", "utf8")
        .match(/await db\.exec\(\s*`([\s\S]*?)`/)[1],
    );
    for (const f of [
      "001_crm.sql",
      "002_reports.sql",
      "20261005123730_workflow_and_performance.sql",
      "20261005155849_pending_lead_status.sql",
      "20261006205049_shared_team_lead_access.sql",
      "20261009152106_quo_communications.sql",
      "20261009154356_quo_explicit_sms_target.sql",
      "20261009190000_agent_productivity.sql",
      "20261012110000_sales_call_attribution.sql",
      "20261012110500_sales_match_consumed_attempts.sql",
      "20261012111000_sales_match_lead_identity.sql",
      "20261012120000_member_job_functions.sql",
      "20261012130000_sales_advisor.sql",
      "20261015204110_lead_contact_cards.sql",
      "20261016135100_roles_handoff_verified_workflows.sql",
    ])
      await db.exec(fs.readFileSync(root + "supabase/migrations/" + f, "utf8"));
    for (const [n, email, role, job] of [
      [1, "info", "Admin", "Other"],
      [2, "generator", "Agent", "Lead generator"],
      [3, "rep", "Agent", "Sales rep"],
      [4, "other", "Agent", "Other"],
    ]) {
      await db.query(
        `insert into auth.users values($1,$2,now(),'{"provider":"google"}')`,
        ["00000000-0000-4000-8000-00000000000" + n, email + "@frontline-x.com"],
      );
      await db.query(
        "insert into team_members(email,display_name,role,job_role) values($1,$2,$3,$4)",
        [email + "@frontline-x.com", email, role, job],
      );
    }
    async function identity(n) {
      await db.exec("reset role");
      await db.query("select set_config('test.uid',$1,false)", [
        "00000000-0000-4000-8000-00000000000" + n,
      ]);
      await db.exec("set role authenticated");
    }
    async function rpc(name, p) {
      return (
        await db.query(`select to_jsonb(public.${name}($1::jsonb)) result`, [
          JSON.stringify(p),
        ])
      ).rows[0].result;
    }
    await identity(2);
    let lead = await rpc("save_lead", {
      company: "Synthetic lead",
      phone: "3075550111",
      country: "US, Wyoming",
      stage: "New",
      owner_email: "generator@frontline-x.com",
    });
    assert.equal(lead.created_by, "generator@frontline-x.com");
    await assert.rejects(
      () => rpc("save_lead", { ...lead, stage: "Won" }),
      /Sales/,
    );
    await assert.rejects(
      () => rpc("sales_call_action", { action: "launch", lead_id: lead.id }),
      /Sales/,
    );
    await assert.rejects(
      () =>
        rpc("change_leads", {
          action: "archive",
          ids: [{ id: lead.id, version: lead.version }],
        }),
      /Archive/,
    );
    await assert.rejects(
      () => rpc("sales_advisor_run", { action: "start" }),
      /permission/,
    );
    await assert.rejects(() => rpc("import_gmail", []), /permission/);
    lead = await rpc("handoff_lead", {
      action: "submit",
      lead_id: lead.id,
      version: lead.version,
      rep: "rep@frontline-x.com",
    });
    assert.equal(lead.handoff_status, "Pending");
    assert.equal(lead.owner_email, "generator@frontline-x.com");
    await identity(4);
    await assert.rejects(
      () =>
        rpc("handoff_lead", {
          action: "accept",
          lead_id: lead.id,
          version: lead.version,
        }),
      /ACCESS/,
    );
    await identity(3);
    lead = await rpc("handoff_lead", {
      action: "accept",
      lead_id: lead.id,
      version: lead.version,
    });
    assert.equal(lead.handoff_status, "Accepted");
    const attempt = await rpc("sales_call_action", {
      action: "launch",
      lead_id: lead.id,
    });
    assert.equal(attempt.phone, "+13075550111");
    assert.ok(attempt.attempt);
    await assert.rejects(
      () => rpc("sales_call_action", { action: "launch", lead_id: lead.id }),
      /awaiting/,
    );
    await rpc("sales_call_action", {
      action: "cancel",
      attempt_id: attempt.attempt,
    });
    await rpc("sales_call_action", { action: "launch", lead_id: lead.id });
    await db.exec("reset role");
    await db.query(
      "insert into quo_events(id,kind,direction,phone,lead_id,occurred_at,source_updated_at) values('ACtest','call','outgoing','13075550111',$1,now(),now())",
      [lead.id],
    );
    assert.equal(
      (await db.query("select rep from sales_calls where call_id='ACtest'"))
        .rows[0].rep,
      "rep@frontline-x.com",
    );
    await identity(3);
    await assert.rejects(
      () =>
        rpc("sales_call_action", {
          action: "outcome",
          call_id: "ACtest",
          outcome: "Meeting booked",
          disposition: "Voicemail",
        }),
      /human/,
    );
    await assert.rejects(
      () =>
        rpc("sales_call_action", {
          action: "outcome",
          call_id: "ACtest",
          outcome: "Follow-up required",
          disposition: "Spoke to person",
        }),
      /Schedule/,
    );
    let result = await rpc("sales_call_action", {
      action: "outcome",
      call_id: "ACtest",
      outcome: "Qualified",
      disposition: "Spoke to person",
      version: lead.version,
      next_action: "Send proposal",
      next_follow_up: "2026-10-20",
    });
    assert.equal(result.lead.stage, "Qualified");
    assert.equal(result.lead.next_action, "Send proposal");
    assert.equal(result.lead.created_by, "generator@frontline-x.com");
    await identity(1);
    await rpc("sales_call_action", {
      action: "assign",
      call_id: "ACtest",
      rep: "rep@frontline-x.com",
      reason: "Verified synthetic test evidence",
    });
    assert.equal(
      (await db.query("select outcome from sales_calls where call_id='ACtest'"))
        .rows[0].outcome,
      "",
    );
    await db.exec(
      "reset role;update team_members set job_role='Other' where email='rep@frontline-x.com'",
    );
    assert.equal(
      (
        await db.query(
          "select count(*)::int n from calling_sessions where rep='rep@frontline-x.com' and ended_at is null",
        )
      ).rows[0].n,
      0,
    );
    await identity(3);
    await assert.rejects(
      () => rpc("sales_call_action", { action: "launch", lead_id: lead.id }),
      /Sales/,
    );
    await db.exec(
      "reset role;insert into crm_private.quo_state(id,token_hash) values(true,encode(sha256(convert_to('synthetic-token','UTF8')),'hex'));set role anon",
    );
    async function server(
      op,
      p,
      token = "synthetic-token",
      actor = "rep@frontline-x.com",
    ) {
      return (
        await db.query(
          "select public.crm_server_action($1,$2,$3,$4::jsonb) result",
          [token, actor, op, JSON.stringify(p)],
        )
      ).rows[0].result;
    }
    await assert.rejects(
      () => server("sync_start", { lead_id: lead.id }, "bad"),
      /credential/,
    );
    const lease = await server("sync_start", { lead_id: lead.id });
    await assert.rejects(
      () =>
        server(
          "sync_start",
          { lead_id: lead.id },
          undefined,
          "info@frontline-x.com",
        ),
      /RATE/,
    );
    await server("sync_finish", { id: lease.id, success: false });
    const retry = await server("sync_start", { lead_id: lead.id });
    await server("sync_finish", { id: retry.id, success: true });
    await assert.rejects(
      () => server("sync_start", { lead_id: lead.id }),
      /RATE/,
    );
    assert.equal(await server("gmail", []), 0);
    await assert.rejects(
      () => server("share_number", { id: "PNtest", enabled: true }),
      /Admin/,
    );
    await server(
      "share_number",
      { id: "PNtest", enabled: true },
      undefined,
      "info@frontline-x.com",
    );
    await identity(1);
    const bounds = (
      await db.query("select crm_day_bounds('2026-10-16','2026-10-16') b")
    ).rows[0].b;
    assert.ok(bounds.from && bounds.to);
    await db.exec("reset role");
    const { leadZone } = require(root + ".test-build/src/lib/workflow.js");
    const { phone } = require(root + ".test-build/src/lib/quo.js");
    for (const country of [
      "US, Colorado",
      "United States - New York",
      "USA / WY",
      "US, TX",
      "US, AZ",
      "US, NV",
      "United States, Alaska",
      "Canada",
      "US, California",
      "U.S.A. Wyoming",
    ]) {
      const row = (
        await db.query(
          "select public.crm_lead_zone($1,'') zone,crm_private.quo_phone('3075550111',$1) phone",
          [country],
        )
      ).rows[0];
      assert.equal(row.zone, leadZone({ country }), country);
      assert.equal(row.phone, phone("3075550111", country), country);
    }
    await db.exec("reset role");
    await db.exec(
      fs.readFileSync(
        root +
          "supabase/migrations/20261016161717_pipeline_people_profiles.sql",
        "utf8",
      ),
    );
    await identity(1);
    let migrated = (
      await db.query("select * from public.leads where id=$1", [lead.id])
    ).rows[0];
    assert.equal(migrated.stage, "Meeting Booked");
    const moved = await rpc("change_leads", {
      action: "stage",
      stage: "Follow-up 1",
      items: [{ id: lead.id, version: migrated.version }],
    });
    assert.equal(moved[0].stage_actor, "info@frontline-x.com");
    assert.ok(moved[0].next_follow_up);
    assert.equal(moved[0].next_action, "Call: Follow-up 1");
    const next = await rpc("change_leads", {
      action: "stage",
      stage: "Follow-up 2",
      items: [{ id: lead.id, version: moved[0].version }],
    });
    assert.equal(next[0].stage, "Follow-up 2");
    await identity(2);
    const profile = await rpc("save_profile", {
      email: "info@frontline-x.com",
      avatar_color: "#176b87",
      avatar_image: "",
      role: "Admin",
    });
    assert.equal(profile.email, "generator@frontline-x.com");
    assert.equal(profile.role, "Agent");
    assert.equal(profile.avatar_color, "#176b87");
    await assert.rejects(
      () => rpc("save_profile", { avatar_color: "red;bad", avatar_image: "" }),
      /check constraint/,
    );
    await db.exec("reset role");
    await db.exec(
      fs.readFileSync(
        root +
          "supabase/migrations/20261016172327_verified_email_lead_insights.sql",
        "utf8",
      ),
    );
    await identity(1);
    await rpc("save_lead_contact", {
      lead_id: lead.id,
      name: "Buyer",
      email: "buyer@example.test",
      phone: "",
    });
    await db.exec("reset role;set role anon");
    const verified = {
      id: "mail-proof-1",
      recipients: ["BUYER@example.test"],
      subject: "Verified contact test",
      sent_at: new Date().toISOString(),
    };
    assert.equal(await server("gmail", [verified]), 1);
    assert.equal(await server("gmail", [verified]), 0);
    await assert.rejects(
      () =>
        db.query(
          "insert into public.verified_sent_emails(sender,message_id,lead_id,recipient,sent_at) values('rep@frontline-x.com','fake',$1,'buyer@example.test',now())",
          [lead.id],
        ),
      /permission/,
    );
    await identity(3);
    const evidence = (
      await db.query(
        "select * from public.verified_sent_emails where lead_id=$1",
        [lead.id],
      )
    ).rows;
    assert.equal(evidence.length, 1);
    assert.equal(evidence[0].sender, "rep@frontline-x.com");
    assert.equal(evidence[0].recipient, "buyer@example.test");
    await assert.rejects(() => rpc("import_gmail", [verified]), /permission/);
    console.log(
      "PASS: handoff, capabilities, caller matching, cancel, outcomes, revocation, verified Gmail, sync leases, shared numbers, timezone boundaries",
    );
  } finally {
    await db.close();
  }
});
