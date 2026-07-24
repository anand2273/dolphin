import { db } from "@/lib/db/client";
import { profiles } from "@/lib/db/schema";
import type { AuthUser } from "./session";
import type { Role } from "./roles";

/**
 * Provision the domain `profiles` row that mirrors a GoTrue `auth.users` row.
 * Idempotent (onConflictDoNothing). The `role` is REQUIRED and explicit — never
 * defaulted at the call site — because it is the billing/capability boundary:
 * self-signup passes "tutor", invite acceptance passes "student".
 */
export async function ensureProfile(
  user: AuthUser,
  role: Role,
  fullName?: string | null,
) {
  await db
    .insert(profiles)
    .values({
      id: user.id,
      email: user.email.toLowerCase(),
      role,
      fullName: fullName ?? null,
    })
    .onConflictDoNothing({ target: profiles.id });
}
