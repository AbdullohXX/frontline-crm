import { authorized, localDemo } from "@/lib/auth";
import { sameOrigin, json, failure } from "@/lib/http";
import {serverWorkflow} from "@/lib/server-workflow";
export const maxDuration = 60;
export async function POST(request: Request) {
  try {
    sameOrigin(request);
    if (localDemo())
      return json({ imported: 0, message: "Connect Gmail in the live CRM." });
    const { db, member } = await authorized();
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
    const listing = await google("messages?labelIds=SENT&maxResults=100");
    const rows = [];
    for (let i = 0; i < (listing.messages || []).length; i += 5) {
      const batch = await Promise.all(
        listing.messages.slice(i, i + 5).map(async (m: any) => {
          const d = await google(
            "messages/" +
              encodeURIComponent(m.id) +
              "?format=metadata&metadataHeaders=To&metadataHeaders=Cc&metadataHeaders=Subject",
          );
          const headers = d.payload?.headers || [];
          const recipients = headers
            .filter((h: any) => /^(to|cc)$/i.test(h.name))
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
      rows.push(...batch);
    }
    const imported = await serverWorkflow(member.email,"gmail",rows);
    return json({
      imported,
      scanned: rows.length,
      message:
        "Checked the latest 100 sent emails. Repeated messages are skipped; only matching lead addresses are logged.",
    });
  } catch (e) {
    return failure(e);
  }
}
