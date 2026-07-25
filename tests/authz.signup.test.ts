import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { findAccountByEmail } from "@/lib/auth/account-lookup";
import { createTestUser, deleteTestUser, type TestUser } from "./helpers/seed";

/**
 * Self-signup must never be able to take over an invited-but-unclaimed account.
 *
 * `inviteUserByEmail` creates an auth.users row before the invitee has proved
 * they control the address. With email confirmations disabled, GoTrue's signUp
 * returns a *session* for such a row to any caller — so the only thing standing
 * between an attacker and someone else's pending invitation is this lookup.
 * `signUp` is therefore never reached for an address that already has an
 * account; see app/(auth)/actions.ts.
 */
const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

describe("findAccountByEmail — the self-signup gate", () => {
  let claimed: TestUser;
  let shellEmail: string;
  let shellId: string;

  beforeAll(async () => {
    claimed = await createTestUser("signup-claimed", "student");

    // An unclaimed invite shell: auth.users row, no profile.
    shellEmail = `shell-${Date.now()}@test.local`;
    const { data, error } = await admin.auth.admin.createUser({
      email: shellEmail,
    });
    if (error || !data.user) throw new Error(error?.message);
    shellId = data.user.id;
  });

  afterAll(async () => {
    await deleteTestUser(claimed);
    await admin.auth.admin.deleteUser(shellId);
  });

  it("returns null for an address with no account (signup may proceed)", async () => {
    expect(await findAccountByEmail(`nobody-${Date.now()}@test.local`)).toBeNull();
  });

  it("reports a claimed account so signup is refused", async () => {
    const found = await findAccountByEmail(claimed.email);
    expect(found).toEqual({ authUserId: claimed.id, claimed: true });
  });

  it("BLOCKS signup on an unclaimed invite shell (no profile yet)", async () => {
    const found = await findAccountByEmail(shellEmail);
    expect(found).toEqual({ authUserId: shellId, claimed: false });
  });

  it("matches case-insensitively — casing must not bypass the gate", async () => {
    const found = await findAccountByEmail(shellEmail.toUpperCase());
    expect(found?.authUserId).toBe(shellId);
  });
});
