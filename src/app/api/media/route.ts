import { authorized } from "@/lib/auth";
import { failure } from "@/lib/http";
import { z } from "zod";
export async function GET(request: Request) {
  try {
    const id = z.uuid().parse(new URL(request.url).searchParams.get("id"));
    const { db } = await authorized();
    const { data: media, error } = await db
      .from("lead_attachments")
      .select("path")
      .eq("id", id)
      .single();
    if (error || !media) throw Error("Attachment not available.");
    const { data, error: storageError } = await db.storage
      .from("lead-media")
      .createSignedUrl(media.path, 3600);
    if (storageError || !data) throw Error("Media is currently unavailable.");
    return new Response(null, {
      status: 307,
      headers: {
        Location: data.signedUrl,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (e) {
    return failure(e);
  }
}
