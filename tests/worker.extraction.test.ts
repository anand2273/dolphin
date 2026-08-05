import { describe, expect, it } from "vitest";
import {
  MAX_CONCEPTS_PER_TOPIC,
  MAX_TOPICS,
  isDegenerate,
  truncate,
  type SyllabusExtractionResult,
} from "@/worker/gemini-extract";
import { mergeExtractionResults } from "@/worker/process-syllabus-extraction";

/**
 * The worker's pure functions. These run on every real extraction but never
 * touch the network or the DB, so they are cheap to pin down — and a bug in
 * mergeExtractionResults silently drops or duplicates a tutor's topics rather
 * than failing the job.
 */

type Topic = SyllabusExtractionResult["topics"][number];

const topic = (
  name: string,
  concepts: string[] = [],
  description?: string,
): Topic => ({
  name,
  ...(description ? { description } : {}),
  concepts: concepts.map((c) => ({ name: c })),
});

const result = (...topics: Topic[]): SyllabusExtractionResult => ({ topics });

describe("mergeExtractionResults", () => {
  it("returns an empty result for no chunks", () => {
    expect(mergeExtractionResults([])).toEqual({ topics: [] });
  });

  it("passes a single chunk through unchanged", () => {
    const only = result(topic("vectors", ["dot product"]));
    expect(mergeExtractionResults([only])).toEqual(only);
  });

  it("keeps distinct topics from different chunks, in document order", () => {
    const merged = mergeExtractionResults([
      result(topic("vectors")),
      result(topic("matrices")),
      result(topic("complex numbers")),
    ]);
    expect(merged.topics.map((t) => t.name)).toEqual([
      "vectors",
      "matrices",
      "complex numbers",
    ]);
  });

  /** The one-page chunk overlap (pdf-chunk.ts) makes this the common case. */
  it("merges a topic repeated across consecutive chunks", () => {
    const merged = mergeExtractionResults([
      result(topic("vectors", ["dot product"])),
      result(topic("vectors", ["cross product"])),
    ]);
    expect(merged.topics).toHaveLength(1);
    expect(merged.topics[0].concepts.map((c) => c.name)).toEqual([
      "dot product",
      "cross product",
    ]);
  });

  it("matches topic names case-insensitively, keeping the first spelling", () => {
    const merged = mergeExtractionResults([
      result(topic("vectors", ["dot product"])),
      result(topic("VECTORS", ["cross product"])),
    ]);
    expect(merged.topics).toHaveLength(1);
    expect(merged.topics[0].name).toBe("vectors");
    expect(merged.topics[0].concepts).toHaveLength(2);
  });

  it("dedupes concepts case-insensitively within a merged topic", () => {
    const merged = mergeExtractionResults([
      result(topic("vectors", ["dot product"])),
      result(topic("vectors", ["Dot Product", "cross product"])),
    ]);
    expect(merged.topics[0].concepts.map((c) => c.name)).toEqual([
      "dot product",
      "cross product",
    ]);
  });

  it("keeps a topic that appears with no concepts", () => {
    const merged = mergeExtractionResults([result(topic("notation"))]);
    expect(merged.topics[0].concepts).toEqual([]);
  });

  it("does not mutate its input", () => {
    const first = result(topic("vectors", ["dot product"]));
    const second = result(topic("vectors", ["cross product"]));
    const snapshot = structuredClone([first, second]);

    mergeExtractionResults([first, second]);

    expect([first, second]).toEqual(snapshot);
  });
});

describe("isDegenerate", () => {
  it("accepts an ordinary result", () => {
    expect(
      isDegenerate(
        result(
          topic("vectors", ["dot product", "cross product"]),
          topic("matrices", ["determinant"]),
        ),
      ),
    ).toBe(false);
  });

  it("accepts an empty result", () => {
    expect(isDegenerate(result())).toBe(false);
  });

  it("flags a repeated topic name loop", () => {
    const topics = Array.from({ length: 10 }, () => topic("vectors"));
    expect(isDegenerate(result(...topics))).toBe(true);
  });

  it("flags repeated concept names within one topic", () => {
    const concepts = Array.from({ length: 10 }, () => "dot product");
    expect(isDegenerate(result(topic("vectors", concepts)))).toBe(true);
  });

  it("flags a description repeating one phrase to fill the buffer", () => {
    const filler = "the student will be able to ".repeat(40);
    expect(isDegenerate(result(topic("vectors", [], filler)))).toBe(true);
  });

  it("accepts a long but varied description", () => {
    // Same length class as the filler above, but genuinely varied wording.
    const varied = Array.from(
      { length: 60 },
      (_, i) => `distinct-clause-${i}`,
    ).join(" ");
    expect(varied.length).toBeGreaterThan(300);
    expect(isDegenerate(result(topic("vectors", [], varied)))).toBe(false);
  });

  /**
   * Documents the deliberate lower bound: a short list of legitimately similar
   * names must not trip the guard, because rejection is not recoverable at
   * temperature 0 — the retry reproduces the same output.
   */
  it("does not flag duplication below the 8-item threshold", () => {
    const topics = Array.from({ length: 6 }, () => topic("vectors"));
    expect(isDegenerate(result(...topics))).toBe(false);
  });

  it("does not flag a large result whose names are all distinct", () => {
    const topics = Array.from({ length: 40 }, (_, i) => topic(`topic ${i}`));
    expect(isDegenerate(result(...topics))).toBe(false);
  });
});

describe("truncate", () => {
  it("leaves a normal result untouched", () => {
    const small = result(topic("vectors", ["dot product"]));
    expect(truncate(small)).toEqual(small);
  });

  it("caps concepts per topic", () => {
    const concepts = Array.from(
      { length: MAX_CONCEPTS_PER_TOPIC + 25 },
      (_, i) => `concept ${i}`,
    );
    const trimmed = truncate(result(topic("vectors", concepts)));
    expect(trimmed.topics[0].concepts).toHaveLength(MAX_CONCEPTS_PER_TOPIC);
    expect(trimmed.topics[0].concepts.at(-1)?.name).toBe(
      `concept ${MAX_CONCEPTS_PER_TOPIC - 1}`,
    );
  });

  it("caps each topic's concepts independently", () => {
    const many = Array.from({ length: MAX_CONCEPTS_PER_TOPIC + 5 }, (_, i) => `c${i}`);
    const trimmed = truncate(
      result(topic("a", many), topic("b", ["one"]), topic("c", many)),
    );
    expect(trimmed.topics.map((t) => t.concepts.length)).toEqual([
      MAX_CONCEPTS_PER_TOPIC,
      1,
      MAX_CONCEPTS_PER_TOPIC,
    ]);
  });

  it("caps topics — defensive only, see below", () => {
    const topics = Array.from({ length: MAX_TOPICS + 10 }, (_, i) =>
      topic(`topic ${i}`),
    );
    expect(truncate(result(...topics)).topics).toHaveLength(MAX_TOPICS);
  });

  it("preserves topic fields other than concepts", () => {
    const trimmed = truncate(result(topic("vectors", ["dot"], "About vectors.")));
    expect(trimmed.topics[0]).toMatchObject({
      name: "vectors",
      description: "About vectors.",
    });
  });

  it("does not mutate its input", () => {
    const input = result(
      topic("vectors", Array.from({ length: MAX_CONCEPTS_PER_TOPIC + 5 }, (_, i) => `c${i}`)),
    );
    const snapshot = structuredClone(input);
    truncate(input);
    expect(input).toEqual(snapshot);
  });
});
