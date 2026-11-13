import { Queue } from "bullmq";
import { getProducerConnection } from "./connection";

/**
 * Producer side of the async extraction pipeline (used by the Next.js app).
 * The Next app only ever enqueues — it never processes a job itself. The
 * standalone `worker/` process (run outside Vercel, since Vercel can't host a
 * persistent worker) is the only consumer; see worker/index.ts.
 *
 * Queue name and job payload shape live here as the single source of truth
 * both sides import from.
 */
export const SYLLABUS_EXTRACTION_QUEUE = "syllabus-extraction";

export type SyllabusExtractionJob = {
  syllabusId: string;
  attachmentId: string;
};

let queue: Queue<SyllabusExtractionJob> | null = null;

function getQueue(): Queue<SyllabusExtractionJob> {
  if (queue) return queue;
  // Fail-fast producer options live in ./connection.ts; see the comment there
  // for why they must not match the worker's.
  queue = new Queue<SyllabusExtractionJob>(SYLLABUS_EXTRACTION_QUEUE, {
    connection: getProducerConnection(),
  });
  return queue;
}

/**
 * Enqueue a job for the worker to pick up. Called once, right after the
 * `syllabuses` row is created with `extraction_status: "pending"`. Retries and
 * backoff are BullMQ's job, not the caller's — a Gemini call or a transient
 * network blip should not need to be handled here.
 */
export async function enqueueSyllabusExtraction(
  job: SyllabusExtractionJob,
): Promise<void> {
  await getQueue().add("extract", job, {
    attempts: 3,
    backoff: { type: "exponential", delay: 5_000 },
    removeOnComplete: true,
    removeOnFail: false,
  });
}
