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

// `family: 0` lets DNS return an A *or* AAAA record. Railway's private network
// is IPv6-only, so `redis.railway.internal` is ENOTFOUND without it; it is a
// no-op on every other host. Neither option here is tidy-away-able —
// `maxRetriesPerRequest: null` is a hard BullMQ requirement. See deploy.md §9a.
const connection = new IORedis(redisUrl, {
  maxRetriesPerRequest: null,
  family: 0,
});

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
