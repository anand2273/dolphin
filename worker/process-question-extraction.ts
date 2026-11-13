import { and, asc, eq, inArray, isNull, ne } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  attachments,
  concepts,
  questionConcepts,
  questionFigures,
  questionImports,
  questionParts,
  questions,
  syllabuses,
  topicConcepts,
  topics,
} from "@/lib/db/schema";
import { QUESTION_DOCUMENTS_BUCKET } from "@/lib/storage/config";
import { createSignedDownloadUrl } from "@/lib/storage/objects";
import { NO_TOPICS_MESSAGE } from "@/lib/validation/question";
import type { QuestionExtractionJob } from "@/lib/queue/question-extraction";
import { chunkPdfByPages } from "./pdf-chunk";
import { extractQuestions } from "./gemini-extract-questions";
import {
  buildQuestionHandles,
  resolveConceptRefs,
  resolveTopicRef,
  type SyllabusVocabulary,
} from "./question-handles";
import { mergeQuestionChunks } from "./merge-questions";

/** Live topics in syllabus order, each with its live concepts. */
export async function loadSyllabusVocabulary(syllabusId: string): Promise<SyllabusVocabulary> {
  const topicRows = await db
    .select({ id: topics.id, name: topics.name })
    .from(topics)
    .where(and(eq(topics.syllabusId, syllabusId), isNull(topics.deletedAt)))
    .orderBy(asc(topics.orderIndex), asc(topics.createdAt));
  if (!topicRows.length) return { topics: [] };

  const links = await db
    .select({ topicId: topicConcepts.topicId, id: concepts.id, name: concepts.name })
    .from(topicConcepts)
    .innerJoin(concepts, eq(concepts.id, topicConcepts.conceptId))
    .where(
      and(
        inArray(topicConcepts.topicId, topicRows.map((t) => t.id)),
        isNull(concepts.deletedAt),
      ),
    )
    .orderBy(asc(concepts.name));

  return {
    topics: topicRows.map((t) => ({
      ...t,
      concepts: links.filter((l) => l.topicId === t.id).map(({ id, name }) => ({ id, name })),
    })),
  };
}

/**
 * Consumer side. Trusts only the import id from the payload; tutor, syllabus
 * and document are all re-read from that row. Everything lands as a DRAFT:
 * the tutor approves (slice 2), never this worker.
 */
