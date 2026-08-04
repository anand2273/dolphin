import "./env";
import { Worker } from "bullmq";
import IORedis from "ioredis";
import {
  SYLLABUS_EXTRACTION_QUEUE,
  type SyllabusExtractionJob,
} from "@/lib/queue/syllabus-extraction";
import { processSyllabusExtraction } from "./process-syllabus-extraction";

/**
 * Standalone worker process. Deliberately NOT part of the Next.js app — Vercel
 * cannot host a persistent process, so this runs as its own always-on
 * deployment (Railway suggested) alongside its own Redis instance. Run with
 * `pnpm worker:dev` locally, or `pnpm worker:start` in production.
 *
 * Env required: REDIS_URL, DATABASE_URL, GEMINI_API_KEY, plus the same
 * Supabase service-role env the Next app uses for storage
 * (createSupabaseAdminClient reads it directly).
 */

const redisUrl = process.env.REDIS_URL;
if (!redisUrl) {
  throw new Error("REDIS_URL is not set — the worker cannot consume its queue.");
}

// `maxRetriesPerRequest: null` IS required here and must not be tidied away:
// a Worker holds a blocking connection, and BullMQ enforces it for those. The
// producer side deliberately does not copy this — see the comment in
// lib/queue/syllabus-extraction.ts for why null there caused a hung upload.
const connection = new IORedis(redisUrl, { maxRetriesPerRequest: null });

const worker = new Worker<SyllabusExtractionJob>(
  SYLLABUS_EXTRACTION_QUEUE,
  async (job) => {
    await processSyllabusExtraction(job.data);
  },
  { connection, concurrency: 2 },
);

worker.on("completed", (job) => {
  console.log(`[syllabus-extraction] done — syllabus ${job.data.syllabusId}`);
});

worker.on("failed", (job, err) => {
  console.error(
    `[syllabus-extraction] failed — syllabus ${job?.data.syllabusId ?? "unknown"}`,
    err,
  );
});

console.log("[syllabus-extraction] worker started, waiting for jobs");
