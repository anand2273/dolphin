import { and, eq, isNull, sql } from "drizzle-orm";
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
import { extractTopicsAndConcepts, type SyllabusExtractionResult } from "./gemini-extract";
import { chunkPdfByPages } from "./pdf-chunk";

const PDF_MIME_TYPE = "application/pdf";

/**
 * Merges per-chunk results in document order. Chunks overlap by one page on
 * purpose (see pdf-chunk.ts), so the same topic can legitimately appear in
 * two consecutive chunks — matched here by case-insensitive name rather than
 * kept as a duplicate. Concepts are merged the same way within a matched
 * topic.
 */
function mergeExtractionResults(
  chunkResults: SyllabusExtractionResult[],
): SyllabusExtractionResult {
  const topics: SyllabusExtractionResult["topics"] = [];
  const topicIndexByName = new Map<string, number>();

  for (const chunkResult of chunkResults) {
    for (const extractedTopic of chunkResult.topics) {
      const topicKey = extractedTopic.name.toLowerCase();
      const existingIndex = topicIndexByName.get(topicKey);

      if (existingIndex === undefined) {
        topicIndexByName.set(topicKey, topics.length);
        topics.push({ ...extractedTopic, concepts: [...(extractedTopic.concepts ?? [])] });
        continue;
      }

      const existingTopic = topics[existingIndex];
      const conceptNames = new Set(
        (existingTopic.concepts ?? []).map((c) => c.name.toLowerCase()),
      );
      for (const concept of extractedTopic.concepts ?? []) {
        if (conceptNames.has(concept.name.toLowerCase())) continue;
        conceptNames.add(concept.name.toLowerCase());
        existingTopic.concepts = [...(existingTopic.concepts ?? []), concept];
      }
    }
  }

  return { topics };
}

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

    // Structural (page-based) chunking is PDF-only for now — other formats
    // still go through a single whole-document call. See CLAUDE.md's
    // Syllabus extraction section for why.
    let result: SyllabusExtractionResult;
    if (attachment.mimeType === PDF_MIME_TYPE) {
      const chunks = await chunkPdfByPages(fileBytes);
      const chunkResults = await Promise.all(
        chunks.map((chunk) =>
          extractTopicsAndConcepts({
            fileBytes: chunk.fileBytes,
            mimeType: PDF_MIME_TYPE,
            pageRange: {
              startPage: chunk.startPage,
              endPage: chunk.endPage,
              totalPages: chunk.totalPages,
            },
          }),
        ),
      );
      result = mergeExtractionResults(chunkResults);
    } else {
      result = await extractTopicsAndConcepts({
        fileBytes,
        mimeType: attachment.mimeType,
      });
    }

    await db.transaction(async (tx) => {
      // Concepts are tutor-scoped and may already exist (from another syllabus
      // or a previous extraction); reuse the live row under the same name
      // rather than creating a duplicate. Matched case-insensitively because
      // concepts_tutor_name_live_uidx (lib/db/schema.ts) is a case-insensitive
      // unique index on (tutor_id, lower(name)) — a case-sensitive lookup here
      // can miss an existing row that differs only in case and then collide
      // with that same index on insert.
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
              sql`lower(${concepts.name}) = ${key}`,
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
