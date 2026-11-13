import { describe, expect, it, vi } from "vitest";
import { withRetry } from "@/lib/extraction/retry";
import {
  isStale,
  STALE_AFTER_MS,
  STALE_MESSAGE,
  withStaleSyllabusAsFailed,
} from "@/lib/extraction/stale";

const noSleep = async () => {};

describe("withRetry", () => {
  it("returns the first success without retrying", async () => {
    const fn = vi.fn(async () => "ok");
    await expect(withRetry(fn, [1, 1], noSleep)).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries a transient failure (e.g. a 429) and then succeeds", async () => {
    const fn = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error("[429 Too Many Requests]"))
      .mockResolvedValueOnce("ok");
    await expect(withRetry(fn, [1, 1], noSleep)).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("gives up after one try per delay plus the first, rethrowing the last error", async () => {
    const fn = vi.fn(async () => {
      throw new Error("Gemini returned degenerate repeated output");
    });
    await expect(withRetry(fn, [1, 1], noSleep)).rejects.toThrow("degenerate");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("does not retry errors no retry can fix", async () => {
    for (const message of [
      "GEMINI_API_KEY is not set",
      "Gemini blocked the request (SAFETY)",
      "Gemini did not finish cleanly (MAX_TOKENS; answer 643, thinking 7549, prompt 2100)",
    ]) {
      const fn = vi.fn(async () => {
        throw new Error(message);
      });
      await expect(withRetry(fn, [1, 1], noSleep)).rejects.toThrow(message);
      expect(fn).toHaveBeenCalledTimes(1);
    }
  });
});

describe("stale extraction", () => {
  const now = new Date("2026-11-13T12:00:00Z");
  const ago = (ms: number) => new Date(now.getTime() - ms);

  it("is stale only when in flight AND past the cutoff", () => {
    expect(isStale("processing", ago(STALE_AFTER_MS + 1), now)).toBe(true);
    expect(isStale("pending", ago(STALE_AFTER_MS + 1), now)).toBe(true);
    expect(isStale("processing", ago(STALE_AFTER_MS - 1), now)).toBe(false);
    expect(isStale("failed", ago(STALE_AFTER_MS * 10), now)).toBe(false);
    expect(isStale("done", ago(STALE_AFTER_MS * 10), now)).toBe(false);
  });

  it("reads a stuck syllabus as failed with a readable reason", () => {
    const row = { extractionStatus: "processing", extractionError: null, updatedAt: ago(STALE_AFTER_MS * 2) };
    expect(withStaleSyllabusAsFailed(row, now)).toMatchObject({
      extractionStatus: "failed",
      extractionError: STALE_MESSAGE,
    });
  });

  it("leaves a syllabus that is genuinely still extracting alone", () => {
    const row = { extractionStatus: "processing", extractionError: null, updatedAt: ago(30_000) };
    expect(withStaleSyllabusAsFailed(row, now)).toBe(row);
  });
});
