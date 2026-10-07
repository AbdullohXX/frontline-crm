import { z } from "zod";

export const EXPLEE_PROJECT_ID = 43138;
const nullable = z.string().nullable().optional();
export const hotLeadSchema = z
  .object({
    person_id: z.string().min(1),
    campaign_id: z.number().int(),
    name: nullable,
    email: nullable,
    job_title: nullable,
    company_name: nullable,
    company_domain: nullable,
    linkedin_url: nullable,
    country: nullable,
    phone: nullable,
    why_hot: nullable,
    became_hot_at: z.iso.datetime({ offset: true }).nullable().optional(),
  })
  .passthrough();
const pageSchema = z.object({
  leads: z.array(hotLeadSchema),
  total: z.number().int(),
  has_more: z.boolean(),
  next_offset: z.number().int().nullable().optional(),
});

// Freeze since for every page; the database advances it only after the complete run.
export async function fetchHotLeads(
  key: string,
  since: string | null,
  fetcher = fetch,
) {
  const deadline = Date.now() + 210_000;
  async function get(path: string, params: Record<string, string>) {
    if (Date.now() > deadline)
      throw new Error("Explee polling deadline exceeded");
    const url = new URL(`https://api.explee.com/public/api/v1/autogtm/${path}`);
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
    const response = await fetcher(url, {
      headers: { "X-API-Key": key },
      cache: "no-store",
      signal: AbortSignal.timeout(Math.min(60_000, deadline - Date.now())),
    });
    if (!response.ok)
      throw new Error(`Explee request failed (${response.status})`);
    return response.json();
  }
  const campaigns = z
    .object({
      campaigns: z.array(
        z.object({ id: z.number().int(), project_id: z.number().int() }),
      ),
    })
    .parse(await get("campaigns", { project_id: String(EXPLEE_PROJECT_ID) }));
  const allowed = new Set(
    campaigns.campaigns
      .filter((c) => c.project_id === EXPLEE_PROJECT_ID)
      .map((c) => c.id),
  );
  const leads: z.infer<typeof hotLeadSchema>[] = [];
  // Organization feed also retains hot contacts belonging to archived campaigns.
  // Verify unknown campaign ownership using its detail endpoint before accepting it.
  const ownership = new Map<number, boolean>();
  let offset = 0;
  for (let pages = 0; pages < 100; pages++) {
    const page = pageSchema.parse(
      await get("hot-leads", {
        limit: "200",
        offset: String(offset),
        ...(since ? { since } : {}),
      }),
    );
    for (const lead of page.leads) {
      if (!allowed.has(lead.campaign_id) && !ownership.has(lead.campaign_id)) {
        const campaign = z
          .object({ project_id: z.number().int() })
          .parse(await get(`campaigns/${lead.campaign_id}`, {}));
        ownership.set(
          lead.campaign_id,
          campaign.project_id === EXPLEE_PROJECT_ID,
        );
      }
      if (allowed.has(lead.campaign_id) || ownership.get(lead.campaign_id))
        leads.push(lead);
    }
    if (!page.has_more) return leads;
    if (
      page.next_offset == null ||
      page.next_offset <= offset ||
      !page.leads.length
    )
      throw new Error("Invalid Explee pagination; cursor retained");
    offset = page.next_offset;
  }
  throw new Error("Explee page limit reached; cursor retained");
}
