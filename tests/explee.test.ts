import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { fetchHotLeads } from "../src/lib/explee.js";
test("Explee pages keep cursor fixed, scope campaigns and fail safely", async () => {
  const requests: URL[] = [];
  const since = "2026-10-01T00:00:00Z";
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    requests.push(url);
    assert.equal(
      (init?.headers as Record<string, string>)["X-API-Key"],
      "test-key",
    );
    if (url.pathname.endsWith("/campaigns"))
      return Response.json({ campaigns: [{ id: 7, project_id: 43138 }] });
    if (url.pathname.endsWith("/campaigns/8"))
      return Response.json({ project_id: 99 });
    assert.equal(url.searchParams.get("since"), since);
    const offset = Number(url.searchParams.get("offset"));
    return Response.json({
      leads: [{ person_id: String(offset), campaign_id: offset === 0 ? 8 : 7 }],
      total: 2,
      has_more: offset === 0,
      next_offset: offset === 0 ? 1 : null,
    });
  };
  assert.deepEqual(
    (await fetchHotLeads("test-key", since, fetcher)).map((l) => l.person_id),
    ["1"],
  );
  assert.equal(requests[0].searchParams.get("project_id"), "43138");
  await assert.rejects(
    () =>
      fetchHotLeads(
        "test-key",
        since,
        async () => new Response(null, { status: 429 }),
      ),
    /429/,
  );
});
test("Explee RPC enforces token, lease, dedup and atomic cursor/audit rollback", async () => {
  const db = new PGlite();
  try {
    await db.exec(
      `create role anon; create role authenticated; create schema auth; create table auth.users(id uuid,email text,email_confirmed_at timestamptz,raw_app_meta_data jsonb);create function auth.uid() returns uuid language sql as $$select null::uuid$$;grant usage on schema public to anon,authenticated;`,
    );
    await db.exec(readFileSync("supabase/migrations/001_crm.sql", "utf8"));
    await db.exec(
      readFileSync(
        "supabase/migrations/20261007134652_explee_hot_leads.sql",
        "utf8",
      ),
    );
    await db.query(
      "insert into public.team_members(email,display_name,role) values ('info@frontline-x.com','Admin','Admin')",
    );
    await db.query(
      "insert into crm_private.explee_state(project_id,token_hash,owner_email) values (43138,$1,'info@frontline-x.com')",
      [createHash("sha256").update("secret").digest("hex")],
    );
    async function rpc(op: string, payload: unknown = {}, token = "secret") {
      return (
        await db.query<{ r: any }>(
          "select public.explee_sync($1,$2,$3::jsonb) r",
          [token, op, JSON.stringify(payload)],
        )
      ).rows[0].r;
    }
    await db.exec("set role anon");
    await assert.rejects(() => rpc("acquire", {}, "bad"), /ACCESS/);
    await assert.rejects(
      () => db.query("select * from crm_private.explee_state"),
      /permission/,
    );
    const state = await rpc("acquire");
    assert.equal(await rpc("acquire"), null);
    const lead = {
      person_id: "p1",
      campaign_id: 7,
      email: "Person@example.test",
      name: "Person",
      company_name: "Acme",
      company_domain: "acme.test",
      linkedin_url: "https://linkedin.com/in/person",
      why_hot: "Yes, let's talk!",
      became_hot_at: "2026-10-07T10:00:00Z",
    };
    await assert.rejects(
      () => rpc("commit", { lease: "wrong", project_id: 43138, leads: [lead] }),
      /lease/,
    );
    const first = await rpc("commit", {
      lease: state.lease,
      project_id: 43138,
      leads: [lead],
    });
    assert.equal(first.created, 1);
    const retry = await rpc("acquire");
    assert.equal(
      (
        await rpc("commit", {
          lease: retry.lease,
          project_id: 43138,
          leads: [lead],
        })
      ).processed,
      0,
    );
    const next = await rpc("acquire");
    assert.equal(
      (
        await rpc("commit", {
          lease: next.lease,
          project_id: 43138,
          leads: [
            {
              ...lead,
              person_id: "p2",
              campaign_id: 8,
              became_hot_at: "2026-10-07T11:00:00Z",
            },
          ],
        })
      ).matched,
      1,
    );
    await db.exec("reset role");
    assert.equal((await db.query("select * from public.leads")).rows.length, 1);
    assert.equal(
      (await db.query("select * from public.explee_hot_leads")).rows.length,
      2,
    );
    await db.exec(
      "create function public.reject_sync_audit() returns trigger language plpgsql as $$begin raise exception 'audit failed';end$$;create trigger reject_sync before insert on public.activities for each row execute function public.reject_sync_audit();set role anon;",
    );
    const failing = await rpc("acquire");
    await assert.rejects(
      () =>
        rpc("commit", {
          lease: failing.lease,
          project_id: 43138,
          leads: [
            {
              ...lead,
              person_id: "p3",
              email: "other@example.test",
              linkedin_url: null,
              became_hot_at: "2026-10-07T12:00:00Z",
            },
          ],
        }),
      /audit failed/,
    );
    await rpc("release", { lease: failing.lease });
    const after = await rpc("acquire");
    assert.equal(after.cursor, failing.cursor);
    await db.exec("reset role");
    assert.equal((await db.query("select * from public.leads")).rows.length, 1);
  } finally {
    await db.close();
  }
});
