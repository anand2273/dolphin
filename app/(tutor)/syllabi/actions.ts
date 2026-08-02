"use server";

import { revalidatePath } from "next/cache";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { attachments, concepts, syllabuses, topicConcepts, topics } from "@/lib/db/schema";
import { requireAuthUser, getProfile } from "@/lib/auth/session";
import { assertTutor } from "@/lib/auth/roles";
import { assertSyllabusOwner, AuthzError } from "@/lib/auth/authz";
import { recordEvent } from "@/lib/db/events";
import {
  createSyllabusFromPresetSchema,
  createSyllabusSchema,
  confirmSyllabusDocumentUploadSchema,
  requestSyllabusDocumentUploadSchema,
} from "@/lib/validation/syllabus";
import {
  isAllowedSyllabusDocumentMimeType,
  MAX_FILE_BYTES,
  SYLLABUS_DOCUMENTS_BUCKET,
} from "@/lib/storage/config";
import {
  createSignedUploadUrl,
  generateObjectKey,
  removeObject,
  statObject,
} from "@/lib/storage/objects";
import { enqueueSyllabusExtraction } from "@/lib/queue/syllabus-extraction";
import { getSyllabusPreset } from "@/lib/syllabus-presets";
import type { FormState } from "@/lib/types";

/** Tutors only, everywhere in this file. Students have no syllabus of their own. */
async function requireTutor() {
  const user = await requireAuthUser();
  const profile = await getProfile(user.id);
  assertTutor(profile?.role);
  return user;
}

/** parse -> authorize -> mutate -> revalidate (CLAUDE.md action contract). */
export async function createSyllabus(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = createSyllabusSchema.safeParse({
    title: formData.get("title"),
    subject: formData.get("subject") ?? undefined,
    level: formData.get("level") ?? undefined,
    description: formData.get("description") ?? undefined,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  let user;
  try {
    user = await requireTutor();
  } catch {
    return { error: "Only tutors can create syllabuses." };
  }

  await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(syllabuses)
      .values({
        tutorId: user.id,
        title: parsed.data.title,
        subject: parsed.data.subject ?? null,
        level: parsed.data.level ?? null,
        description: parsed.data.description ?? null,
        extractionStatus: "none",
      })
      .returning({ id: syllabuses.id });

    await recordEvent(
      {
        actorId: user.id,
        verb: "syllabus.created",
        subjectType: "syllabus",
        subjectId: created.id,
      },
      tx,
    );
  });

  revalidatePath("/syllabi");
  return { ok: true };
}

/**
 * Deep-copies a static preset fixture into a brand-new tutor-owned syllabus +
 * topics + concepts. The fixture itself is never touched, and the copy is
 * fully independent from the moment it's created — editing it later can't
 * affect the fixture or any other tutor.
 */
export async function createSyllabusFromPreset(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = createSyllabusFromPresetSchema.safeParse({
    presetKey: formData.get("presetKey"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid preset" };
  }

  const preset = getSyllabusPreset(parsed.data.presetKey);
  if (!preset) return { error: "Unknown preset" };

  let user: Awaited<ReturnType<typeof requireTutor>>;
  try {
    user = await requireTutor();
  } catch {
    return { error: "Only tutors can create syllabuses." };
  }

  await db.transaction(async (tx) => {
    const [syllabus] = await tx
      .insert(syllabuses)
      .values({
        tutorId: user.id,
        title: preset.title,
        subject: preset.subject ?? null,
        level: preset.level ?? null,
        description: preset.description ?? null,
        presetKey: preset.key,
        extractionStatus: "none",
      })
      .returning({ id: syllabuses.id });

    // Concepts are tutor-scoped and may already exist from a previous preset or
    // upload; reuse the live row instead of creating a duplicate under the same
    // name (concepts_tutor_name_live_uidx would reject that anyway).
    const conceptIdByName = new Map<string, string>();
    async function conceptIdFor(name: string): Promise<string> {
      const key = name.toLowerCase();
      const existing = conceptIdByName.get(key);
      if (existing) return existing;

      const [row] = await tx
        .select({ id: concepts.id })
        .from(concepts)
        .where(
          and(
            eq(concepts.tutorId, user.id),
            eq(concepts.name, name),
            isNull(concepts.deletedAt),
          ),
        )
        .limit(1);
      if (row) {
        conceptIdByName.set(key, row.id);
        return row.id;
      }

      const [created] = await tx
        .insert(concepts)
        .values({ tutorId: user.id, name })
        .returning({ id: concepts.id });
      conceptIdByName.set(key, created.id);
      return created.id;
    }

    for (const [index, topic] of preset.topics.entries()) {
      const [topicRow] = await tx
        .insert(topics)
        .values({
          syllabusId: syllabus.id,
          tutorId: user.id,
          name: topic.name,
          description: topic.description ?? null,
          orderIndex: index,
        })
        .returning({ id: topics.id });

      for (const concept of topic.concepts ?? []) {
        const conceptId = await conceptIdFor(concept.name);
        await tx
          .insert(topicConcepts)
          .values({ topicId: topicRow.id, conceptId })
          .onConflictDoNothing();
      }
    }

    await recordEvent(
      {
        actorId: user.id,
        verb: "syllabus.created_from_preset",
        subjectType: "syllabus",
        subjectId: syllabus.id,
        payload: { presetKey: preset.key },
      },
      tx,
    );
  });

  revalidatePath("/syllabi");
  return { ok: true };
}

export type UploadTicket =
  | { ok: true; objectKey: string; signedUrl: string; token: string }
  | { ok: false; error: string };

/**
 * Step 1 of 3: authorize, sanity-check the CLAIMED file metadata, and hand back
 * a short-lived signed URL the browser can PUT to. Nothing is written to the
 * database here — an abandoned upload leaves only an orphan object, never a row.
 * Same shape as requestMaterialUpload; see app/sessions/[sessionId]/actions.ts.
 */
export async function requestSyllabusDocumentUpload(input: {
  filename: string;
  mimeType: string;
  sizeBytes: number;
}): Promise<UploadTicket> {
  const parsed = requestSyllabusDocumentUploadSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid file" };
  }

  try {
    await requireTutor();
  } catch {
    return { ok: false, error: "Only tutors can upload a syllabus document." };
  }

  const objectKey = generateObjectKey();
  try {
    const { signedUrl, token } = await createSignedUploadUrl(
      SYLLABUS_DOCUMENTS_BUCKET,
      objectKey,
    );
    return { ok: true, objectKey, signedUrl, token };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Could not prepare the upload",
    };
  }
}

