import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  concepts,
  questionConcepts,
  questionFigures,
  questionImports,
  questionParts,
  questions,
  topicConcepts,
  topics,
} from "@/lib/db/schema";
import { NO_TOPICS_MESSAGE } from "@/lib/validation/question";
import {
  createTestSyllabus,
  createTestUser,
  insertImport,
  teardownTutor,
  type TestUser,
} from "./helpers/seed";

// The network edges are mocked; everything between them (vocabulary load,
// handle mapping, merge, the write transaction) runs for real against the DB.
// vi.hoisted: vi.mock factories are hoisted above ordinary declarations.
const { extractQuestions } = vi.hoisted(() => ({ extractQuestions: vi.fn() }));
vi.mock("@/worker/gemini-extract-questions", () => ({ extractQuestions }));
vi.mock("@/worker/pdf-chunk", () => ({
  chunkPdfByPages: async () => [
    { fileBytes: new ArrayBuffer(1), startPage: 1, endPage: 3, totalPages: 3 },
  ],
}));
vi.mock("@/lib/storage/objects", async (orig) => ({
  ...(await orig<typeof import("@/lib/storage/objects")>()),
  createSignedDownloadUrl: async () => "http://storage.test/object",
}));
// Only the storage download is faked. Everything else passes through: the
// Supabase admin client behind createTestUser/deleteTestUser also uses fetch.
const realFetch = globalThis.fetch;
vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) =>
  String(input) === "http://storage.test/object"
    ? Promise.resolve(new Response(new ArrayBuffer(1), { status: 200 }))
    : realFetch(input, init),
);

const { processQuestionExtraction } = await import("@/worker/process-question-extraction");

