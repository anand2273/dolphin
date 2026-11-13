import { Queue } from "bullmq";
import { getProducerConnection } from "./connection";

/**
 * Producer side of question extraction. Next only enqueues; worker/ consumes.
 * The payload is ONLY the import id: the worker re-reads syllabus, tutor and
 * attachment from that row, so a forged payload can at most name an import,
 * never assert who owns it (the queue is an authz boundary; see CLAUDE.md).
 */
export const QUESTION_EXTRACTION_QUEUE = "question-extraction";

export type QuestionExtractionJob = { importId: string };

let queue: Queue<QuestionExtractionJob> | null = null;

function getQueue(): Queue<QuestionExtractionJob> {
  if (queue) return queue;
  queue = new Queue<QuestionExtractionJob>(QUESTION_EXTRACTION_QUEUE, {
    connection: getProducerConnection(),
  });
  return queue;
}

export async function enqueueQuestionExtraction(job: QuestionExtractionJob): Promise<void> {
  await getQueue().add("extract", job, {
    attempts: 3,
    backoff: { type: "exponential", delay: 5_000 },
    removeOnComplete: true,
    removeOnFail: false,
  });
}
