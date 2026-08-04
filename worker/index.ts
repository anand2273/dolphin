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

// Without this listener a connection-level 'error' is an unhandled 'error'
// event on an EventEmitter, which takes the whole process down — so the one
// thing that tells you the Redis leg is broken would instead present as a
// silent restart loop.
worker.on("error", (err) => {
  console.error("[syllabus-extraction] worker error", err);
});

connection.on("error", (err) => {
  console.error("[syllabus-extraction] redis connection error", err);
});

/**
 * Report readiness only once Redis actually answers, and say WHICH Redis.
 *
 * The old unconditional log at the bottom of this file ran synchronously right
 * after `new Worker(...)`, which does not block on a connection — so it printed
 * identically whether Redis was reachable, unreachable, or simply a different
 * database than the producer writes to. Combined with `maxRetriesPerRequest:
 * null` above (required for a blocking connection, so it retries forever
 * instead of failing), a misconfigured worker looked exactly like a healthy
 * one. This is the worker-side twin of the producer hang described in
 * lib/queue/syllabus-extraction.ts.
 *
 * The waiting-jobs count is the useful half: a worker that reports 0 waiting
 * while the producer's Upstash console shows queued jobs is proof the two
 * hosts are pointed at different databases.
 */
connection.once("ready", () => {
  void (async () => {
    const host = `${connection.options.host}:${connection.options.port}`;
    try {
      const waiting = await connection.llen(
        `bull:${SYLLABUS_EXTRACTION_QUEUE}:wait`,
      );
      const active = await connection.llen(
        `bull:${SYLLABUS_EXTRACTION_QUEUE}:active`,
      );
      console.log(
        `[syllabus-extraction] connected to ${host} — ${waiting} waiting, ${active} active`,
      );
    } catch (e) {
      console.error(
        `[syllabus-extraction] connected to ${host} but queue probe failed`,
        e,
      );
    }
    console.log("[syllabus-extraction] worker started, waiting for jobs");
  })();
});
