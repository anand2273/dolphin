import { cookies } from "next/headers";

/**
 * Marks a session as having arrived through a password-recovery email link.
 *
 * A recovery link IS a sign-in: `verifyOtp` hands back an ordinary session, so
 * nothing in the session itself separates "just clicked the reset email" from
 * "signed in with a password an hour ago". Without this marker, /reset-password
 * would double as a change-password page that never asks for the old password —
 * walk up to any signed-in browser and take the account over. GoTrue will not
 * ask either, because `secure_password_change` is off.
 *
 * The cookie stores the user id it was minted for, so a marker left behind by
 * whoever used the browser before cannot be spent by the next account.
 *
 * This is a flow gate, not a cryptographic one: it is httpOnly, so page script
 * cannot forge it, but someone already sitting at an unlocked browser with
 * devtools open could. That is a far higher bar than "click Reset password",
 * and the real fix — an in-app change-password that re-prompts for the current
 * one — belongs with the profile-editing UI (US-T13), which is not built.
 */
const RECOVERY_COOKIE = "dolphn-recovery";

/** Long enough to choose a password, short enough not to sit around. */
const RECOVERY_TTL_SECONDS = 15 * 60;

/** Called by /auth/confirm after a `type=recovery` link verifies. */
export async function markRecoverySession(userId: string) {
  const store = await cookies();
  store.set(RECOVERY_COOKIE, userId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: RECOVERY_TTL_SECONDS,
  });
}

/** True only for the user the marker was minted for. */
export async function hasRecoverySession(userId: string): Promise<boolean> {
  const store = await cookies();
  return store.get(RECOVERY_COOKIE)?.value === userId;
}

/** Spent as soon as the new password is written — the marker is single-use. */
export async function clearRecoverySession() {
  const store = await cookies();
  store.delete(RECOVERY_COOKIE);
}
