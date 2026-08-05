import { cache } from "react";
import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "@/lib/db/client";
import { profiles } from "@/lib/db/schema";
import {
  IDENTITY_HEADER_USER_EMAIL,
  IDENTITY_HEADER_USER_ID,
} from "./identity-headers";
import { createSupabaseServerClient } from "./supabase-server";

export type AuthUser = { id: string; email: string };

/**
 * The authenticated Supabase user, or null. Never trusts client-supplied ids.
 * cache(): the shell layout and the page both resolve the viewer in the same
 * request; memoizing keeps that to one lookup per request.
 *
 * Middleware has already verified the session for this same request, so we read
 * its result off the forwarded headers instead of asking GoTrue again — over a
 * cross-region link that second round trip was pure latency. Those headers are
 * only trustworthy because middleware strips any inbound copy; see
 * ./identity-headers.
 *
 * The fallback is not dead code: it covers requests that reach a Server
 * Component without middleware having established a session — notably
 * /auth/confirm, which mints its session mid-request via verifyOtp, after
 * middleware has already run and seen no user.
 */
export const getAuthUser = cache(async (): Promise<AuthUser | null> => {
  const requestHeaders = await headers();
  const id = requestHeaders.get(IDENTITY_HEADER_USER_ID);
  const email = requestHeaders.get(IDENTITY_HEADER_USER_EMAIL);
  if (id && email) return { id, email };

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || !user.email) return null;
  return { id: user.id, email: user.email };
});

/** Redirects to /login if there is no session. */
export async function requireAuthUser(): Promise<AuthUser> {
  const user = await getAuthUser();
  if (!user) redirect("/login");
  return user;
}

/** The domain profile row for the current user (null if not yet provisioned).
 *  cache(): see getAuthUser — layout and page ask for the same row. */
export const getProfile = cache(async (userId: string) => {
  const [row] = await db
    .select()
    .from(profiles)
    .where(eq(profiles.id, userId))
    .limit(1);
  return row ?? null;
});
