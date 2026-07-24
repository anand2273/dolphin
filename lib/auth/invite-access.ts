/**
 * Pure, side-effect-free authorization for accepting an invitation. Kept
 * separate from the Server Action so the security logic is unit-testable
 * without a live session. This is the CP3 crux: a forwarded link opened by the
 * wrong person, or a stale/used invite, must be rejected here.
 */

export type InviteRejection =
  | "not_found"
  | "wrong_email"
  | "expired"
  | "revoked"
  | "already_accepted";

export type InvitationFacts = {
  email: string;
  status: "pending" | "accepted" | "revoked" | "expired";
  expiresAt: Date;
};

export function evaluateInviteAcceptance(params: {
  invitation: InvitationFacts | null;
  userEmail: string;
  now?: Date;
}): { ok: true } | { ok: false; reason: InviteRejection } {
  const { invitation, userEmail } = params;
  const now = params.now ?? new Date();

  if (!invitation) return { ok: false, reason: "not_found" };
  if (invitation.status === "revoked") return { ok: false, reason: "revoked" };
  if (invitation.status === "accepted") {
    return { ok: false, reason: "already_accepted" };
  }
  if (invitation.status !== "pending") return { ok: false, reason: "expired" };
  if (invitation.expiresAt.getTime() <= now.getTime()) {
    return { ok: false, reason: "expired" };
  }
  // The lock: the authenticated user must control the invited address.
  if (invitation.email.toLowerCase() !== userEmail.toLowerCase()) {
    return { ok: false, reason: "wrong_email" };
  }
  return { ok: true };
}

/** Human-readable message for each rejection (shown on the accept page). */
export function inviteRejectionMessage(reason: InviteRejection): string {
  switch (reason) {
    case "not_found":
      return "This invitation link is invalid.";
    case "wrong_email":
      return "This invitation was sent to a different email address. Sign in with the invited address to accept it.";
    case "expired":
      return "This invitation has expired. Ask your tutor to send a new one.";
    case "revoked":
      return "This invitation has been withdrawn by your tutor.";
    case "already_accepted":
      return "This invitation has already been used.";
  }
}
