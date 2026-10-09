import { NextResponse } from "next/server";
import { authorized } from "@/lib/auth";
export async function GET() {
  try {
    const { db, member } = await authorized();
    const { data, error } = await db.auth.signInWithOAuth({
      provider: "google",
      options: {
        scopes: "https://www.googleapis.com/auth/gmail.metadata",
        redirectTo: new URL("/auth/callback", process.env.APP_URL!).toString(),
        queryParams: {
          hd: "frontline-x.com",
          login_hint: member.email,
          prompt: "consent",
          include_granted_scopes: "true",
        },
      },
    });
    if (error || !data.url) throw Error();
    return NextResponse.redirect(data.url);
  } catch {
    return NextResponse.json(
      { error: "Could not connect Gmail. Sign in first." },
      { status: 400 },
    );
  }
}
