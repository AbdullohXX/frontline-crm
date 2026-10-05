import { database } from "./supabase/server";
import type { Member } from "./types";
export class HttpError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
export async function authorized(admin = false) {
  const db = await database();
  const {
    data: { user },
    error,
  } = await db.auth.getUser();
  if (error || !user)
    throw new HttpError("Sign in with your company Google account.", 401);
  if (
    !user.email_confirmed_at ||
    !user.email?.toLowerCase().endsWith("@frontline-x.com") ||
    user.app_metadata.provider !== "google"
  )
    throw new HttpError(
      "Use your verified frontline-x.com Google account.",
      403,
    );
  const { data: member, error: memberError } = await db
    .from("team_members")
    .select("*")
    .eq("email", user.email.toLowerCase())
    .eq("active", true)
    .single();
  if (memberError || !member)
    throw new HttpError(
      "Your account is not on the active team list. Ask your administrator.",
      403,
    );
  if (admin && member.role !== "Admin")
    throw new HttpError("Admin access required.", 403);
  return { db, member: member as Member };
}
export function localDemo() {
  return (
    process.env.NODE_ENV !== "production" && process.env.LOCAL_DEMO === "true"
  );
}