describe("processQuestionExtraction", () => {
  let tutor: TestUser;
  let syllabusWithTopics: string;
  let emptySyllabus: string;
  let topicId: string;
  let conceptId: string;

  beforeAll(async () => {
    tutor = await createTestUser("qw-tutor", "tutor");
    syllabusWithTopics = await createTestSyllabus(tutor.id, "H2 Math");
    emptySyllabus = await createTestSyllabus(tutor.id, "No topics yet");
    const [t] = await db
      .insert(topics)
      .values({ syllabusId: syllabusWithTopics, tutorId: tutor.id, name: "quadratics", orderIndex: 0 })
      .returning({ id: topics.id });
    topicId = t.id;
    const [c] = await db
      .insert(concepts)
      .values({ tutorId: tutor.id, name: "discriminant" })
      .returning({ id: concepts.id });
    conceptId = c.id;
    await db.insert(topicConcepts).values({ topicId, conceptId });
  });

  afterAll(async () => {
    await db.delete(concepts).where(eq(concepts.tutorId, tutor.id));
    await teardownTutor(tutor);
  });

  // Braces matter: mockReset() returns the spy, and a function returned from
  // beforeEach is run as teardown, which would call the mock once more.
  beforeEach(() => {
    extractQuestions.mockReset();
  });

  it("writes drafts with parts, mapped tags, figures and paired answers", async () => {
    extractQuestions.mockResolvedValue({
      questions: [
        {
          sectionLabel: null,
          label: "1",
          stem: "Given [figure 1], find $k$.",
          topicRef: "T1",
          conceptRefs: ["C1"],
          startPage: 1,
          endPage: 1,
          figures: [{ page: 1, box2d: [100, 100, 400, 600] }],
          parts: [
            { label: "(a)", body: "Find $k$.", marks: 2, answer: null },
            { label: "(b)", body: "Hence solve.", marks: 3, answer: null },
          ],
          answer: null,
        },
      ],
      answers: [{ sectionLabel: null, questionLabel: "1", partLabel: "(a)", page: 3, answer: "k = 4" }],
    });
    const { importId } = await insertImport(tutor.id, syllabusWithTopics);

    await processQuestionExtraction({ importId });

    const [imp] = await db.select().from(questionImports).where(eq(questionImports.id, importId));
    expect(imp.status).toBe("done");
    const [question] = await db.select().from(questions).where(eq(questions.importId, importId));
    expect(question).toMatchObject({ status: "draft", topicId, label: "1", sourcePageStart: 1 });
    const parts = await db.select().from(questionParts).where(eq(questionParts.questionId, question.id));
    expect(parts.map((p) => [p.label, p.marks, p.answer])).toEqual([
      ["(a)", 2, "k = 4"],
      ["(b)", 3, null],
    ]);
    const qc = await db.select().from(questionConcepts).where(eq(questionConcepts.questionId, question.id));
    expect(qc.map((r) => r.conceptId)).toEqual([conceptId]);
    const figs = await db.select().from(questionFigures).where(eq(questionFigures.questionId, question.id));
    expect(figs).toMatchObject([{ page: 1, suggestedBox: [100, 100, 400, 600], attachmentId: null }]);
  });

  it("stores a part-less question's answer on one unlabeled part", async () => {
    extractQuestions.mockResolvedValue({
      questions: [
        {
          sectionLabel: null, label: "2", stem: "Solve $x^2=9$.", topicRef: "NONE", conceptRefs: [],
          startPage: 2, endPage: 2, figures: [], parts: [], answer: "x = ±3",
        },
      ],
      answers: [],
    });
    const { importId } = await insertImport(tutor.id, syllabusWithTopics);
    await processQuestionExtraction({ importId });
    const [question] = await db.select().from(questions).where(eq(questions.importId, importId));
    expect(question.topicId).toBeNull(); // NONE -> untagged
    const parts = await db.select().from(questionParts).where(eq(questionParts.questionId, question.id));
    expect(parts).toMatchObject([{ label: "", body: "", answer: "x = ±3" }]);
  });

  it("is a no-op for an import that is already done (redelivered job)", async () => {
    const { importId } = await insertImport(tutor.id, syllabusWithTopics, "done");
    await processQuestionExtraction({ importId });
    expect(extractQuestions).not.toHaveBeenCalled();
    expect(await db.select().from(questions).where(eq(questions.importId, importId))).toEqual([]);
  });

  it("fails readably before any Gemini call when the syllabus has no topics", async () => {
    const { importId } = await insertImport(tutor.id, emptySyllabus);
    await expect(processQuestionExtraction({ importId })).rejects.toThrow(NO_TOPICS_MESSAGE);
    expect(extractQuestions).not.toHaveBeenCalled();
    const [imp] = await db.select().from(questionImports).where(eq(questionImports.id, importId));
    expect(imp).toMatchObject({ status: "failed", error: NO_TOPICS_MESSAGE });
  });

  it("never moves a done import back to failed (a concurrent duplicate run that fails)", async () => {
    const { importId } = await insertImport(tutor.id, syllabusWithTopics);
    // Simulate the other delivery committing while this one is mid-extraction.
    extractQuestions.mockImplementation(async () => {
      await db.update(questionImports).set({ status: "done" }).where(eq(questionImports.id, importId));
      throw new Error("429 Too Many Requests");
    });
    await expect(processQuestionExtraction({ importId })).rejects.toThrow("429");
    const [imp] = await db.select().from(questionImports).where(eq(questionImports.id, importId));
    expect(imp.status).toBe("done");
  });

  it("marks the import failed and writes nothing when extraction throws", async () => {
    extractQuestions.mockRejectedValue(new Error("Gemini did not finish cleanly (MAX_TOKENS)"));
    const { importId } = await insertImport(tutor.id, syllabusWithTopics);
    await expect(processQuestionExtraction({ importId })).rejects.toThrow("MAX_TOKENS");
    const [imp] = await db.select().from(questionImports).where(eq(questionImports.id, importId));
    expect(imp.status).toBe("failed");
    expect(await db.select().from(questions).where(eq(questions.importId, importId))).toEqual([]);
  });
});
