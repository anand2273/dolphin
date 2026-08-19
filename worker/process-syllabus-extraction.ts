import { and, desc, eq, isNotNull, isNull, sql } from "drizzle-orm";
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
export function mergeExtractionResults(
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
        topics.push({ ...extractedTopic, concepts: [...extractedTopic.concepts] });
        continue;
      }

      const existingTopic = topics[existingIndex];
      const conceptNames = new Set(
        existingTopic.concepts.map((c) => c.name.toLowerCase()),
      );
      for (const concept of extractedTopic.concepts) {
        if (conceptNames.has(concept.name.toLowerCase())) continue;
        conceptNames.add(concept.name.toLowerCase());
        existingTopic.concepts = [...existingTopic.concepts, concept];
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
      // Concepts are tutor-scoped and may already exist (from another
      // syllabus or a previous extraction); reuse rather than duplicate.
      const conceptIdByName = new Map<string, string>();
      async function conceptIdFor(
        name: string,
        description?: string,
      ): Promise<string> {
        const key = name.toLowerCase();
        const cached = conceptIdByName.get(key);
        if (cached) return cached;

        // 1. A live concept under this name. Matched case-insensitively
        // because concepts_tutor_name_live_uidx is on (tutor_id, lower(name)) —
        // a case-sensitive lookup misses a row differing only in case and then
        // collides with that index on insert.
        const [live] = await tx
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
        if (live) {
          conceptIdByName.set(key, live.id);
          return live.id;
        }

        // 2. A tombstone: this name was merged away by the tutor. Follow the
        // pointer instead of recreating the row.
        //
        // Load-bearing. concepts_tutor_name_live_uidx is PARTIAL on
        // "deleted_at is null", so without this a merged-away name has no live
        // row, gets recreated here, and the tutor is proposed the identical
        // merge after every future upload. Merges repoint tombstones at the new
        // survivor and take FOR UPDATE locks over the whole cluster so two of
        // them cannot interleave into a cycle — that is what makes one hop
        // enough here, so no loop guard is needed.
        const [tombstone] = await tx
          .select({ mergedIntoId: concepts.mergedIntoId })
          .from(concepts)
          .where(
            and(
              eq(concepts.tutorId, syllabus.tutorId),
              sql`lower(${concepts.name}) = ${key}`,
              isNotNull(concepts.deletedAt),
              isNotNull(concepts.mergedIntoId),
            ),
          )
          .orderBy(desc(concepts.updatedAt))
          .limit(1);
        if (tombstone?.mergedIntoId) {
          conceptIdByName.set(key, tombstone.mergedIntoId);
          return tombstone.mergedIntoId;
        }

        // 3. Create. onConflictDoNothing + re-select rather than a bare insert:
        // the worker runs concurrency 2, so two jobs for one tutor can both
        // miss the select above and collide on the unique index (23505), which
        // aborts the whole transaction and fails a job that has already paid
        // for every Gemini call in the document.
        const [created] = await tx
          .insert(concepts)
          .values({
            tutorId: syllabus.tutorId,
            name,
            description: description ?? null,
          })
          .onConflictDoNothing()
          .returning({ id: concepts.id });

        if (created) {
          conceptIdByName.set(key, created.id);
          return created.id;
        }

        const [raced] = await tx
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
        if (!raced) throw new Error(`Could not resolve concept "${name}"`);
        conceptIdByName.set(key, raced.id);
        return raced.id;
      }

      // Re-extraction (a retry, or a second document on the same syllabus) has
      // to be idempotent. topics_syllabus_name_live_uidx is a live-rows-only
      // unique index on (syllabus_id, lower(name)), so a blind insert of an
      // already-present topic aborts the whole transaction and fails the job.
      // Matching that index and updating in place is also what spares a
      // tutor's hand-created topics: nothing here deletes rows, so a topic the
      // extraction no longer mentions simply survives untouched.
      for (const [index, extractedTopic] of result.topics.entries()) {
        const topicKey = extractedTopic.name.toLowerCase();
        const [existingTopic] = await tx
          .select({ id: topics.id })
          .from(topics)
          .where(
            and(
              eq(topics.syllabusId, syllabusId),
              sql`lower(${topics.name}) = ${topicKey}`,
              isNull(topics.deletedAt),
            ),
          )
          .limit(1);

        let topicId: string;
        if (existingTopic) {
          topicId = existingTopic.id;
          await tx
            .update(topics)
            .set({
              // Only overwrite a description when this run actually produced
              // one — never blank out one the tutor wrote by hand.
              ...(extractedTopic.description
                ? { description: extractedTopic.description }
                : {}),
              orderIndex: index,
              updatedAt: new Date(),
            })
            .where(eq(topics.id, topicId));
        } else {
          const [created] = await tx
            .insert(topics)
            .values({
              syllabusId,
              tutorId: syllabus.tutorId,
              name: extractedTopic.name,
              description: extractedTopic.description ?? null,
              orderIndex: index,
            })
            .returning({ id: topics.id });
          topicId = created.id;
        }

        for (const extractedConcept of extractedTopic.concepts) {
          const conceptId = await conceptIdFor(
            extractedConcept.name,
            extractedConcept.description,
          );
          await tx
            .insert(topicConcepts)
            .values({ topicId, conceptId })
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
