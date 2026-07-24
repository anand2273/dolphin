"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { enrollments, invitations } from "@/lib/db/schema";
import { requireAuthUser, getProfile, type AuthUser } from "@/lib/auth/session";
import { ensureProfile } from "@/lib/auth/ensure-profile";
import { createSupabaseServerClient } from "@/lib/auth/supabase-server";
import { recordEvent } from "@/lib/db/events";
import {
  getInvitationById,
  getInvitationByToken,
} from "@/lib/db/queries/invitations";
import {
  evaluateInviteAcceptance,
  inviteRejectionMessage,
  type InvitationFacts,
} from "@/lib/auth/invite-access";
import { acceptInviteSchema } from "@/lib/validation/invite";
import type { FormState } from "@/lib/types";

type Invitation = typeof invitations.$inferSelect;

/** Shared enrollment + invite-consumption + event, atomically. */
async function finalizeAcceptance(
  user: AuthUser,
  invitation: Invitation,
  fullName?: string,
) {
  await db.transaction(async (tx) => {
    await ensureProfile(user, "student", fullName);
    await tx
      .insert(enrollments)
      .values({ classId: invitation.classId, studentId: user.id })
      .onConflictDoNothing();
    await tx
      .update(invitations)
      .set({
        status: "accepted",
        acceptedByUserId: user.id,
        acceptedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(
        and(eq(invitations.id, invitation.id), eq(invitations.status, "pending")),
      );
    await recordEvent(
      {
        actorId: user.id,
        verb: "enrollment.created",
        subjectType: "enrollment",
        subjectId: invitation.classId,
        payload: { invitationId: invitation.id },
      },
      tx,
    );
  });
}

function facts(inv: Invitation): InvitationFacts {
  return { email: inv.email, status: inv.status, expiresAt: inv.expiresAt };
}

/**
 * Email-link path (new student): token identifies the invite, the student sets
 * a password, and `evaluateInviteAcceptance` enforces the email-control gate.
 */
export async function acceptInvitation(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = acceptInviteSchema.safeParse({
    token: formData.get("token"),
    password: formData.get("password") ?? undefined,
    fullName: formData.get("fullName") ?? undefined,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const user = await requireAuthUser();
  const row = await getInvitationByToken(parsed.data.token);
  const verdict = evaluateInviteAcceptance({
    invitation: row ? facts(row.invitation) : null,
    userEmail: user.email,
  });
  if (!verdict.ok) return { error: inviteRejectionMessage(verdict.reason) };

  // Strict separation: a tutor account cannot join a class as a student.
  const existing = await getProfile(user.id);
  if (existing?.role === "tutor") {
    return { error: "This email has a tutor account and can't join as a student." };
  }

  if (parsed.data.password) {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.updateUser({
      password: parsed.data.password,
      data: parsed.data.fullName ? { full_name: parsed.data.fullName } : undefined,
    });
    if (error) return { error: error.message };
  }

  await finalizeAcceptance(user, row!.invitation, parsed.data.fullName);
  redirect("/student");
}

/**
 * In-app path (already-authenticated user, e.g. invited to a second class):
 * no token, no password. Authorized by invitation id + email match.
 */
export async function acceptPendingInvite(invitationId: string): Promise<void> {
  const user = await requireAuthUser();
  const invitation = await getInvitationById(invitationId);
  const verdict = evaluateInviteAcceptance({
    invitation: invitation ? facts(invitation) : null,
    userEmail: user.email,
  });
  if (!verdict.ok) {
    // Nothing to accept (revoked/expired/not theirs) — refresh the list.
    revalidatePath("/student");
    return;
  }

  // A tutor account can't join as a student.
  const existing = await getProfile(user.id);
  if (existing?.role === "tutor") redirect("/dashboard");

  await finalizeAcceptance(user, invitation!);
  redirect("/student");
}
