import { NextResponse } from "next/server";
import { database } from "@/lib/supabase/server";
export async function GET() {
  try {
    const origin = process.env.APP_URL;
    if (!origin) throw new Error("APP_URL is missing");
    const db = await database();
    const { data, error } = await db.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: new URL("/auth/callback", origin).toString(),
        queryParams: { hd: "frontline-x.com", prompt: "select_account" },
      },
    });
    if (error || !data.url) throw new Error("Google sign-in is unavailable");
    return NextResponse.redirect(data.url);
  } catch {
    return NextResponse.json(
      { error: "Configure Supabase Google OAuth and APP_URL first." },
      { status: 503 },
    );
  }
}
