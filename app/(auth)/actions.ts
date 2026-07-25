"use server";

import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/auth/supabase-server";
import { findAccountByEmail } from "@/lib/auth/account-lookup";
import { ensureProfile } from "@/lib/auth/ensure-profile";
import { getProfile } from "@/lib/auth/session";
import { homeForRole, type Role } from "@/lib/auth/roles";
import { logInSchema, signUpSchema } from "@/lib/validation/auth";
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

export async function signOut() {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  redirect("/login");
}
