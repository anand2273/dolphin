import IORedis from "ioredis";

/**
 * The one Redis connection every producer queue in the Next app shares.
 *
 * These options are deliberately NOT the worker's. `maxRetriesPerRequest:
 * null` is required for BullMQ's *blocking* connections only (bullmq's
 * RedisConnection enforces it under `extraOptions.blocking`) — a Queue
 * producer is non-blocking. Setting null here was a real outage: with an
 * unreachable Redis, ioredis parks the command and reconnects forever, so
 * `queue.add()` never resolves or rejects, `confirmSyllabusDocumentUpload`
 * never returns, and the user watches an upload spinner until Vercel's
 * function timeout. Fail fast instead, so a bad REDIS_URL surfaces as an
 * error the action can return. See deploy.md §9d.
 */
let connection: IORedis | null = null;

export function getProducerConnection(): IORedis {
  if (connection) return connection;

  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) {
    throw new Error("REDIS_URL is not set — required to enqueue background jobs.");
  }
  connection = new IORedis(redisUrl, {
    maxRetriesPerRequest: 3,
    enableOfflineQueue: false,
    connectTimeout: 5_000,
  });
  return connection;
}
