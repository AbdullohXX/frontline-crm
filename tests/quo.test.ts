import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import {
  verifyQuo,
  normalizeQuo,
  phone,
  quoRequest,
  quoPages,
  callMetrics,
} from "../src/lib/quo.js";

test("Quo signatures reject altered bytes, replay, missing headers and wrong secret", () => {
  const key =
      "whsec_" +
      Buffer.from("test-key-with-32-randomish-bytes!!").toString("base64"),
    now = Date.now(),
    t = String(Math.floor(now / 1000)),
    id = "delivery1",
    raw = '{"type":"call.completed"}';
  const signature = createHmac("sha256", Buffer.from(key.slice(6), "base64"))
    .update(id + "." + t + "." + raw)
    .digest("base64");
  const h = new Headers({
    "webhook-id": id,
    "webhook-timestamp": t,
    "webhook-signature": "v1,invalid v1," + signature,
  });
  assert.equal(verifyQuo(raw, h, key, now), true);
  assert.equal(verifyQuo(raw + " ", h, key, now), false);
  assert.equal(verifyQuo(raw, h, key, now + 301000), false);
  assert.equal(verifyQuo(raw, h, "whsec_d3Jvbmc=", now), false);
  assert.equal(verifyQuo(raw, new Headers(), key, now), false);
});
test("Quo identity matching is conservative and metrics exclude unfinished calls", () => {
  const base = {
    id: "ACtest",
    createdAt: "2026-10-09T10:00:00Z",
    direction: "outgoing",
    status: "completed",
    answeredAt: "2026-10-09T10:00:01Z",
    duration: 60,
    participants: [
      { phoneNumber: "+12125550101", actorId: "US1" },
      { phoneNumber: "+14155550123", actorId: null },
    ],
  };
  const e = normalizeQuo("call", base);
  assert.equal(e.phone, "14155550123");
  assert.equal(e.connected, true);
  const group = normalizeQuo("call", {
    ...base,
    participants: [
      ...base.participants,
      { phoneNumber: "+14155550124", actorId: null },
    ],
  });
  assert.equal(group.phone, "");
  const artifact = normalizeQuo(
    "call",
    {
      callId: "ACtest",
      processingStatus: "completed",
      summary: ["Customer asked about pricing"],
    },
    {},
    "call.summary.completed",
  );
  assert.equal(artifact.status, "");
  assert.equal(artifact.id, e.id);
  assert.equal(phone("(415) 555-0123", "United States"), "14155550123");
  assert.equal(phone("+998 90 1234567"), "998901234567");
  assert.throws(() => normalizeQuo("call", { id: "../../secret" }));
  const report = callMetrics([
    e,
    { ...e, id: "AC2", status: "ringing", connected: false, duration: 0 },
    {
      ...e,
      id: "AC3",
      direction: "incoming",
      status: "missed",
      connected: false,
      duration: 0,
    },
  ]);
  assert.equal(report.calls, 3);
  assert.equal(report.terminal, 2);
  assert.equal(report.answered, 1);
  assert.equal(report.missed, 1);
  assert.equal(report.seconds, 60);
});
test("Quo API errors hide provider bodies and never retry SMS automatically", async () => {
  const old = process.env.QUO_API_KEY;
  process.env.QUO_API_KEY = "test-secret";
  let calls = 0;
  try {
    await assert.rejects(
      () =>
        quoRequest(
          "/v1/messages",
          { method: "POST", legacy: true, body: { content: "hello" } },
          (async (url, init) => {
            calls++;
            assert.equal(url, "https://api.quo.com/v1/messages");
            assert.equal(
              new Headers(init?.headers).get("Authorization"),
              "test-secret",
            );
            return new Response("secret echoed in provider error", {
              status: 429,
            });
          }) as typeof fetch,
        ),
      /rate limit/,
    );
    assert.equal(calls, 1);
  } finally {
    if (old === undefined) delete process.env.QUO_API_KEY;
    else process.env.QUO_API_KEY = old;
  }
});
test("Quo database deduplicates events, protects shared access and preserves lead edits", async () => {
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
  ])
    await db.exec(readFileSync("supabase/migrations/" + file, "utf8"));
  await db.exec(
    `insert into auth.users values('00000000-0000-4000-8000-000000000001','info@frontline-x.com',now(),'{"provider":"google"}'),('00000000-0000-4000-8000-000000000002','agent@frontline-x.com',now(),'{"provider":"google"}'),('00000000-0000-4000-8000-000000000003','outside@frontline-x.com',now(),'{"provider":"google"}');insert into public.team_members(email,display_name,role) values('info@frontline-x.com','Admin','Admin'),('agent@frontline-x.com','Agent','Agent');insert into crm_private.quo_state(token_hash) values(encode(sha256(convert_to('test-token','UTF8')),'hex'));`,
  );
  async function identity(n: number) {
    await db.exec("reset role");
    await db.query("select set_config('test.uid',$1,false)", [
      "00000000-0000-4000-8000-00000000000" + n,
    ]);
    await db.exec("set role authenticated");
  }
  async function rpc(name: string, p: unknown) {
    return (
      await db.query<any>(`select to_jsonb(public.${name}($1::jsonb)) result`, [
        JSON.stringify(p),
      ])
    ).rows[0].result;
  }
  async function ingest(
    operation: string,
    payload: unknown,
    token = "test-token",
  ) {
    return (
      await db.query<any>("select public.quo_ingest($1,$2,$3::jsonb) result", [
        token,
        operation,
        JSON.stringify(payload),
      ])
    ).rows[0].result;
  }
  await identity(1);
  const lead = await rpc("save_lead", {
    company: "CRM customer",
    phone: "+14155550123",
    country: "US",
    stage: "New",
    status: "Active",
    priority: "High",
    owner_email: "agent@frontline-x.com",
    notes: "Preserve me",
  });
  await ingest("users", [
    { id: "US1", name: "Quo Person", email: "info@frontline-x.com" },
  ]);
  const event = normalizeQuo("call", {
    id: "AC1",
    direction: "outgoing",
    status: "completed",
    createdAt: "2026-10-09T10:00:00Z",
    updatedAt: "2026-10-09T10:01:00Z",
    answeredAt: "2026-10-09T10:00:01Z",
    duration: 59,
    actorId: "US1",
    participants: [{ phoneNumber: "+14155550123", actorId: null }],
  });
  await ingest("events", { events: [event], delivery: "EV1" });
  const first = (
    await db.query<any>("select * from public.leads where id=$1", [lead.id])
  ).rows[0];
  assert.equal(first.notes, "Preserve me");
  assert.equal(first.stage, "New");
  assert.equal(first.owner_email, "agent@frontline-x.com");
  await ingest("events", { events: [event], delivery: "EV1" });
  await ingest("events", { events: [event] });
  assert.equal(
    (
      await db.query<any>("select version from public.leads where id=$1", [
        lead.id,
      ])
    ).rows[0].version,
    first.version,
  );
  const artifact = normalizeQuo(
    "call",
    {
      callId: "AC1",
      processingStatus: "completed",
      summary: ["Discussed pricing"],
    },
    {},
    "call.summary.completed",
    "2026-10-09T10:02:00Z",
  );
  await ingest("events", { events: [artifact], delivery: "EV2" });
  await ingest("events", {
    events: [
      {
        ...event,
        status: "ringing",
        connected: false,
        duration: 0,
        source_updated_at: "2026-10-09T09:59:00Z",
      },
    ],
    delivery: "EV3",
  });
  const call = (
    await db.query<any>("select * from public.quo_events where id='AC1'")
  ).rows[0];
  assert.equal(call.status, "completed");
  assert.equal(call.duration, 59);
  assert.equal(call.payload.summary.summary[0], "Discussed pricing");
  assert.equal(
    (
      await db.query<any>(
        "select * from public.activities where action='Quo Call'",
      )
    ).rows.length,
    1,
  );
  const inbound = normalizeQuo("message", {
    id: "ACsms",
    direction: "incoming",
    from: "+14155550123",
    to: ["+12125550101"],
    text: "Hello team",
    status: "received",
    createdAt: "2026-10-09T10:03:00Z",
    userId: "US1",
  });
  await ingest("events", { events: [inbound] });
  assert.equal(
    (
      await db.query<any>(
        "select actor_email from public.activities where action='Quo SMS'",
      )
    ).rows[0].actor_email,
    "",
  );
  const unknown = { ...event, id: "ACunknown", phone: "14155550999" };
  await ingest("events", { events: [unknown] });
  await identity(2);
  assert.equal(
    (await db.query("select * from public.quo_events")).rows.length,
    2,
  );
  await assert.rejects(
    () =>
      rpc("quo_manage", {
        operation: "map_user",
        id: "US1",
        email: "agent@frontline-x.com",
      }),
    /Admin/,
  );
  await assert.rejects(
    () => db.exec("update public.quo_events set status='hacked'"),
    /permission/,
  );
  await assert.rejects(
    () => ingest("events", { events: [event] }, "bad-token"),
    /ACCESS/,
  );
  await identity(3);
  assert.equal(
    (await db.query("select * from public.quo_events")).rows.length,
    0,
  );
  const report = (
    await db.query<any>(
      "select public.quo_report('2026-10-01','2026-11-01') result",
    )
  ).rows[0].result;
  assert.equal(report.calls, 0);
  await identity(1);
  await rpc("quo_manage", {
    operation: "link",
    id: "ACunknown",
    lead: lead.id,
  });
  await assert.rejects(
    () =>
      rpc("quo_manage", { operation: "link", id: "ACunknown", lead: lead.id }),
    /already linked/,
  );
  const id = "10000000-0000-4000-8000-000000000001";
  assert.equal(
    (
      await ingest("reserve_sms", {
        id,
        actor: "info@frontline-x.com",
        fingerprint: "body1",
        lead_id: lead.id,
      })
    ).reserved,
    true,
  );
  assert.equal(
    (
      await ingest("reserve_sms", {
        id,
        actor: "info@frontline-x.com",
        fingerprint: "body1",
      })
    ).reserved,
    false,
  );
  await assert.rejects(
    () =>
      ingest("reserve_sms", {
        id,
        actor: "info@frontline-x.com",
        fingerprint: "body2",
        lead_id: lead.id,
      }),
    /mismatch/,
  );
  const queue = await ingest("contacts", { limit: 1 });
  assert.equal(queue.length, 1);
  assert.equal((await ingest("contacts", { limit: 1 })).length, 0);
  await ingest("contact_done", {
    lead: queue[0].lead.id,
    lease: queue[0].lease,
    version: queue[0].version,
    ok: true,
  });
  assert.equal((await ingest("status", {})).pendingContacts, 0);
  const ringing = normalizeQuo("call", {
    id: "ACincomingUnique", direction: "incoming", status: "ringing",
    createdAt: new Date().toISOString(),
  }, { participants: { external: ["+14155550123"] } }, "call.ringing");
  await ingest("events", { events: [ringing] });
  await identity(2);
  const incoming = (await db.query<any>("select lead_id,status,direction from public.quo_events where id='ACincomingUnique'")).rows[0];
  assert.equal(incoming.lead_id, lead.id);
  assert.equal(incoming.status, "ringing");
  assert.equal(incoming.direction, "incoming");
  await identity(1);
  const related = await rpc("save_lead", {
    company: "Related customer",
    phone: "+14155550123",
    country: "US",
    stage: "New",
    status: "Active",
    priority: "High",
    owner_email: "agent@frontline-x.com",
    duplicate_reason: "Separate branch at shared number",
  });
  await ingest("events", { events: [{ ...ringing, id: "ACincomingAmbiguous" }] });
  assert.equal((await db.query<any>("select lead_id from public.quo_events where id='ACincomingAmbiguous'")).rows[0].lead_id, null);
  const chosen = normalizeQuo("message", {
    id: "ACchosen",
    direction: "outgoing",
    from: "+12125550101",
    to: ["+14155550123"],
    text: "Message to selected branch",
    status: "sent",
    createdAt: "2026-10-09T10:05:00Z",
    userId: "US1",
  });
  chosen.lead_id = related.id;
  await ingest("events", { events: [chosen] });
  assert.equal(
    (
      await db.query<any>(
        "select lead_id from public.quo_events where id='ACchosen'",
      )
    ).rows[0].lead_id,
    related.id,
  );
  await db.close();
});

test("Quo pagination uses documented limits and follows every cursor", async () => {
  const old = process.env.QUO_API_KEY;
  process.env.QUO_API_KEY = "test";
  let calls = 0;
  try {
    const result = await quoPages("/calls", false, 5, (async (url) => {
      const u = new URL(String(url));
      assert.equal(u.searchParams.get("limit"), "50");
      calls++;
      return Response.json({
        data: [{ id: "AC" + calls }],
        nextCursor: calls === 1 ? "next-page" : null,
      });
    }) as typeof fetch);
    assert.equal(result.length, 2);
    assert.equal(calls, 2);
  } finally {
    if (old === undefined) delete process.env.QUO_API_KEY;
    else process.env.QUO_API_KEY = old;
  }
});
