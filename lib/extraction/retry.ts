/**
 * Retries one Gemini call. Replaces what BullMQ's `attempts: 3` + backoff used
 * to do for the whole job — now per chunk, so one flaky chunk doesn't re-run
 * every other chunk's (already paid-for) call.
 *
 * Every error is retried: 429/5xx and network blips obviously, but also a
 * degenerate-output or non-STOP rejection, since those were retried under the
 * queue too and sometimes clear on a second sample. Kept short (3 attempts,
 * 2s then 6s) because the whole extraction has to fit in the function's
 * 300s maxDuration.
 */
export const RETRY_DELAYS_MS = [2_000, 6_000];

export async function withRetry<T>(
  fn: () => Promise<T>,
  delaysMs: number[] = RETRY_DELAYS_MS,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt >= delaysMs.length || isPermanent(err)) throw err;
      await sleep(delaysMs[attempt]);
    }
  }
}

/** Errors no retry can fix: a missing key, or Gemini refusing the prompt. */
function isPermanent(err: unknown): boolean {
  const message = err instanceof Error ? err.message : "";
  return message.includes("GEMINI_API_KEY is not set") || message.includes("blocked the request");
}
