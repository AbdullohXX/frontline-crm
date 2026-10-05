import { NextResponse } from "next/server";
import { HttpError } from "./auth";
import { message } from "./validation";
export function json(data: unknown, status = 200) {
  return NextResponse.json(data, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
}
export function failure(error: unknown) {
  return json(
    { error: message(error) },
    error instanceof HttpError ? error.status : 400,
  );
}
export function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin || origin !== new URL(request.url).origin)
    throw new HttpError("Request origin is not allowed.", 403);
}
export async function body(request: Request, max = 100000) {
  const raw = await request.text();
  if (raw.length > max) throw new HttpError("Request is too large.", 413);
  return JSON.parse(raw);
}
