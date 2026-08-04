import { NextResponse } from "next/server";
import IORedis from "ioredis";
import { getAuthUser, getProfile } from "@/lib/auth/session";

/**
 * TEMPORARY diagnostic — delete once the Vercel→Redis path is confirmed.
 *
 * Answers one question from Vercel's own vantage point: can this deployment
 * reach the Redis that REDIS_URL names, with the same ioredis client BullMQ
 * uses? Reports the failure mode precisely (missing env, DNS, TLS/timeout,
 * auth) instead of the producer's worst case, a silent hang. On success it
 * also lists bull:* keys, which tells you whether any enqueue has EVER
 * reached this instance.
 *
 * Tutor-gated like every other route; redacts credentials — only scheme,
 * host and port are ever echoed back.
 */

const STAGE_BUDGET_MS = { connect: 6_000, command: 2_000 } as const;

function withTimeout<T>(p: Promise<T>, ms: number, stage: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(
      () =>
        reject(
          new Error(
            `${stage} neither succeeded nor failed within ${ms}ms — this is the silent-hang mode`,
          ),
        ),
      ms,
    );
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

function describeError(e: unknown) {
  const err = e as NodeJS.ErrnoException;
  return {
    name: err?.name ?? "Error",
    message: err?.message ?? String(e),
    code: err?.code ?? null,
    syscall: err?.syscall ?? null,
  };
}

export async function GET() {
  const user = await getAuthUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  const profile = await getProfile(user.id);
  if (profile?.role !== "tutor") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) {
    return NextResponse.json({
      ok: false,
      stage: "env",
      error: "REDIS_URL is not set in this deployment's environment",
    });
  }

  let target;
  try {
    const u = new URL(redisUrl);
    target = {
      scheme: u.protocol.replace(":", ""),
      host: u.hostname,
      port: u.port || "(default)",
      tls: u.protocol === "rediss:",
      passwordPresent: u.password.length > 0,
    };
  } catch {
    return NextResponse.json({
      ok: false,
      stage: "env",
      error: "REDIS_URL is not a parseable URL",
    });
  }
  if (target.scheme !== "redis" && target.scheme !== "rediss") {
    return NextResponse.json({
      ok: false,
      stage: "env",
      target,
      error: `REDIS_URL scheme is "${target.scheme}" — BullMQ needs the TCP URI (rediss://…), not the REST URL`,
    });
  }

  // Same options as the producer (lib/queue/syllabus-extraction.ts), plus
  // lazyConnect + a no-retry strategy so exactly one attempt runs and its
  // outcome — not a reconnect loop — is what gets reported.
  const client = new IORedis(redisUrl, {
    maxRetriesPerRequest: 3,
    enableOfflineQueue: false,
    connectTimeout: 5_000,
    lazyConnect: true,
    retryStrategy: () => null,
  });

  const startedAt = Date.now();
  try {
    await withTimeout(client.connect(), STAGE_BUDGET_MS.connect, "connect");
    const connectMs = Date.now() - startedAt;

    const pingStart = Date.now();
    const pong = await withTimeout(client.ping(), STAGE_BUDGET_MS.command, "PING");
    const pingMs = Date.now() - pingStart;

    const bullKeys = await withTimeout(
      client.keys("bull:*"),
      STAGE_BUDGET_MS.command,
      "KEYS bull:*",
    );

    return NextResponse.json({
      ok: true,
      target,
      connectMs,
      ping: { reply: pong, ms: pingMs },
      bullKeys: { count: bullKeys.length, keys: bullKeys.sort().slice(0, 50) },
      verdict:
        bullKeys.length > 0
          ? "This deployment reaches Redis, and enqueues have reached this instance."
          : "This deployment reaches Redis, but NO bull:* keys exist — no enqueue has ever landed here. Suspect the enqueue call path, or a different instance being written.",
    });
  } catch (e) {
    return NextResponse.json({
      ok: false,
      stage: "connect/command",
      target,
      elapsedMs: Date.now() - startedAt,
      error: describeError(e),
    });
  } finally {
    // disconnect(), not quit() — quit sends a command, which can itself hang
    // on a half-dead connection.
    client.disconnect();
  }
}
