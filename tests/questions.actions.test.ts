import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { attachments, questionImports, topics } from "@/lib/db/schema";
import {
  IDENTITY_HEADER_USER_EMAIL,
  IDENTITY_HEADER_USER_ID,
} from "@/lib/auth/identity-headers";
import { NO_TOPICS_MESSAGE } from "@/lib/validation/question";
import { STALE_AFTER_MS } from "@/lib/extraction/stale";
import {
  createTestSyllabus,
  createTestUser,
  insertImport,
  teardownTutor,
  type TestUser,
} from "./helpers/seed";

// Same identity mock as tests/concepts.actions.test.ts: requireAuthUser reads
// middleware-forwarded headers, so the real authorize path runs.
let viewer: TestUser | null = null;
vi.mock("next/headers", () => ({
  headers: async () => ({
    get: (name: string) =>
      name === IDENTITY_HEADER_USER_ID ? viewer?.id ?? null
      : name === IDENTITY_HEADER_USER_EMAIL ? viewer?.email ?? null
      : null,
  }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

// Storage and extraction start are the side effects whose ABSENCE the negatives prove.
// vi.hoisted: vi.mock factories are hoisted above ordinary declarations.
const { createSignedUploadUrl, statObject, removeObject, startQuestionExtraction } = vi.hoisted(
  () => ({
    createSignedUploadUrl: vi.fn(async () => ({ signedUrl: "http://u", token: "t", expiresInSeconds: 120 })),
    statObject: vi.fn(),
    removeObject: vi.fn(async () => {}),
    startQuestionExtraction: vi.fn(),
  }),
);
vi.mock("@/lib/storage/objects", async (orig) => ({
  ...(await orig<typeof import("@/lib/storage/objects")>()),
  createSignedUploadUrl,
  statObject,
  removeObject,
}));
vi.mock("@/lib/extraction/start", () => ({ startQuestionExtraction }));

const { requestQuestionImportUpload, confirmQuestionImportUpload, retryQuestionImport } =
  await import("@/app/(tutor)/syllabi/[syllabusId]/questions/actions");

const KEY = "11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222";
const pdf = { filename: "paper.pdf", mimeType: "application/pdf", sizeBytes: 1000 };

describe("question import actions", () => {
  let tutorA: TestUser;
  let tutorB: TestUser;
  let student: TestUser;
  let syllabusA: string;
  let emptySyllabusA: string;

  beforeAll(async () => {
    tutorA = await createTestUser("qa-tutor-a", "tutor");
    tutorB = await createTestUser("qa-tutor-b", "tutor");
    student = await createTestUser("qa-student", "student");
    syllabusA = await createTestSyllabus(tutorA.id, "H2 Math");
    emptySyllabusA = await createTestSyllabus(tutorA.id, "Empty");
    await db.insert(topics).values({ syllabusId: syllabusA, tutorId: tutorA.id, name: "vectors", orderIndex: 0 });
  });

  afterAll(async () => {
    for (const u of [tutorA, tutorB, student]) await teardownTutor(u);
  });

  beforeEach(() => {
    vi.clearAllMocks();
    viewer = null;
  });

  describe("requestQuestionImportUpload", () => {
    it("mints an upload URL for the owning tutor", async () => {
      viewer = tutorA;
      const r = await requestQuestionImportUpload({ syllabusId: syllabusA, ...pdf });
      expect(r.ok).toBe(true);
      expect(createSignedUploadUrl).toHaveBeenCalledOnce();
    });

    it.each([["rival tutor", () => tutorB], ["student", () => student]])(
      "REFUSES a %s without minting anything",
      async (_label, who) => {
        viewer = who();
        const r = await requestQuestionImportUpload({ syllabusId: syllabusA, ...pdf });
        expect(r).toEqual({ ok: false, error: "Not authorized" });
        expect(createSignedUploadUrl).not.toHaveBeenCalled();
      },
    );

    it("refuses a syllabus with no topics, with the shared message", async () => {
      viewer = tutorA;
      const r = await requestQuestionImportUpload({ syllabusId: emptySyllabusA, ...pdf });
      expect(r).toEqual({ ok: false, error: NO_TOPICS_MESSAGE });
      expect(createSignedUploadUrl).not.toHaveBeenCalled();
    });

    it("refuses a non-PDF claim", async () => {
      viewer = tutorA;
      const r = await requestQuestionImportUpload({ syllabusId: syllabusA, ...pdf, mimeType: "image/png" });
      expect(r.ok).toBe(false);
    });
  });

  describe("confirmQuestionImportUpload", () => {
    it("records what actually landed and enqueues only the import id", async () => {
      viewer = tutorA;
      statObject.mockResolvedValue({ sizeBytes: 4321, mimeType: "application/pdf" });
      const r = await confirmQuestionImportUpload({ syllabusId: syllabusA, objectKey: KEY, filename: "p.pdf" });
      expect(r).toEqual({ ok: true });
      const [imp] = await db.select().from(questionImports).where(eq(questionImports.syllabusId, syllabusA));
      expect(imp.status).toBe("pending");
      const [att] = await db.select().from(attachments).where(eq(attachments.id, imp.sourceAttachmentId));
      expect(att.sizeBytes).toBe(4321); // stat, not the client's claim
      expect(startQuestionExtraction).toHaveBeenCalledWith({ importId: imp.id });
    });

    it("REFUSES a rival tutor before touching storage", async () => {
      viewer = tutorB;
      const r = await confirmQuestionImportUpload({ syllabusId: syllabusA, objectKey: KEY, filename: "p.pdf" });
      expect(r).toEqual({ error: "Not authorized" });
      expect(statObject).not.toHaveBeenCalled();
      expect(startQuestionExtraction).not.toHaveBeenCalled();
    });

    it("deletes an object that is not really a PDF and writes no rows", async () => {
      viewer = tutorA;
      statObject.mockResolvedValue({ sizeBytes: 10, mimeType: "image/png" });
      const before = await db.select().from(questionImports).where(eq(questionImports.syllabusId, emptySyllabusA));
      const r = await confirmQuestionImportUpload({ syllabusId: emptySyllabusA, objectKey: KEY, filename: "p.pdf" });
      expect(r.error).toBeTruthy();
      expect(removeObject).toHaveBeenCalledOnce();
      const after = await db.select().from(questionImports).where(eq(questionImports.syllabusId, emptySyllabusA));
      expect(after).toHaveLength(before.length);
    });

  });

  describe("retryQuestionImport", () => {
    it("re-runs a failed import for its owner", async () => {
      viewer = tutorA;
      const { importId } = await insertImport(tutorA.id, syllabusA, "failed");
      await retryQuestionImport(importId);
      expect(startQuestionExtraction).toHaveBeenCalledWith({ importId });
      const [imp] = await db.select().from(questionImports).where(eq(questionImports.id, importId));
      expect(imp.status).toBe("pending");
    });

    it("does nothing for a rival tutor", async () => {
      const { importId } = await insertImport(tutorA.id, syllabusA, "failed");
      viewer = tutorB;
      await retryQuestionImport(importId);
      expect(startQuestionExtraction).not.toHaveBeenCalled();
      const [imp] = await db.select().from(questionImports).where(eq(questionImports.id, importId));
      expect(imp.status).toBe("failed");
    });

    it("does not re-run an import that is not failed (no duplicate questions)", async () => {
      viewer = tutorA;
      const { importId } = await insertImport(tutorA.id, syllabusA, "done");
      await retryQuestionImport(importId);
      expect(startQuestionExtraction).not.toHaveBeenCalled();
    });

    it("re-runs an import stuck in processing past the stale cutoff", async () => {
      viewer = tutorA;
      const { importId } = await insertImport(tutorA.id, syllabusA, "processing");
      await db
        .update(questionImports)
        .set({ updatedAt: new Date(Date.now() - STALE_AFTER_MS - 60_000) })
        .where(eq(questionImports.id, importId));
      await retryQuestionImport(importId);
      expect(startQuestionExtraction).toHaveBeenCalledWith({ importId });
      const [imp] = await db.select().from(questionImports).where(eq(questionImports.id, importId));
      expect(imp.status).toBe("pending");
    });

    it("does not re-run an import that is still genuinely in flight", async () => {
      viewer = tutorA;
      const { importId } = await insertImport(tutorA.id, syllabusA, "processing");
      await retryQuestionImport(importId);
      expect(startQuestionExtraction).not.toHaveBeenCalled();
      const [imp] = await db.select().from(questionImports).where(eq(questionImports.id, importId));
      expect(imp.status).toBe("processing");
    });
  });
});
