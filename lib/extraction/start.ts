import { after } from "next/server";
import { processQuestionExtraction } from "./process-question-extraction";
import { processSyllabusExtraction } from "./process-syllabus-extraction";

/**
 * How an extraction starts: inside the same Vercel function that handled the
 * upload, after the response has gone back to the tutor. There is no queue and
 * no separate worker process — Fluid Compute lets `after()` work run up to the
 * route's `maxDuration` (300s, set on the syllabus pages), and chunks run
 * concurrently, so a typical document finishes well inside that.
 *
 * If the function is killed mid-run (timeout, deploy, crash) the row is left
 * `pending`/`processing`; `stale.ts` turns that into `failed` on read after
 * STALE_AFTER_MS so the tutor gets a Retry button instead of a spinner forever.
 *
 * Call only from a Server Action or route handler: `after()` needs a request.
 * The ids passed in must already be authorized by the caller — the processors
 * re-read everything else from the database.
 */

export type SyllabusExtractionJob = { syllabusId: string; attachmentId: string };
export type QuestionExtractionJob = { importId: string };

export function startSyllabusExtraction(job: SyllabusExtractionJob): void {
  after(async () => {
    try {
      await processSyllabusExtraction(job);
      console.log(`[syllabus-extraction] done — syllabus ${job.syllabusId}`);
    } catch (err) {
      // Already written to the row as `failed` by the processor; log for Vercel.
      console.error(`[syllabus-extraction] failed — syllabus ${job.syllabusId}`, err);
    }
  });
}

export function startQuestionExtraction(job: QuestionExtractionJob): void {
  after(async () => {
    try {
      await processQuestionExtraction(job);
      console.log(`[question-extraction] done — import ${job.importId}`);
    } catch (err) {
      console.error(`[question-extraction] failed — import ${job.importId}`, err);
    }
  });
}
