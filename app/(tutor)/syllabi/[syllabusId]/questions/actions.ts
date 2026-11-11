"use server";

import { revalidatePath } from "next/cache";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { attachments, questionImports, topics } from "@/lib/db/schema";
import { requireAuthUser } from "@/lib/auth/session";
import { assertQuestionImportOwner, assertSyllabusOwner, AuthzError } from "@/lib/auth/authz";
import { recordEvent } from "@/lib/db/events";
import {
  NO_TOPICS_MESSAGE,
  confirmQuestionImportUploadSchema,
  requestQuestionImportUploadSchema,
  retryQuestionImportSchema,
} from "@/lib/validation/question";
import {
  MAX_FILE_BYTES,
  QUESTION_DOCUMENTS_BUCKET,
  isAllowedQuestionImportMimeType,
} from "@/lib/storage/config";
import {
  createSignedUploadUrl,
  generateObjectKey,
  removeObject,
  statObject,
} from "@/lib/storage/objects";
import { enqueueQuestionExtraction } from "@/lib/queue/question-extraction";
import type { UploadTicket } from "@/app/(tutor)/syllabi/actions";
import type { FormState } from "@/lib/types";

/**
 * Question import: request (authorize, mint URL) -> browser PUTs bytes ->
 * confirm (authorize, re-stat, write rows, enqueue). Same three-step shape as
 * syllabus documents and materials. Ownership of the SYLLABUS is the gate at
 * every step; the bank is tutor-private.
 */

async function ownsSyllabus(syllabusId: string) {
  const user = await requireAuthUser();
  await assertSyllabusOwner(user.id, syllabusId); // throws AuthzError
  return user;
}

export async function requestQuestionImportUpload(input: {
  syllabusId: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
}): Promise<UploadTicket> {
  const parsed = requestQuestionImportUploadSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid file" };
  }

  try {
    await ownsSyllabus(parsed.data.syllabusId);
  } catch (e) {
    if (e instanceof AuthzError) return { ok: false, error: "Not authorized" };
    throw e;
  }

  // Refused up front so the tutor doesn't upload 25 MB to learn this from a
  // failed job. The worker re-checks: topics can be deleted in between.
  const [anyTopic] = await db
    .select({ id: topics.id })
    .from(topics)
    .where(and(eq(topics.syllabusId, parsed.data.syllabusId), isNull(topics.deletedAt)))
    .limit(1);
  if (!anyTopic) return { ok: false, error: NO_TOPICS_MESSAGE };

  const objectKey = generateObjectKey();
  try {
    const { signedUrl, token } = await createSignedUploadUrl(QUESTION_DOCUMENTS_BUCKET, objectKey);
    return { ok: true, objectKey, signedUrl, token };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not prepare the upload" };
  }
}

export async function confirmQuestionImportUpload(input: {
  syllabusId: string;
  objectKey: string;
  filename: string;
}): Promise<FormState> {
  const parsed = confirmQuestionImportUploadSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const { syllabusId, objectKey, filename } = parsed.data;

  let user;
  try {
    user = await ownsSyllabus(syllabusId);
  } catch (e) {
    if (e instanceof AuthzError) return { error: "Not authorized" };
    throw e;
  }

  // The client's claims are never recorded: re-read what actually landed.
  const stat = await statObject(QUESTION_DOCUMENTS_BUCKET, objectKey);
  if (!stat) return { error: "The upload didn't complete. Please try again." };
  if (stat.sizeBytes > MAX_FILE_BYTES || !isAllowedQuestionImportMimeType(stat.mimeType)) {
    await removeObject(QUESTION_DOCUMENTS_BUCKET, objectKey);
    return { error: "That file isn't allowed. Only PDFs can be imported." };
  }

  let importId: string;
  try {
    importId = await db.transaction(async (tx) => {
      const [attachment] = await tx
        .insert(attachments)
        .values({
          bucket: QUESTION_DOCUMENTS_BUCKET,
          objectKey,
          originalFilename: filename,
          mimeType: stat.mimeType,
          sizeBytes: stat.sizeBytes,
          uploadedByUserId: user.id,
        })
        .returning({ id: attachments.id });

      const [imp] = await tx
        .insert(questionImports)
        .values({ syllabusId, tutorId: user.id, sourceAttachmentId: attachment.id, status: "pending" })
        .returning({ id: questionImports.id });

      await recordEvent(
        {
          actorId: user.id,
          verb: "question_import.uploaded",
          subjectType: "question_import",
          subjectId: imp.id,
          payload: { syllabusId, attachmentId: attachment.id, sizeBytes: stat.sizeBytes },
        },
        tx,
      );
      return imp.id;
    });
  } catch (e) {
    // e.g. the same objectKey confirmed twice (unique index). Never throw out of an action.
    console.error("confirmQuestionImportUpload failed", e);
    return { error: "Could not save that upload. Please try again." };
  }

  // After commit, and never thrown, for the reasons in confirmSyllabusDocumentUpload.
  try {
    await enqueueQuestionExtraction({ importId });
  } catch (e) {
    await db
      .update(questionImports)
      .set({
        status: "failed",
        error: `Could not queue extraction: ${e instanceof Error ? e.message : "unknown error"}`,
        updatedAt: new Date(),
      })
      .where(eq(questionImports.id, importId));
  }

  revalidatePath(`/syllabi/${syllabusId}`);
  return { ok: true };
}

/** Only a FAILED import re-runs: a done one would duplicate its questions. */
export async function retryQuestionImport(importId: string): Promise<void> {
  const parsed = retryQuestionImportSchema.safeParse(importId);
  if (!parsed.success) return;

  const user = await requireAuthUser();
  let imp;
  try {
    imp = await assertQuestionImportOwner(user.id, parsed.data);
  } catch (e) {
    if (e instanceof AuthzError) return;
    throw e;
  }
  if (imp.status !== "failed") return;

  await db
    .update(questionImports)
    .set({ status: "pending", error: null, updatedAt: new Date() })
    .where(eq(questionImports.id, imp.id));

  try {
    await enqueueQuestionExtraction({ importId: imp.id });
  } catch (e) {
    await db
      .update(questionImports)
      .set({
        status: "failed",
        error: `Could not queue extraction: ${e instanceof Error ? e.message : "unknown error"}`,
        updatedAt: new Date(),
      })
      .where(eq(questionImports.id, imp.id));
  }

  revalidatePath(`/syllabi/${imp.syllabusId}`);
}
