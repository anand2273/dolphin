import { describe, expect, it } from "vitest";
import {
  NO_TOPIC,
  buildQuestionHandles,
  resolveConceptRefs,
  resolveTopicRef,
  type SyllabusVocabulary,
} from "@/lib/extraction/question-handles";
import {
  MAX_PARTS_PER_QUESTION,
  buildQuestionResponseSchema,
  isDegenerateQuestions,
  makeQuestionChunkSchema,
  truncateQuestions,
  type QuestionChunkResult,
} from "@/lib/extraction/question-schema";

const vocab: SyllabusVocabulary = {
  topics: [
    {
      id: "topic-quad",
      name: "quadratic functions",
      concepts: [
        { id: "c-disc", name: "discriminant" },
        { id: "c-cts", name: "completing the square" },
      ],
    },
    {
      id: "topic-graphs",
      name: "graphs\nand transformations",
      // Shared with the first topic: one concept, one handle.
      concepts: [{ id: "c-cts", name: "completing the square" }],
    },
    { id: "topic-vec", name: "vectors", concepts: [] },
  ],
};

describe("buildQuestionHandles", () => {
  const h = buildQuestionHandles(vocab);

  it("numbers topics in syllabus order", () => {
    expect(h.topicHandles).toEqual(["T1", "T2", "T3"]);
    expect(h.topicIdByHandle.get("T2")).toBe("topic-graphs");
  });

  it("gives a concept shared by two topics exactly one handle", () => {
    expect(h.conceptHandles).toEqual(["C1", "C2"]);
    expect(h.conceptIdByHandle.get("C2")).toBe("c-cts");
  });

  it("renders a prompt block listing each topic with its concepts' handles", () => {
    expect(h.promptBlock).toBe(
      "TOPICS\n" +
        "T1: quadratic functions — discriminant (C1), completing the square (C2)\n" +
        "T2: graphs and transformations — completing the square (C2)\n" +
        "T3: vectors",
    );
  });

  it("maps NONE and unknown topic handles to null", () => {
    expect(resolveTopicRef(h, "T1")).toBe("topic-quad");
    expect(resolveTopicRef(h, NO_TOPIC)).toBeNull();
    expect(resolveTopicRef(h, "T99")).toBeNull();
  });

  it("maps concept handles to ids, deduped, dropping unknowns", () => {
    expect(resolveConceptRefs(h, ["C2", "C1", "C2", "C9"])).toEqual(["c-cts", "c-disc"]);
  });
});

const question = (over: Partial<QuestionChunkResult["questions"][number]> = {}) => ({
  label: "1",
  stem: "Solve $x^2 = 4$.",
  topicRef: "T1",
  conceptRefs: [],
  startPage: 1,
  endPage: 1,
  figures: [],
  parts: [],
  ...over,
});

describe("makeQuestionChunkSchema", () => {
  const schema = makeQuestionChunkSchema(buildQuestionHandles(vocab));

  it("accepts a well-formed chunk and defaults missing arrays", () => {
    const parsed = schema.parse({ questions: [{ ...question(), figures: undefined }] });
    expect(parsed.questions[0].figures).toEqual([]);
    expect(parsed.answers).toEqual([]);
  });

  it("accepts null for optional strings (Gemini emits nulls)", () => {
    expect(() =>
      schema.parse({ questions: [question({ sectionLabel: null, answer: null })], answers: [] }),
    ).not.toThrow();
  });

  it("accepts an unnumbered question (empty label) instead of failing the chunk", () => {
    expect(schema.safeParse({ questions: [question({ label: "" })] }).success).toBe(true);
  });

  it("drops blank answer-key entries instead of failing the chunk", () => {
    const parsed = schema.parse({
      questions: [],
      answers: [
        { questionLabel: "", page: 1, answer: "x" },
        { questionLabel: "3", page: 1, answer: "   " },
        { questionLabel: "4", page: 1, answer: "y = 2" },
      ],
    });
    expect(parsed.answers.map((a) => a.questionLabel)).toEqual(["4"]);
  });

  it("truncates oversized text fields instead of rejecting the chunk", () => {
    const parsed = schema.parse({
      questions: [question({ sectionLabel: "S".repeat(500), label: "1".repeat(80), stem: "x".repeat(30_000) })],
    });
    const q = parsed.questions[0];
    expect(q.sectionLabel).toHaveLength(200);
    expect(q.label).toHaveLength(50);
    expect(q.stem).toHaveLength(20_000);
  });

  it("rejects a topic handle that is not in this syllabus", () => {
    expect(schema.safeParse({ questions: [question({ topicRef: "T42" })] }).success).toBe(false);
  });

  it("rejects a concept handle that is not in this syllabus", () => {
    expect(schema.safeParse({ questions: [question({ conceptRefs: ["C7"] })] }).success).toBe(false);
  });
});

