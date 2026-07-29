"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { attachments, materials, sessions } from "@/lib/db/schema";
import { requireAuthUser } from "@/lib/auth/session";
import { assertClassOwner, AuthzError } from "@/lib/auth/authz";
import { getSessionForViewer } from "@/lib/db/queries/sessions";
import { getMaterialForViewer } from "@/lib/db/queries/materials";
import { recordEvent } from "@/lib/db/events";
import { updateSessionSchema } from "@/lib/validation/session";
import {
  confirmUploadSchema,
  requestUploadSchema,
} from "@/lib/validation/material";
import {
  isAllowedMimeType,
  MATERIALS_BUCKET,
  MAX_FILE_BYTES,
} from "@/lib/storage/config";
import {
  createSignedUploadUrl,
  generateObjectKey,
  removeObject,
  statObject,
} from "@/lib/storage/objects";
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

export type UploadTicket =
  | { ok: true; objectKey: string; signedUrl: string; token: string }
  | { ok: false; error: string };

/**
 * Step 1 of 3: authorize, sanity-check the CLAIMED file metadata, and hand back
 * a short-lived signed URL the browser can PUT to. Nothing is written to the
 * database here — an abandoned upload leaves only an orphan object, never a row.
 *
 * The claims checked here are not trusted afterwards; see confirmMaterialUpload.
 */
export async function requestMaterialUpload(input: {
  sessionId: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
}): Promise<UploadTicket> {
  // 1. parse
  const parsed = requestUploadSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid file" };
  }

  // 2. authorize — only the class owner may attach materials to its sessions.
  let owned;
  try {
    owned = await ownedSession(parsed.data.sessionId);
  } catch (e) {
    if (e instanceof AuthzError) return { ok: false, error: "Not authorized" };
    throw e;
  }
  if (!owned) return { ok: false, error: "Not authorized" };

  // 3. mint. The key is opaque and carries no session/class/filename.
  const objectKey = generateObjectKey();
  try {
    const { signedUrl, token } = await createSignedUploadUrl(objectKey);
    return { ok: true, objectKey, signedUrl, token };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Could not prepare the upload",
    };
  }
}

/**
 * Step 3 of 3 (the browser does step 2): verify what ACTUALLY landed, then write
 * the attachment + material rows atomically.
 *
 * The size and MIME recorded here come from storage, never from the client. A
 * caller who requested a URL for a small PDF and then pushed something else gets
 * the object deleted and no rows — which is why validating only at step 1 would
 * not be enough.
 */
export async function confirmMaterialUpload(input: {
  sessionId: string;
  objectKey: string;
  filename: string;
  title?: string;
}): Promise<FormState> {
  // 1. parse
  const parsed = confirmUploadSchema.safeParse(input);
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

  // 3. verify the real object, and refuse anything that doesn't match policy.
  const stat = await statObject(parsed.data.objectKey);
  if (!stat) return { error: "The upload didn't complete. Please try again." };

  if (stat.sizeBytes > MAX_FILE_BYTES || !isAllowedMimeType(stat.mimeType)) {
    await removeObject(parsed.data.objectKey);
    return { error: "That file isn't allowed." };
  }

  // 4. mutate
  await db.transaction(async (tx) => {
    const [attachment] = await tx
      .insert(attachments)
      .values({
        bucket: MATERIALS_BUCKET,
        objectKey: parsed.data.objectKey,
        // Metadata ONLY — the filename is never part of the storage path.
        originalFilename: parsed.data.filename,
        mimeType: stat.mimeType,
        sizeBytes: stat.sizeBytes,
        uploadedByUserId: owned.user.id,
      })
      .returning({ id: attachments.id });

    const [material] = await tx
      .insert(materials)
      .values({
        sessionId: parsed.data.sessionId,
        attachmentId: attachment.id,
        title: parsed.data.title ?? null,
        createdByUserId: owned.user.id,
      })
      .returning({ id: materials.id });

    await recordEvent(
      {
        actorId: owned.user.id,
        verb: "material.uploaded",
        subjectType: "material",
        subjectId: material.id,
        payload: { sessionId: parsed.data.sessionId, sizeBytes: stat.sizeBytes },
      },
      tx,
    );
  });

  // 5. revalidate
  revalidatePath(`/sessions/${parsed.data.sessionId}`);
  return { ok: true };
}

/**
 * Soft-delete a material. Owner-only. The object itself is deliberately left in
 * the bucket — `deleted_at` is recoverable, a removed object is not.
 */
export async function deleteMaterial(materialId: string): Promise<void> {
  const user = await requireAuthUser();
  const found = await getMaterialForViewer(user.id, materialId);
  if (!found) return;
  if (found.relationship !== "owner") return;

  await db
    .update(materials)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(materials.id, materialId), isNull(materials.deletedAt)));

  await recordEvent({
    actorId: user.id,
    verb: "material.deleted",
    subjectType: "material",
    subjectId: materialId,
  });

  revalidatePath(`/sessions/${found.sessionId}`);
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
  // The notice key, not the message: the class page owns the copy, so a
  // hand-crafted link can't put words in the app's mouth.
  redirect(`/classes/${owned.session.classId}?notice=lesson-deleted`);
}
