import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db } from "@/lib/db/client";
import { profiles } from "@/lib/db/schema";
import { createSupabaseServerClient } from "./supabase-server";

export type AuthUser = { id: string; email: string };

/** The authenticated Supabase user, or null. Never trusts client-supplied ids. */
export async function getAuthUser(): Promise<AuthUser | null> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || !user.email) return null;
  return { id: user.id, email: user.email };
}

/** Redirects to /login if there is no session. */
export async function requireAuthUser(): Promise<AuthUser> {
  const user = await getAuthUser();
  if (!user) redirect("/login");
  return user;
}

/** The domain profile row for the current user (null if not yet provisioned). */
export async function getProfile(userId: string) {
  const [row] = await db
    .select()
    .from(profiles)
    .where(eq(profiles.id, userId))
    .limit(1);
  return row ?? null;
}
