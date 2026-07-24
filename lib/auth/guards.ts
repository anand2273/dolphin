import { redirect } from "next/navigation";
import { getProfile, requireAuthUser } from "./session";

/**
 * Tutor-only area guard. A real tutor always has a profile (created at signup),
 * so a missing profile means "not a tutor" — we send them to the student home
 * rather than minting a tutor account (which would be a free upgrade).
 */
export async function requireTutor() {
  const user = await requireAuthUser();
  const profile = await getProfile(user.id);
  if (!profile || profile.role !== "tutor") redirect("/student");
  return { user, profile };
}

/**
 * Student-area guard. Tolerates a not-yet-provisioned profile (an invited user
 * who confirmed their email but hasn't accepted yet can still see and accept
 * their pending invites here). Only tutors are bounced away.
 */
export async function requireStudent() {
  const user = await requireAuthUser();
  const profile = await getProfile(user.id);
  if (profile?.role === "tutor") redirect("/dashboard");
  return { user, profile };
}
