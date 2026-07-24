import { db } from "@/lib/db/client";
import { profiles } from "@/lib/db/schema";
import type { AuthUser } from "./session";

/**
 * Provision the domain `profiles` row that mirrors a GoTrue `auth.users` row.
 * Idempotent: safe to call on every authenticated request. This is the second
 * half of the signup dual-write (GoTrue creates auth.users; we create profiles).
 */
export async function ensureProfile(user: AuthUser, fullName?: string | null) {
  await db
    .insert(profiles)
    .values({
      id: user.id,
      email: user.email.toLowerCase(),
      fullName: fullName ?? null,
    })
    .onConflictDoNothing({ target: profiles.id });
}
