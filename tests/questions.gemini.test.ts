import { describe, expect, it } from "vitest";
import { describeUnfinished } from "@/worker/gemini-extract-questions";

/**
 * A MAX_TOKENS finish has three different causes with three different fixes
 * (hidden thinking eating the budget, a repetition loop, genuinely long
 * output). The error must carry the token breakdown that tells them apart,
 * because it is the only record a failed import keeps.
 */
describe("describeUnfinished", () => {
  it("reports thinking vs answer tokens when the API returns thoughtsTokenCount", () => {
    expect(
      describeUnfinished("MAX_TOKENS", {
        promptTokenCount: 3021,
        candidatesTokenCount: 1284,
        thoughtsTokenCount: 15100,
        totalTokenCount: 19405,
      }),
    ).toBe("Gemini did not finish cleanly (MAX_TOKENS; answer 1284, thinking 15100, prompt 3021)");
  });

  it("derives thinking from the total when thoughtsTokenCount is absent", () => {
    expect(
      describeUnfinished("MAX_TOKENS", { promptTokenCount: 100, candidatesTokenCount: 50, totalTokenCount: 400 }),
    ).toBe("Gemini did not finish cleanly (MAX_TOKENS; answer 50, thinking 250, prompt 100)");
  });

  it("still names the finish reason when usage is missing", () => {
    expect(describeUnfinished("SAFETY", undefined)).toBe("Gemini did not finish cleanly (SAFETY)");
  });
});

describe("QUESTION_GENERATION_CONFIG", () => {
  /**
   * Measured on a real 5-page tutorial: with thinking uncapped, Gemini spent
   * 15727 of 16384 output tokens thinking and left 643 for the answer, so every
   * attempt ended MAX_TOKENS. Thinking shares maxOutputTokens with the answer.
   */
  it("caps thinking so most of the output budget is left for the transcription", async () => {
    const { QUESTION_GENERATION_CONFIG } = await import("@/worker/gemini-extract-questions");
    const budget = QUESTION_GENERATION_CONFIG.thinkingConfig.thinkingBudget;
    expect(budget).toBeGreaterThanOrEqual(0);
    expect(QUESTION_GENERATION_CONFIG.maxOutputTokens - budget).toBeGreaterThanOrEqual(12_000);
    expect(QUESTION_GENERATION_CONFIG.temperature).toBe(0);
  });
});
