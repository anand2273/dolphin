"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { invitations, profiles } from "@/lib/db/schema";
import { requireAuthUser } from "@/lib/auth/session";
import { assertClassOwner, AuthzError } from "@/lib/auth/authz";
import { findAccountByEmail } from "@/lib/auth/account-lookup";
import { createClient } from "@supabase/supabase-js";
import { createSupabaseAdminClient } from "@/lib/auth/supabase-admin";
import { recordEvent } from "@/lib/db/events";
import { generateInviteToken } from "@/lib/tokens";
import { inviteStudentSchema } from "@/lib/validation/invite";
import type { FormState } from "@/lib/types";

const INVITE_TTL_DAYS = 7;

async function requestOrigin(): Promise<string> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? "http";
  return `${proto}://${host}`;
}

/** Invite a student by email to a class. Owner-only. */
export async function inviteStudent(
  classId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  // 1. parse
  const parsed = inviteStudentSchema.safeParse({ email: formData.get("email") });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const email = parsed.data.email;

  // 2. authorize — only the class owner may invite.
  const user = await requireAuthUser();
  try {
    await assertClassOwner(user.id, classId);
  } catch (e) {
    if (e instanceof AuthzError) return { error: "Not authorized" };
    throw e;
  }

  // Look up any existing account for this email.
  const [existingProfile] = await db
    .select({ id: profiles.id, role: profiles.role })
    .from(profiles)
    .where(and(eq(sql`lower(${profiles.email})`, email), isNull(profiles.deletedAt)))
    .limit(1);

  // Strict separation: a tutor account can never be added as a student.
  if (existingProfile?.role === "tutor") {
    return { error: "That email already has a tutor account." };
  }

  // 3. mutate — resend-aware. If a live pending invite already exists for this
  // class+email, rotate its token and extend it (so pressing "Send invite"
  // again re-sends); otherwise insert a new one.
  const { raw, hash } = generateInviteToken();
  const expiresAt = new Date(Date.now() + INVITE_TTL_DAYS * 24 * 3600 * 1000);

  const [pending] = await db
    .select({ id: invitations.id })
    .from(invitations)
    .where(
      and(
        eq(invitations.classId, classId),
        eq(sql`lower(${invitations.email})`, email),
        eq(invitations.status, "pending"),
        isNull(invitations.deletedAt),
      ),
    )
    .limit(1);

  let invitationId: string;
  if (pending) {
    await db
      .update(invitations)
      .set({ tokenHash: hash, expiresAt, updatedAt: new Date() })
      .where(eq(invitations.id, pending.id));
    invitationId = pending.id;
  } else {
    const [created] = await db
      .insert(invitations)
      .values({ classId, email, tokenHash: hash, invitedByUserId: user.id, expiresAt })
      .returning({ id: invitations.id });
    invitationId = created.id;
  }

  await recordEvent({
    actorId: user.id,
    verb: "invitation.created",
    subjectType: "invitation",
    subjectId: invitationId,
  });

  // Send the email. An existing STUDENT account already has a login and will see
  // the invite in-app on /student, so no email is needed. Otherwise send the
  // Supabase invite — but if an abandoned, unaccepted auth shell is blocking it
  // (profile-less, from a prior invite), delete that shell first so the email
  // actually goes out. Errors are surfaced, never swallowed.
  // The emailed link must land on /auth/confirm on the SAME origin the tutor is
  // using, because that is where verifyOtp's session cookie gets set. The email
  // template builds its href from this URL (not from Supabase's site_url), so
  // the whole chain — confirm, then accept — stays on one host. `next` is a
  // path, never an absolute URL; base64url tokens contain no `&` or `#`, so it
  // needs no percent-encoding and survives the template's URL normalizer.
  const confirmUrl = `${await requestOrigin()}/auth/confirm?next=/invite/accept/${raw}`;
  if (existingProfile?.role === "student") {
    // Existing student account — Supabase can't "invite" an existing user, so
    // send a magic link. Clicking it signs them in and lands on the join page,
    // where they one-click join the class.
    const anon = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
    const { error } = await anon.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: confirmUrl, shouldCreateUser: false },
    });
    if (error) {
      return { error: `Couldn't send the invite email: ${error.message}` };
    }
  } else {
    // No profile yet. Send the Supabase invite (which creates the account). If a
    // confirmed-but-unaccepted auth shell is blocking it, remove that abandoned
    // shell first so the invite email actually sends.
    const admin = createSupabaseAdminClient();
    const shell = await findAccountByEmail(email);
    if (shell && !shell.claimed) {
      await admin.auth.admin.deleteUser(shell.authUserId);
    }
    const { error } = await admin.auth.admin.inviteUserByEmail(email, {
      redirectTo: confirmUrl,
    });
    if (error) {
      return { error: `Couldn't send the invite email: ${error.message}` };
    }
  }

  // 4. revalidate
  revalidatePath(`/classes/${classId}`);
  return { ok: true };
}

/** Revoke a pending invitation. Owner-only. */
export async function revokeInvitation(invitationId: string): Promise<void> {
  const user = await requireAuthUser();

  const [invite] = await db
    .select({ id: invitations.id, classId: invitations.classId })
    .from(invitations)
    .where(eq(invitations.id, invitationId))
    .limit(1);
  if (!invite) return;

  await assertClassOwner(user.id, invite.classId);

  await db
    .update(invitations)
    .set({ status: "revoked", updatedAt: new Date() })
    .where(and(eq(invitations.id, invitationId), eq(invitations.status, "pending")));

  revalidatePath(`/classes/${invite.classId}`);
}
