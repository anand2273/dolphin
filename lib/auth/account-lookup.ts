import { sql } from "drizzle-orm";
import { db } from "@/lib/db/client";

export type AccountLookup = {
  authUserId: string;
  /** A domain profile exists — the account has been genuinely claimed. */
  claimed: boolean;
};

/**
 * Server-only lookup of the GoTrue account behind an email address, joined to
 * whether it has been claimed (i.e. has a `profiles` row).
 *
 * The distinction matters because `inviteUserByEmail` creates an auth.users row
 * *before* the invitee has proved they control the address. That row is an
 * unclaimed shell: it must never be reachable by self-signup, or anyone who can
 * guess an invited email address could obtain a session as that person and
 * accept their invitation. Email-binding is the whole basis of the invite model.
 */
export async function findAccountByEmail(
  email: string,
): Promise<AccountLookup | null> {
  const rows = (await db.execute(
    sql`select u.id,
               (p.id is not null) as claimed
        from auth.users u
        left join profiles p on p.id = u.id and p.deleted_at is null
        where lower(u.email) = ${email.toLowerCase()}
        limit 1`,
  )) as unknown as { id: string; claimed: boolean }[];

  const row = rows[0];
  return row ? { authUserId: row.id, claimed: row.claimed } : null;
}