/**
 * Step 3 of 3 (the browser does step 2): verify what ACTUALLY landed, write the
 * attachment + syllabus rows atomically with extraction_status="pending", then
 * enqueue the async extraction job. The worker (not this action) does the
 * Gemini call and writes topics/concepts once it completes.
 */
export async function confirmSyllabusDocumentUpload(input: {
  objectKey: string;
  filename: string;
  title: string;
  subject?: string;
  level?: string;
}): Promise<FormState> {
  const parsed = confirmSyllabusDocumentUploadSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  let user;
  try {
    user = await requireTutor();
  } catch {
    return { error: "Only tutors can upload a syllabus document." };
  }

  const stat = await statObject(SYLLABUS_DOCUMENTS_BUCKET, parsed.data.objectKey);
  if (!stat) return { error: "The upload didn't complete. Please try again." };

  if (
    stat.sizeBytes > MAX_FILE_BYTES ||
    !isAllowedSyllabusDocumentMimeType(stat.mimeType)
  ) {
    await removeObject(SYLLABUS_DOCUMENTS_BUCKET, parsed.data.objectKey);
    return { error: "That file isn't allowed." };
  }

  const { syllabusId, attachmentId } = await db.transaction(async (tx) => {
    const [attachment] = await tx
      .insert(attachments)
      .values({
        bucket: SYLLABUS_DOCUMENTS_BUCKET,
        objectKey: parsed.data.objectKey,
        originalFilename: parsed.data.filename,
        mimeType: stat.mimeType,
        sizeBytes: stat.sizeBytes,
        uploadedByUserId: user.id,
      })
      .returning({ id: attachments.id });

    const [syllabus] = await tx
      .insert(syllabuses)
      .values({
        tutorId: user.id,
        title: parsed.data.title,
        subject: parsed.data.subject ?? null,
        level: parsed.data.level ?? null,
        sourceAttachmentId: attachment.id,
        extractionStatus: "pending",
      })
      .returning({ id: syllabuses.id });

    await recordEvent(
      {
        actorId: user.id,
        verb: "syllabus.document_uploaded",
        subjectType: "syllabus",
        subjectId: syllabus.id,
        payload: { attachmentId: attachment.id, sizeBytes: stat.sizeBytes },
      },
      tx,
    );

    return { syllabusId: syllabus.id, attachmentId: attachment.id };
  });

  // Enqueue only after the transaction has committed — otherwise the worker
  // could pick up the job before the row is visible, or chase a syllabus that
  // never ends up existing if something above rolled back.
  await enqueueSyllabusExtraction({ syllabusId, attachmentId });

  revalidatePath("/syllabi");
  revalidatePath(`/syllabi/${syllabusId}`);
  return { ok: true };
}

/** Soft-delete a syllabus. Owner-only. */
export async function deleteSyllabus(syllabusId: string): Promise<void> {
  const user = await requireAuthUser();
  try {
    await assertSyllabusOwner(user.id, syllabusId);
  } catch (e) {
    if (e instanceof AuthzError) return;
    throw e;
  }

  await db
    .update(syllabuses)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(syllabuses.id, syllabusId), isNull(syllabuses.deletedAt)));

  await recordEvent({
    actorId: user.id,
    verb: "syllabus.deleted",
    subjectType: "syllabus",
    subjectId: syllabusId,
  });

  revalidatePath("/syllabi");
}