describe("buildQuestionResponseSchema", () => {
  type Props = Record<string, { enum?: string[]; items?: { enum?: string[] } }>;
  const props = (h: ReturnType<typeof buildQuestionHandles>) =>
    (buildQuestionResponseSchema(h) as unknown as {
      properties: { questions: { items: { properties: Props; required: string[] } } };
    }).properties.questions.items;

  it("constrains topicRef to this syllabus's handles plus NONE", () => {
    expect(props(buildQuestionHandles(vocab)).properties.topicRef.enum).toEqual([
      "T1",
      "T2",
      "T3",
      NO_TOPIC,
    ]);
  });

  it("constrains conceptRefs items to this syllabus's concept handles", () => {
    expect(props(buildQuestionHandles(vocab)).properties.conceptRefs.items?.enum).toEqual([
      "C1",
      "C2",
    ]);
  });

  it("omits conceptRefs entirely when the syllabus has no concepts (an empty enum is invalid)", () => {
    const h = buildQuestionHandles({ topics: [{ id: "t", name: "vectors", concepts: [] }] });
    expect(props(h).properties.conceptRefs).toBeUndefined();
    expect(props(h).required).not.toContain("conceptRefs");
  });
});

describe("isDegenerateQuestions", () => {
  const result = (qs: ReturnType<typeof question>[]): QuestionChunkResult =>
    ({ questions: qs, answers: [] }) as unknown as QuestionChunkResult;

  it("passes ordinary output", () => {
    expect(
      isDegenerateQuestions(result([question({ label: "1" }), question({ label: "2" })])),
    ).toBe(false);
  });

  it("flags many questions mostly sharing the same label", () => {
    expect(
      isDegenerateQuestions(result(Array.from({ length: 10 }, () => question({ label: "3" })))),
    ).toBe(true);
  });

  it("does NOT flag restarted numbering with distinct stems when the model dropped the section label", () => {
    const qs = ["A", "B"].flatMap((s) =>
      Array.from({ length: 5 }, (_, i) => question({ label: String(i + 1), stem: `${s}: item ${i + 1}` })),
    );
    expect(isDegenerateQuestions(result(qs))).toBe(false);
  });

  it("does NOT flag repeated numbering under different section labels", () => {
    const qs = ["A", "B"].flatMap((s) =>
      Array.from({ length: 5 }, (_, i) => question({ sectionLabel: s, label: String(i + 1) })),
    );
    expect(isDegenerateQuestions(result(qs))).toBe(false);
  });

  it("flags a long field made of a handful of repeated tokens", () => {
    expect(
      isDegenerateQuestions(result([question({ stem: "the value the value ".repeat(200) })])),
    ).toBe(true);
  });

  it("does NOT flag a long but varied LaTeX stem", () => {
    const stem = Array.from({ length: 300 }, (_, i) => `$x_{${i}} = ${i * 3}$`).join(" ");
    expect(isDegenerateQuestions(result([question({ stem })]))).toBe(false);
  });
});

describe("truncateQuestions", () => {
  it("trims parts beyond the cap instead of rejecting", () => {
    const parts = Array.from({ length: MAX_PARTS_PER_QUESTION + 5 }, (_, i) => ({
      label: `(${i})`,
      body: "x",
    }));
    const out = truncateQuestions({
      questions: [question({ parts })],
      answers: [],
    } as unknown as QuestionChunkResult);
    expect(out.questions[0].parts).toHaveLength(MAX_PARTS_PER_QUESTION);
  });
});
