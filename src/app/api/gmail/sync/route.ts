import { authorized, localDemo } from "@/lib/auth";
import { sameOrigin, json, failure } from "@/lib/http";
import { z } from "zod";
import { serverWorkflow } from "@/lib/server-workflow";
export const maxDuration = 60;
export async function POST(request: Request) {
  try {
    sameOrigin(request);
    if (localDemo())
      return json({ imported: 0, message: "Connect Gmail in the live CRM." });
    const { db, member } = await authorized();
    const raw = await request.text();
    if (raw.length > 12000) throw Error("Request too large");
    const input = z
      .object({ page_token: z.string().max(10000).optional() })
      .parse(raw ? JSON.parse(raw) : {});
    const { data } = await db.auth.getSession();
    const token = data.session?.provider_token;
    if (!token)
      return json(
        { error: "Connect Gmail to grant access to your sent-email metadata." },
        409,
      );
    async function google(path: string) {
      const r = await fetch(
        "https://gmail.googleapis.com/gmail/v1/users/me/" + path,
        {
          headers: { Authorization: "Bearer " + token },
          cache: "no-store",
          signal: AbortSignal.timeout(15000),
        },
      );
      if (!r.ok)
        throw Error(
          "Gmail access unavailable. Reconnect Gmail; your administrator may need to enable Gmail API and allow the Gmail metadata scope.",
        );
      return r.json();
    }
    const profile = await google("profile");
    if (profile.emailAddress.toLowerCase() !== member.email)
      throw Error("Connect the same company mailbox as your CRM account.");
    const listing = await google(
      "messages?labelIds=SENT&maxResults=100" +
        (input.page_token
          ? "&pageToken=" + encodeURIComponent(input.page_token)
          : ""),
    );
    const rows = [];
    for (let i = 0; i < (listing.messages || []).length; i += 5) {
      const batch = await Promise.all(
        listing.messages.slice(i, i + 5).map(async (m: any) => {
          const d = await google(
            "messages/" +
              encodeURIComponent(m.id) +
              "?format=metadata&metadataHeaders=To&metadataHeaders=Cc&metadataHeaders=Bcc&metadataHeaders=Subject",
          );
          if (!d.labelIds?.includes("SENT")) return null;
          const headers = d.payload?.headers || [];
          const recipients = headers
            .filter((h: any) => /^(to|cc|bcc)$/i.test(h.name))
            .flatMap(
              (h: any) =>
                h.value.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || [],
            );
          return {
            id: d.id,
            subject:
              headers.find((h: any) => h.name.toLowerCase() === "subject")
                ?.value || "",
            recipients,
            sent_at: new Date(Number(d.internalDate)).toISOString(),
          };
        }),
      );
      rows.push(...batch.filter(Boolean));
    }
    const imported = await serverWorkflow(member.email, "gmail", rows);
    return json({
      imported,
      nextPageToken: listing.nextPageToken || null,
      scanned: rows.length,
      message: listing.nextPageToken
        ? "Checked 100 sent emails. Older messages remain; use Check older sent emails."
        : "Finished checking this mailbox page. Only matching lead/contact addresses are logged.",
    });
  } catch (e) {
    return failure(e);
  }
}
