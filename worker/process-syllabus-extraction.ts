import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  attachments,
  concepts,
  syllabuses,
  topicConcepts,
  topics,
} from "@/lib/db/schema";
import { SYLLABUS_DOCUMENTS_BUCKET } from "@/lib/storage/config";
import { createSignedDownloadUrl } from "@/lib/storage/objects";
import type { SyllabusExtractionJob } from "@/lib/queue/syllabus-extraction";
import { extractTopicsAndConcepts } from "./gemini-extract";

/**
 * The consumer side of the async extraction pipeline. Mirrors
 * confirmSyllabusDocumentUpload's never-trust-the-client discipline in spirit:
 * everything written here comes from the actual stored object and the actual
 * model output, never from the job payload beyond the two ids used to look
 * both up.
 */
export async function processSyllabusExtraction(
  job: SyllabusExtractionJob,
): Promise<void> {
  const { syllabusId, attachmentId } = job;

  await db
    .update(syllabuses)
    .set({
      extractionStatus: "processing",
      extractionError: null,
      updatedAt: new Date(),
    })
    .where(eq(syllabuses.id, syllabusId));

  try {
    const [attachment] = await db
      .select()
      .from(attachments)
      .where(and(eq(attachments.id, attachmentId), isNull(attachments.deletedAt)))
      .limit(1);
    if (!attachment) throw new Error("Source document is missing or was deleted");

    const [syllabus] = await db
      .select({ tutorId: syllabuses.tutorId })
      .from(syllabuses)
      .where(and(eq(syllabuses.id, syllabusId), isNull(syllabuses.deletedAt)))
      .limit(1);
    if (!syllabus) throw new Error("Syllabus was deleted");

    const signedUrl = await createSignedDownloadUrl(
      SYLLABUS_DOCUMENTS_BUCKET,
      attachment.objectKey,
    );
    const response = await fetch(signedUrl);
    if (!response.ok) {
      throw new Error(`Could not fetch the source document (${response.status})`);
    }
    const fileBytes = await response.arrayBuffer();

    const result = await extractTopicsAndConcepts({
      fileBytes,
      mimeType: attachment.mimeType,
    });

    await db.transaction(async (tx) => {
      // Concepts are tutor-scoped and may already exist (from another syllabus
      // or a previous extraction); reuse the live row under the same name
      // rather than creating a duplicate.
      const conceptIdByName = new Map<string, string>();
      async function conceptIdFor(name: string): Promise<string> {
        const key = name.toLowerCase();
        const cached = conceptIdByName.get(key);
        if (cached) return cached;

        const [existing] = await tx
          .select({ id: concepts.id })
          .from(concepts)
          .where(
            and(
              eq(concepts.tutorId, syllabus.tutorId),
              eq(concepts.name, name),
              isNull(concepts.deletedAt),
            ),
          )
          .limit(1);
        if (existing) {
          conceptIdByName.set(key, existing.id);
          return existing.id;
        }

        const [created] = await tx
          .insert(concepts)
          .values({ tutorId: syllabus.tutorId, name })
          .returning({ id: concepts.id });
        conceptIdByName.set(key, created.id);
        return created.id;
      }

      for (const [index, extractedTopic] of result.topics.entries()) {
        const [topicRow] = await tx
          .insert(topics)
          .values({
            syllabusId,
            tutorId: syllabus.tutorId,
            name: extractedTopic.name,
            description: extractedTopic.description ?? null,
            orderIndex: index,
          })
          .returning({ id: topics.id });

        for (const extractedConcept of extractedTopic.concepts ?? []) {
          const conceptId = await conceptIdFor(extractedConcept.name);
          await tx
            .insert(topicConcepts)
            .values({ topicId: topicRow.id, conceptId })
            .onConflictDoNothing();
        }
      }

      await tx
        .update(syllabuses)
        .set({ extractionStatus: "done", extractionError: null, updatedAt: new Date() })
        .where(eq(syllabuses.id, syllabusId));
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown extraction error";
    await db
      .update(syllabuses)
      .set({ extractionStatus: "failed", extractionError: message, updatedAt: new Date() })
      .where(eq(syllabuses.id, syllabusId));
    throw error; // rethrow so BullMQ's retry/backoff decides what happens next
  }
}
