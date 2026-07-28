"use server";

import { redirect } from "next/navigation";
import { createClient } from "@supabase/supabase-js";
import { createSupabaseServerClient } from "@/lib/auth/supabase-server";
import { findAccountByEmail } from "@/lib/auth/account-lookup";
import { ensureProfile } from "@/lib/auth/ensure-profile";
import { getAuthUser, getProfile } from "@/lib/auth/session";
import { requestOrigin } from "@/lib/auth/origin";
import {
  clearRecoverySession,
  hasRecoverySession,
} from "@/lib/auth/recovery";
import { homeForRole, type Role } from "@/lib/auth/roles";
import { recordEvent } from "@/lib/db/events";
import {
  logInSchema,
  requestPasswordResetSchema,
  resetPasswordSchema,
  signUpSchema,
} from "@/lib/validation/auth";
import type { FormState } from "@/lib/types";

/**
 * Shared self-signup. Role is decided by WHICH entry point called this, never
 * by client input: `/signup` -> tutor (paying), `/signup/student` -> student.
 * Students can create an account freely, but can only JOIN a class by invite.
 */
async function createAccount(
  formData: FormData,
  role: Role,
): Promise<FormState> {
  const parsed = signUpSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
    fullName: formData.get("fullName"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  // Refuse self-signup for an address that already has a GoTrue account. This
  // is a security gate, not a convenience check: for an UNCLAIMED invite shell
  // (auth.users row created by inviteUserByEmail, no profile yet, not confirmed)
  // GoTrue happily returns a *session* to whoever calls signUp — without ever
  // verifying email control — which would let anyone who guesses an invited
  // address accept that person's invitation. It also leaves the account
  // confirmed but password-less, permanently locking the real invitee out.
  const existing = await findAccountByEmail(parsed.data.email);
  if (existing) {
    return {
      error: existing.claimed
        ? "That email already has an account. Sign in instead."
        : "That email has a pending class invitation. Open the link in your invitation email to finish setting up your account, or ask your tutor to resend it.",
    };
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
  });
  if (error) return { error: error.message };
  if (!data.user) return { error: "Sign up failed. Please try again." };

  // Second half of the dual-write: create the domain profile with its role.
  await ensureProfile(
    { id: data.user.id, email: parsed.data.email },
    role,
    parsed.data.fullName,
  );

  redirect(homeForRole(role));
}

export async function signUp(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  return createAccount(formData, "tutor");
}

export async function signUpStudent(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  return createAccount(formData, "student");
}

export async function logIn(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = logInSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  });
  if (error) return { error: "Incorrect email or password." };

  const profile = data.user ? await getProfile(data.user.id) : null;
  redirect(homeForRole(profile?.role));
}

/**
 * Step 1 of password reset: email a recovery link.
 *
 * The response is deliberately the same whether or not the address has an
 * account. /signup does the opposite — it tells you outright that an address is
 * taken — but that is a security gate against invite-shell hijacking, paid for
 * knowingly. Here there is nothing to buy with the disclosure, so this endpoint
 * is not turned into an account-enumeration oracle.
 *
 * `redirectTo` is built from the request's own origin (see requestOrigin), so
 * the confirm hop and the reset page share the host that will hold the session
 * cookie. `next` is a path, never an absolute URL. Note this means a preview
 * deployment mints a preview-host link, which GoTrue rejects unless the Vercel
 * wildcard is on the redirect allowlist — and a rejected `redirectTo` does not
 * error, it silently falls back to Site URL. See deploy.md §4.
 */
export async function requestPasswordReset(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = requestPasswordResetSchema.safeParse({
    email: formData.get("email"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  // A plain anon client, NOT createSupabaseServerClient: @supabase/ssr defaults
  // to the PKCE flow, which emails a `pkce_`-prefixed token that must be
  // exchanged together with a code verifier held in the cookies of the browser
  // that made the request. /auth/confirm verifies with `verifyOtp({ token_hash
  // })`, so a PKCE token cannot be verified there at all — the link dies at the
  // confirm hop. `flowType` is pinned rather than left to the default so this
  // cannot quietly become PKCE again in a later supabase-js release.
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      auth: {
        flowType: "implicit",
        persistSession: false,
        autoRefreshToken: false,
      },
    },
  );
  const { error } = await supabase.auth.resetPasswordForEmail(parsed.data.email, {
    redirectTo: `${await requestOrigin()}/auth/confirm?next=/reset-password`,
  });

  // GoTrue already returns success for an unknown address, so surfacing the
  // error leaks nothing about who has an account — it only reports the things
  // that genuinely went wrong (rate limit, SMTP down), which would otherwise be
  // an invisible failure the user reads as "the email is on its way".
  if (error) return { error: error.message };

  return { ok: true };
}

/**
 * Step 2 of password reset: write the new password.
 *
 * Authorization is two conditions, not one. A session alone is not enough —
 * that would make this page a change-password form with no old-password prompt,
 * usable against any unattended signed-in browser. The caller must also hold the
 * recovery marker minted by /auth/confirm for *this* user.
 */
export async function resetPassword(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  // 1. parse
  const parsed = resetPasswordSchema.safeParse({
    password: formData.get("password"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  // 2. authorize
  const user = await getAuthUser();
  if (!user || !(await hasRecoverySession(user.id))) {
    return {
      error:
        "This reset link has expired. Request a new one and use the link in the email.",
    };
  }

  // 3. mutate
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.updateUser({
    password: parsed.data.password,
  });
  if (error) return { error: error.message };

  // Spend the marker, then cut every OTHER session loose. Someone resetting
  // because they think their account was reached should not leave the intruder
  // holding a live refresh token; `scope: "others"` keeps this browser signed in.
  await clearRecoverySession();
  await supabase.auth.signOut({ scope: "others" });

  // An account recovered from an unclaimed invitation shell has no profile row
  // yet, and events.actor_id is a foreign key — record the act without an actor
  // rather than skipping the audit line.
  const profile = await getProfile(user.id);
  await recordEvent({
    actorId: profile ? user.id : null,
    verb: "password.reset",
    subjectType: "profile",
    subjectId: user.id,
  });

  redirect(homeForRole(profile?.role));
}

export async function signOut() {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  redirect("/login");
}
