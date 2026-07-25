"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { sessions } from "@/lib/db/schema";
import { requireAuthUser } from "@/lib/auth/session";
import { assertClassOwner, AuthzError } from "@/lib/auth/authz";
import { getSessionForViewer } from "@/lib/db/queries/sessions";
import { recordEvent } from "@/lib/db/events";
import { updateSessionSchema } from "@/lib/validation/session";
import type { FormState } from "@/lib/types";

/**
 * Both mutations resolve the session through `getSessionForViewer` FIRST, then
 * re-assert ownership of the class it belongs to. The session id from the form
 * is never trusted to imply anything: an enrolled student can read this session
 * but must not be able to edit or delete it, and an unrelated user must not even
 * learn that the id exists.
 */
async function ownedSession(sessionId: string) {
  const user = await requireAuthUser();
  const found = await getSessionForViewer(user.id, sessionId);
  if (!found) return null;
  await assertClassOwner(user.id, found.session.classId);
  return { user, ...found };
}

/** Edit a session's title or scheduled time. Owner-only. */
export async function updateSession(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  // 1. parse
  const parsed = updateSessionSchema.safeParse({
    sessionId: formData.get("sessionId"),
    title: formData.get("title") ?? undefined,
    scheduledAt: formData.get("scheduledAt"),
    timezone: formData.get("timezone"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  // 2. authorize
  let owned;
  try {
    owned = await ownedSession(parsed.data.sessionId);
  } catch (e) {
    if (e instanceof AuthzError) return { error: "Not authorized" };
    throw e;
  }
  if (!owned) return { error: "Not authorized" };

  // 3. mutate
  await db
    .update(sessions)
    .set({
      title: parsed.data.title ?? null,
      scheduledAt: parsed.data.scheduledAt,
      timezone: parsed.data.timezone,
      updatedAt: new Date(),
    })
    .where(
      and(eq(sessions.id, parsed.data.sessionId), isNull(sessions.deletedAt)),
    );

  await recordEvent({
    actorId: owned.user.id,
    verb: "session.updated",
    subjectType: "session",
    subjectId: parsed.data.sessionId,
  });

  // 4. revalidate
  revalidatePath(`/sessions/${parsed.data.sessionId}`);
  revalidatePath(`/classes/${owned.session.classId}`);
  return { ok: true };
}

/**
 * Soft-delete a session. Owner-only. Never a hard delete — a tutor who removes
 * the wrong lesson would otherwise take its materials and student work with it.
 */
export async function deleteSession(sessionId: string): Promise<void> {
  const owned = await ownedSession(sessionId);
  if (!owned) return;

  await db
    .update(sessions)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(sessions.id, sessionId), isNull(sessions.deletedAt)));

  await recordEvent({
    actorId: owned.user.id,
    verb: "session.deleted",
    subjectType: "session",
    subjectId: sessionId,
  });

  revalidatePath(`/classes/${owned.session.classId}`);
  redirect(`/classes/${owned.session.classId}`);
}