export async function processQuestionExtraction(job: QuestionExtractionJob): Promise<void> {
  const { importId } = job;

  const [imp] = await db
    .select()
    .from(questionImports)
    .where(and(eq(questionImports.id, importId), isNull(questionImports.deletedAt)))
    .limit(1);
  if (!imp) return; // deleted since enqueue: nothing to do, nothing worth retrying
  if (imp.status === "done") return; // redelivered after commit

  // Every status write outside the write transaction is conditional on not
  // being done: `done` must be terminal, because the transaction's FOR UPDATE
  // re-check is the only thing standing between a duplicate delivery and a
  // second full set of questions, and it only works if nothing can move a
  // row back out of `done`.
  const notDone = and(eq(questionImports.id, importId), ne(questionImports.status, "done"));
  const claimed = await db
    .update(questionImports)
    .set({ status: "processing", error: null, updatedAt: new Date() })
    .where(notDone)
    .returning({ id: questionImports.id });
  if (!claimed.length) return; // another delivery committed between our read and here

  try {
    const [syllabus] = await db
      .select({ id: syllabuses.id })
      .from(syllabuses)
      .where(and(eq(syllabuses.id, imp.syllabusId), isNull(syllabuses.deletedAt)))
      .limit(1);
    if (!syllabus) throw new Error("Syllabus was deleted");

    // Checked before any download or model call: cheap, and the commonest
    // fixable mistake a tutor can make here.
    const vocab = await loadSyllabusVocabulary(imp.syllabusId);
    if (!vocab.topics.length) throw new Error(NO_TOPICS_MESSAGE);
    const handles = buildQuestionHandles(vocab);

    const [attachment] = await db
      .select()
      .from(attachments)
      .where(and(eq(attachments.id, imp.sourceAttachmentId), isNull(attachments.deletedAt)))
      .limit(1);
    if (!attachment) throw new Error("Source document is missing or was deleted");
    if (attachment.mimeType !== "application/pdf") {
      throw new Error("Only PDF documents can be imported as questions");
    }

    const response = await fetch(
      await createSignedDownloadUrl(QUESTION_DOCUMENTS_BUCKET, attachment.objectKey),
    );
    if (!response.ok) throw new Error(`Could not fetch the source document (${response.status})`);
    const chunks = await chunkPdfByPages(await response.arrayBuffer());

    // Uncapped concurrency, as topic extraction: paid-tier key. Revisit on 429s.
    const results = await Promise.all(
      chunks.map((c) =>
        extractQuestions({
          fileBytes: c.fileBytes,
          pageRange: { startPage: c.startPage, endPage: c.endPage, totalPages: c.totalPages },
          handles,
        }),
      ),
    );
    const { questions: merged, unpairedAnswers } = mergeQuestionChunks(
      chunks.map((c, i) => ({ startPage: c.startPage, endPage: c.endPage, result: results[i] })),
    );

    await db.transaction(async (tx) => {
      // Serialise against a concurrent delivery of the same job.
      const [locked] = await tx
        .select({ status: questionImports.status })
        .from(questionImports)
        .where(eq(questionImports.id, importId))
        .for("update");
      if (locked?.status === "done") return;

      // Tags were chosen against a snapshot; drop any that died since.
      const liveTopicIds = new Set(
        (
          await tx
            .select({ id: topics.id })
            .from(topics)
            .where(and(eq(topics.syllabusId, imp.syllabusId), isNull(topics.deletedAt)))
        ).map((r) => r.id),
      );
      const handleConceptIds = [...handles.conceptIdByHandle.values()];
      const liveConceptIds = new Set(
        handleConceptIds.length
          ? (
              await tx
                .select({ id: concepts.id })
                .from(concepts)
                .where(
                  and(
                    inArray(concepts.id, handleConceptIds),
                    eq(concepts.tutorId, imp.tutorId),
                    isNull(concepts.deletedAt),
                  ),
                )
            ).map((r) => r.id)
          : [],
      );

      for (const [index, q] of merged.entries()) {
        const topicId = resolveTopicRef(handles, q.topicRef);
        const [row] = await tx
          .insert(questions)
          .values({
            syllabusId: imp.syllabusId,
            tutorId: imp.tutorId,
            importId,
            topicId: topicId && liveTopicIds.has(topicId) ? topicId : null,
            sectionLabel: q.sectionLabel,
            label: q.label,
            stem: q.stem,
            status: "draft",
            sourcePageStart: q.startPage,
            sourcePageEnd: q.endPage,
            orderIndex: index,
          })
          .returning({ id: questions.id });

        const parts = q.parts.length
          ? q.parts
          : q.answer !== null
            ? [{ label: "", body: "", marks: null, answer: q.answer }]
            : [];
        if (parts.length) {
          await tx.insert(questionParts).values(
            parts.map((p, i) => ({
              questionId: row.id,
              label: p.label,
              body: p.body,
              marks: p.marks,
              answer: p.answer,
              orderIndex: i,
            })),
          );
        }

        const conceptIds = resolveConceptRefs(handles, q.conceptRefs).filter((id) =>
          liveConceptIds.has(id),
        );
        if (conceptIds.length) {
          await tx
            .insert(questionConcepts)
            .values(conceptIds.map((conceptId) => ({ questionId: row.id, conceptId })))
            .onConflictDoNothing();
        }

        if (q.figures.length) {
          await tx.insert(questionFigures).values(
            q.figures.map((f, i) => ({
              questionId: row.id,
              page: f.page,
              suggestedBox: f.box,
              orderIndex: i,
            })),
          );
        }
      }

      await tx
        .update(questionImports)
        .set({
          status: "done",
          error: null,
          note: unpairedAnswers
            ? `${unpairedAnswers} answer(s) in the document could not be matched to a question.`
            : null,
          updatedAt: new Date(),
        })
        .where(eq(questionImports.id, importId));
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown extraction error";
    await db
      .update(questionImports)
      .set({ status: "failed", error: message, updatedAt: new Date() })
      .where(notDone);
    throw error; // BullMQ's retry/backoff decides what happens next
  }
}
