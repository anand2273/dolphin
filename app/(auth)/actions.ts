"use server";

import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/auth/supabase-server";
import { ensureProfile } from "@/lib/auth/ensure-profile";
import { getProfile } from "@/lib/auth/session";
import { homeForRole } from "@/lib/auth/roles";
import { logInSchema, signUpSchema } from "@/lib/validation/auth";
import type { FormState } from "@/lib/types";

export async function signUp(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  // 1. parse
  const parsed = signUpSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
    fullName: formData.get("fullName"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
  });
  if (error) return { error: error.message };
  if (!data.user) return { error: "Sign up failed. Please try again." };

  // Second half of the dual-write: self-signup always creates a TUTOR (the
  // paying account). Students are created only via invite acceptance.
  await ensureProfile(
    { id: data.user.id, email: parsed.data.email },
    "tutor",
    parsed.data.fullName,
  );

  redirect("/dashboard");
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
