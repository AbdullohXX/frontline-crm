import { NextResponse } from "next/server";
import { database } from "@/lib/supabase/server";
import { authorized } from "@/lib/auth";
export async function GET(request: Request) {
  const origin = process.env.APP_URL || new URL(request.url).origin;
  try {
    const code = new URL(request.url).searchParams.get("code");
    if (!code) throw new Error("Missing code");
    const db = await database();
    const { error } = await db.auth.exchangeCodeForSession(code);
    if (error) throw error;
    await authorized();
    return NextResponse.redirect(new URL("/", origin));
  } catch {
    const db = await database();
    await db.auth.signOut();
    return NextResponse.redirect(new URL("/?auth=denied", origin));
  }
}
