import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
export function configured() {
  return (
    !!process.env.NEXT_PUBLIC_SUPABASE_URL &&
    !!process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  );
}
export async function database() {
  if (!configured())
    throw new Error(
      "Supabase is not configured. Follow README.md to connect the database.",
    );
  const store = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll: () => store.getAll(),
        setAll(values) {
          values.forEach(({ name, value, options }) =>
            store.set(name, value, options),
          );
        },
      },
    },
  );
}
