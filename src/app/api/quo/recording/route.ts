import { authorized, localDemo } from "@/lib/auth";
import { failure, json } from "@/lib/http";
import { quoPages, quoRequest } from "@/lib/quo";
import { z } from "zod";
export async function GET(request: Request) {
  try {
    if (localDemo())
      return json({
        summary: {
          status: "completed",
          summary: ["Synthetic preview: customer discussed service coverage."],
          nextSteps: ["Send the requested information."],
        },
        transcripts: [
          {
            recordingId: "CRdemo",
            status: "completed",
            dialogue: [
              {
                start: 0,
                content: "Synthetic sample conversation",
                identifier: "Customer",
              },
            ],
          },
        ],
        recordings: [],
      });
    const { db } = await authorized();
    const q = new URL(request.url).searchParams;
    const id = z
      .string()
      .regex(/^AC[a-zA-Z0-9_-]+$/)
      .parse(q.get("call"));
    const { data, error } = await db
      .from("quo_events")
      .select("id,kind")
      .eq("id", id)
      .single();
    if (error || !data || data.kind !== "call")
      return json({ error: "Call unavailable" }, 404);
    if (q.get("mode") === "details") {
      const call = await quoRequest(
        "/calls/" + id + "?include=summary,voicemail",
      );
      let transcripts: any[] = [];
      let transcriptError = "";
      try {
        transcripts = await quoPages("/calls/" + id + "/transcripts");
      } catch (e) {
        transcriptError = (e as Error).message;
      }
      const recordings = await quoPages("/calls/" + id + "/recordings");
      return json({
        summary: call.data.summary,
        voicemail: call.data.voicemail
          ? {
              status: call.data.voicemail.status,
              transcript: call.data.voicemail.transcript,
            }
          : undefined,
        transcripts,
        transcriptError,
        recordings: recordings
          .filter((r) => r.status === "completed")
          .map((r) => ({
            id: r.id,
            duration: r.duration,
            url:
              "/api/quo/recording?call=" +
              id +
              "&recording=" +
              encodeURIComponent(r.id),
          })),
      });
    }
    let url: string | undefined;
    if (q.get("voicemail") === "true") {
      const call = await quoRequest("/calls/" + id + "?include=voicemail");
      url = call.data.voicemail?.recordingUrl;
    } else {
      const recordings = await quoPages("/calls/" + id + "/recordings");
      url = recordings.find(
        (r) => r.id === q.get("recording") && r.status === "completed",
      )?.url;
    }
    if (!url || new URL(url).protocol !== "https:")
      return json({ error: "Recording is not available yet" }, 404);
    return new Response(null, {
      status: 307,
      headers: {
        Location: url,
        "Cache-Control": "private, no-store",
        "Referrer-Policy": "no-referrer",
      },
    });
  } catch (e) {
    return failure(e);
  }
}
