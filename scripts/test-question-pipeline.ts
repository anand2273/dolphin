import "../worker/env";

import { readFile } from "node:fs/promises";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
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
  topics,
} from "@/lib/db/schema";
import { createSupabaseAdminClient } from "@/lib/auth/supabase-admin";
import { generateObjectKey, removeObject } from "@/lib/storage/objects";
import { QUESTION_DOCUMENTS_BUCKET } from "@/lib/storage/config";
import { enqueueQuestionExtraction } from "@/lib/queue/question-extraction";

/**
 * Dev-only harness for question extraction, the counterpart of
 * test-syllabus-pipeline.ts. Imports a PDF into an EXISTING syllabus (it needs
 * that syllabus's topics as the tagging vocabulary), uploaded as the
 * syllabus's own tutor. Not wired into the app.
 *
 *   pnpm test:question-pipeline <file.pdf> --syllabus <syllabusId>
 *   pnpm test:question-pipeline --status <importId>
 *   pnpm test:question-pipeline --cleanup <syllabusId>   # hard-deletes that syllabus's imports + questions
 *
 * Run `pnpm worker:dev` in another terminal to process what this enqueues.
 */

async function seed(filePath: string, syllabusId: string) {
  if (!filePath.toLowerCase().endsWith(".pdf")) throw new Error("Question imports are PDF-only.");
  const [syllabus] = await db
    .select({ tutorId: syllabuses.tutorId, title: syllabuses.title })
    .from(syllabuses)
    .where(and(eq(syllabuses.id, syllabusId), isNull(syllabuses.deletedAt)))
    .limit(1);
  if (!syllabus) throw new Error("No such syllabus.");

  const bytes = await readFile(filePath);
  const objectKey = generateObjectKey();
  const { error } = await createSupabaseAdminClient()
    .storage.from(QUESTION_DOCUMENTS_BUCKET)
    .upload(objectKey, bytes, { contentType: "application/pdf" });
  if (error) throw new Error(`storage upload failed: ${error.message}`);

  const [attachment] = await db
    .insert(attachments)
    .values({
      bucket: QUESTION_DOCUMENTS_BUCKET,
      objectKey,
      originalFilename: filePath.split("/").pop() ?? filePath,
      mimeType: "application/pdf",
      sizeBytes: bytes.length,
      uploadedByUserId: syllabus.tutorId,
    })
    .returning({ id: attachments.id });
  const [imp] = await db
    .insert(questionImports)
    .values({ syllabusId, tutorId: syllabus.tutorId, sourceAttachmentId: attachment.id })
    .returning({ id: questionImports.id });
  await enqueueQuestionExtraction({ importId: imp.id });

  console.log(`Enqueued import ${imp.id} into "${syllabus.title}".
Next: pnpm worker:dev (other terminal), then
  pnpm test:question-pipeline --status ${imp.id}`);
}

async function status(importId: string) {
  const [imp] = await db.select().from(questionImports).where(eq(questionImports.id, importId)).limit(1);
  if (!imp) return console.log("No such import.");
  console.log(`status: ${imp.status}${imp.error ? ` — ${imp.error}` : ""}${imp.note ? `\nnote: ${imp.note}` : ""}`);

  const rows = await db
    .select({ q: questions, topicName: topics.name })
    .from(questions)
    .leftJoin(topics, eq(topics.id, questions.topicId))
    .where(eq(questions.importId, importId))
    .orderBy(asc(questions.orderIndex));

  for (const { q, topicName } of rows) {
    const parts = await db.select().from(questionParts).where(eq(questionParts.questionId, q.id)).orderBy(asc(questionParts.orderIndex));
    const figs = await db.select().from(questionFigures).where(eq(questionFigures.questionId, q.id)).orderBy(asc(questionFigures.orderIndex));
    const tags = await db
      .select({ name: concepts.name })
      .from(questionConcepts)
      .innerJoin(concepts, eq(concepts.id, questionConcepts.conceptId))
      .where(eq(questionConcepts.questionId, q.id));

    console.log(
      `\n${q.sectionLabel ? `[${q.sectionLabel}] ` : ""}Q${q.label}  pp.${q.sourcePageStart}-${q.sourcePageEnd}` +
        `  topic: ${topicName ?? "UNTAGGED"}  concepts: ${tags.map((t) => t.name).join(", ") || "-"}`,
    );
    console.log(`  ${q.stem.replace(/\s+/g, " ").slice(0, 200)}`);
    for (const p of parts) {
      console.log(
        `  ${p.label || "·"} ${p.body.replace(/\s+/g, " ").slice(0, 120)}` +
          `${p.marks !== null ? ` [${p.marks}]` : ""}${p.answer ? `  => ${p.answer.slice(0, 60)}` : ""}`,
      );
    }
    for (const f of figs) console.log(`  figure ${f.orderIndex + 1}: p.${f.page} box ${JSON.stringify(f.suggestedBox)}`);
  }
  console.log(`\n${rows.length} question(s).`);
}

async function cleanup(syllabusId: string) {
  const imps = await db.select().from(questionImports).where(eq(questionImports.syllabusId, syllabusId));
  if (!imps.length) return console.log("Nothing to clean up.");
  const attachmentIds = imps.map((i) => i.sourceAttachmentId);
  const objs = await db
    .select({ id: attachments.id, objectKey: attachments.objectKey })
    .from(attachments)
    .where(inArray(attachments.id, attachmentIds));

  await db.delete(questions).where(eq(questions.syllabusId, syllabusId)); // parts/figures/tags cascade
  await db.delete(questionImports).where(eq(questionImports.syllabusId, syllabusId));
  await db.delete(attachments).where(inArray(attachments.id, attachmentIds));
  for (const o of objs) await removeObject(QUESTION_DOCUMENTS_BUCKET, o.objectKey);
  console.log(`Removed ${imps.length} import(s) and their questions.`);
}

async function main() {
  const args = process.argv.slice(2);
  const flag = (name: string) => {
    const i = args.indexOf(name);
    return i === -1 ? undefined : args[i + 1];
  };
  if (args[0] === "--status") return status(args[1] ?? "");
  if (args[0] === "--cleanup") return cleanup(args[1] ?? "");
  const syllabusId = flag("--syllabus");
  if (!args[0] || !syllabusId) {
    throw new Error("usage: <file.pdf> --syllabus <id> | --status <importId> | --cleanup <syllabusId>");
  }
  return seed(args[0], syllabusId);
}

main().then(() => process.exit(0));
