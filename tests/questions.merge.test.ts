import { describe, expect, it } from "vitest";
import {
  clampBox,
  mergeQuestionChunks,
  normalisePartLabel,
  normaliseQuestionLabel,
  normaliseSection,
  type ChunkInput,
} from "@/lib/extraction/merge-questions";
import type { QuestionChunkResult } from "@/lib/extraction/question-schema";

type Q = QuestionChunkResult["questions"][number];
type A = QuestionChunkResult["answers"][number];

const q = (over: Partial<Q> = {}): Q => ({
  sectionLabel: null,
  label: "1",
  stem: "stem",
  topicRef: "T1",
  conceptRefs: [],
  startPage: 1,
  endPage: 1,
  figures: [],
  parts: [],
  answer: null,
  ...over,
});

const chunk = (startPage: number, endPage: number, questions: Q[], answers: A[] = []): ChunkInput => ({
  startPage,
  endPage,
  result: { questions, answers },
});

describe("label normalisation", () => {
  it.each([
    ["Q3", "3"],
    ["Question 12", "12"],
    ["3.", "3"],
    ["(3)", "3"],
    [" q 7: ", "7"],
  ])("question label %s -> %s", (raw, out) => {
    expect(normaliseQuestionLabel(raw)).toBe(out);
  });

  it.each([
    ["(a)(i)", "ai"],
    ["a(i)", "ai"],
    ["a) i)", "ai"],
    ["(ii)", "ii"],
    ["(B)", "b"],
  ])("part label %s -> %s", (raw, out) => {
    expect(normalisePartLabel(raw)).toBe(out);
  });

  it("normalises section labels and treats null as empty", () => {
    expect(normaliseSection("  Section   B: ")).toBe("section b");
    expect(normaliseSection(null)).toBe("");
  });
});

describe("clampBox", () => {
  it("keeps a valid box", () => {
    expect(clampBox([100, 200, 300, 400])).toEqual([100, 200, 300, 400]);
  });
  it("clamps out-of-range coordinates", () => {
    expect(clampBox([-5, 10, 1200, 900])).toEqual([0, 10, 1000, 900]);
  });
  it.each([[null], [undefined], [[1, 2, 3]], [[300, 0, 100, 500]], [[0, 500, 100, 500]]])(
    "discards an unusable box %j",
    (raw) => {
      expect(clampBox(raw as number[] | null | undefined)).toBeNull();
    },
  );
});

describe("mergeQuestionChunks", () => {
  it("converts chunk-relative pages to absolute pages", () => {
    const { questions } = mergeQuestionChunks([
      chunk(3, 5, [q({ startPage: 2, endPage: 3, figures: [{ page: 2, box2d: [1, 1, 2, 2] }] })]),
    ]);
    expect(questions[0].startPage).toBe(4);
    expect(questions[0].endPage).toBe(5);
    expect(questions[0].figures[0].page).toBe(4);
  });

  it("clamps a page outside the chunk back into it", () => {
    const { questions } = mergeQuestionChunks([chunk(3, 5, [q({ startPage: 9, endPage: 9 })])]);
    expect(questions[0].startPage).toBe(5);
  });

  it("keeps a figure whose box is nonsense, with a null box", () => {
    const { questions } = mergeQuestionChunks([
      chunk(1, 3, [q({ figures: [{ page: 1, box2d: [500, 0, 100, 10] }] })]),
    ]);
    expect(questions[0].figures).toEqual([{ page: 1, box: null }]);
  });

  /** The 1-page overlap makes this the common case. */
  it("dedupes a question seen in two overlapping chunks, keeping the more complete copy", () => {
    const partial = q({ label: "5", startPage: 3, endPage: 3, parts: [{ label: "(a)", body: "a" }] });
    const full = q({
      label: "Q5",
      startPage: 1,
      endPage: 2,
      parts: [
        { label: "(a)", body: "a" },
        { label: "(b)", body: "b" },
      ],
    });
    const { questions } = mergeQuestionChunks([chunk(1, 3, [partial]), chunk(3, 5, [full])]);
    expect(questions).toHaveLength(1);
    expect(questions[0].parts).toHaveLength(2);
    expect(questions[0].startPage).toBe(3);
    expect(questions[0].endPage).toBe(4);
  });

  it("does NOT merge the same number far apart with no section label (two sections restarting at 1)", () => {
    const { questions } = mergeQuestionChunks([
      chunk(1, 3, [q({ label: "1", stem: "first", startPage: 1, endPage: 1 })]),
      chunk(7, 9, [q({ label: "1", stem: "second", startPage: 1, endPage: 1 })]),
    ]);
    expect(questions.map((x) => x.stem)).toEqual(["first", "second"]);
  });

  it("does NOT merge the same number under different section labels on the same page", () => {
    const { questions } = mergeQuestionChunks([
      chunk(1, 3, [q({ sectionLabel: "A", label: "1" }), q({ sectionLabel: "B", label: "1" })]),
    ]);
    expect(questions).toHaveLength(2);
  });

  it("never merges two same-numbered questions emitted by ONE chunk (overlap repeats only cross chunks)", () => {
    const { questions } = mergeQuestionChunks([
      chunk(1, 3, [
        q({ label: "1", stem: "Exercise 3A first", startPage: 2, endPage: 2 }),
        q({ label: "1", stem: "Exercise 3B first", startPage: 2, endPage: 2 }),
      ]),
    ]);
    expect(questions.map((x) => x.stem)).toEqual(["Exercise 3A first", "Exercise 3B first"]);
  });

  it("still merges a question that spans three overlapping chunks into one", () => {
    const { questions } = mergeQuestionChunks([
      chunk(1, 3, [q({ label: "7", startPage: 3, endPage: 3 })]),
      chunk(3, 5, [q({ label: "7", startPage: 1, endPage: 3, parts: [{ label: "(a)", body: "a" }] })]),
      chunk(5, 7, [q({ label: "7", startPage: 1, endPage: 1 })]),
    ]);
    expect(questions).toHaveLength(1);
    expect(questions[0].parts).toHaveLength(1);
  });

  it("never merges unlabeled questions with each other", () => {
    const { questions } = mergeQuestionChunks([
      chunk(1, 3, [q({ label: "", stem: "challenge A", startPage: 3, endPage: 3 })]),
      chunk(3, 5, [q({ label: "", stem: "challenge B", startPage: 1, endPage: 1 })]),
    ]);
    expect(questions).toHaveLength(2);
  });

  /**
   * Real paper (RI H2 Math Tutorial 7B, 2026-11-11): chunk 2 (pp.3-5) never
   * sees the "Section B" heading on p.1, so the model leaves sectionLabel
   * empty there. Q7 on the overlap page then came out twice, and Q8/Q9 lost
   * their section.
   */
  it("carries a section heading forward to later questions the model left unlabeled", () => {
    const { questions } = mergeQuestionChunks([
      chunk(1, 3, [
        q({ sectionLabel: "Section A", label: "1", startPage: 1, endPage: 1 }),
        q({ sectionLabel: "Section B", label: "6", startPage: 2, endPage: 2 }),
        q({ sectionLabel: "Section B", label: "7", startPage: 3, endPage: 3, parts: [{ label: "(a)", body: "a" }] }),
      ]),
      chunk(3, 5, [
        q({ sectionLabel: null, label: "7", startPage: 1, endPage: 1, parts: [{ label: "(a)", body: "a" }, { label: "(b)", body: "b" }] }),
        q({ sectionLabel: null, label: "8", startPage: 2, endPage: 2 }),
      ]),
    ]);
    expect(questions.map((x) => `${x.sectionLabel}|${x.label}`)).toEqual([
      "Section A|1",
      "Section B|6",
      "Section B|7",
      "Section B|8",
    ]);
    expect(questions[2].parts).toHaveLength(2);
  });

  it("leaves a worksheet with no sections at all unlabeled", () => {
    const { questions } = mergeQuestionChunks([chunk(1, 3, [q({ label: "1" }), q({ label: "2", startPage: 2, endPage: 2 })])]);
    expect(questions.map((x) => x.sectionLabel)).toEqual([null, null]);
  });

  it("orders questions by first appearance", () => {
    const { questions } = mergeQuestionChunks([
      chunk(1, 3, [q({ label: "2", startPage: 3, endPage: 3 }), q({ label: "1", startPage: 1, endPage: 1 })]),
    ]);
    expect(questions.map((x) => x.label)).toEqual(["1", "2"]);
  });

  describe("answer pairing", () => {
    const paper = chunk(1, 3, [
      q({
        label: "3",
        startPage: 1,
        endPage: 1,
        parts: [
          { label: "(a)(i)", body: "x" },
          { label: "(a)(ii)", body: "y", answer: "inline" },
        ],
      }),
      q({ label: "4", startPage: 2, endPage: 2 }),
    ]);

    it("pairs answer-key entries despite label formatting differences", () => {
      const { questions, unpairedAnswers } = mergeQuestionChunks([
        paper,
        chunk(7, 9, [], [
          { sectionLabel: null, questionLabel: "Q3", partLabel: "a i", page: 1, answer: "42" },
          { sectionLabel: null, questionLabel: "4.", partLabel: null, page: 1, answer: "x = 2" },
        ]),
      ]);
      expect(questions[0].parts[0].answer).toBe("42");
      expect(questions[1].answer).toBe("x = 2");
      expect(unpairedAnswers).toBe(0);
    });

    it("keeps an inline answer over an answer-key entry", () => {
      const { questions } = mergeQuestionChunks([
        paper,
        chunk(7, 9, [], [{ sectionLabel: null, questionLabel: "3", partLabel: "(a)(ii)", page: 1, answer: "key" }]),
      ]);
      expect(questions[0].parts[1].answer).toBe("inline");
    });

    it("counts entries it cannot place, once each even when the overlap repeats them", () => {
      const orphan: A = { sectionLabel: null, questionLabel: "99", partLabel: null, page: 3, answer: "?" };
      const { unpairedAnswers } = mergeQuestionChunks([
        paper,
        chunk(7, 9, [], [{ ...orphan, page: 3 }]),
        chunk(9, 11, [], [{ ...orphan, page: 1 }]), // same physical page 9
      ]);
      expect(unpairedAnswers).toBe(1);
    });

    it("counts a part-less answer to a multi-part question as unpaired", () => {
      const { unpairedAnswers } = mergeQuestionChunks([
        paper,
        chunk(7, 9, [], [{ sectionLabel: null, questionLabel: "3", partLabel: null, page: 1, answer: "?" }]),
      ]);
      expect(unpairedAnswers).toBe(1);
    });

    const twoSections = chunk(1, 3, [
      q({ label: "1", stem: "A1", startPage: 1, endPage: 1 }),
      q({ label: "1", stem: "B1", startPage: 2, endPage: 2 }),
    ]);

    it("pairs a back-of-paper key for two unlabelled sections by order, not to the last section", () => {
      const { questions, unpairedAnswers } = mergeQuestionChunks([
        twoSections,
        chunk(7, 9, [], [
          { sectionLabel: null, questionLabel: "1", partLabel: null, page: 1, answer: "ans-A" },
          { sectionLabel: null, questionLabel: "1", partLabel: null, page: 1, answer: "ans-B" },
        ]),
      ]);
      expect(questions.map((x) => x.answer)).toEqual(["ans-A", "ans-B"]);
      expect(unpairedAnswers).toBe(0);
    });

    it("pairs by order when the key's section text differs from the questions'", () => {
      const { questions } = mergeQuestionChunks([
        chunk(1, 3, [
          q({ sectionLabel: "Section A: Algebra", label: "1", stem: "A1", startPage: 1, endPage: 1 }),
          q({ sectionLabel: "Section B: Calculus", label: "1", stem: "B1", startPage: 2, endPage: 2 }),
        ]),
        chunk(7, 9, [], [
          { sectionLabel: "Section A", questionLabel: "1", partLabel: null, page: 1, answer: "ans-A" },
          { sectionLabel: "Section B", questionLabel: "1", partLabel: null, page: 1, answer: "ans-B" },
        ]),
      ]);
      expect(questions.map((x) => x.answer)).toEqual(["ans-A", "ans-B"]);
    });

    it("counts entries as unpaired rather than guessing when a label is ambiguous and counts differ", () => {
      const { questions, unpairedAnswers } = mergeQuestionChunks([
        twoSections,
        chunk(7, 9, [], [{ sectionLabel: null, questionLabel: "1", partLabel: null, page: 1, answer: "?" }]),
      ]);
      expect(questions.map((x) => x.answer)).toEqual([null, null]);
      expect(unpairedAnswers).toBe(1);
    });

    it("counts a second key entry for an already-keyed target as unpaired", () => {
      const { questions, unpairedAnswers } = mergeQuestionChunks([
        chunk(1, 3, [q({ label: "4", startPage: 1, endPage: 1 })]),
        chunk(7, 9, [], [
          { sectionLabel: null, questionLabel: "4", partLabel: null, page: 1, answer: "first" },
          { sectionLabel: null, questionLabel: "4", partLabel: null, page: 2, answer: "second" },
        ]),
      ]);
      expect(questions[0].answer).toBe("first");
      expect(unpairedAnswers).toBe(1);
    });
  });
});
