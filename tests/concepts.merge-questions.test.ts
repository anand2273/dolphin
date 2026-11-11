import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { concepts, questionConcepts, questions } from "@/lib/db/schema";
import { IDENTITY_HEADER_USER_EMAIL, IDENTITY_HEADER_USER_ID } from "@/lib/auth/identity-headers";
import { createTestSyllabus, createTestUser, teardownTutor, type TestUser } from "./helpers/seed";

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

const { mergeConcepts } = await import("@/app/(tutor)/concepts/actions");

/** Without the repoint, merging two concepts silently untags every question on the loser. */
describe("mergeConcepts and question tags", () => {
  let tutor: TestUser;
  let survivor: string;
  let loser: string;
  let qOnlyLoser: string;
  let qBoth: string;

  beforeAll(async () => {
    tutor = await createTestUser("cmq-tutor", "tutor");
    viewer = tutor;
    const syllabusId = await createTestSyllabus(tutor.id, "S");
    [{ id: survivor }, { id: loser }] = await db
      .insert(concepts)
      .values([
        { tutorId: tutor.id, name: "alcohol" },
        { tutorId: tutor.id, name: "alcohols" },
      ])
      .returning({ id: concepts.id });
    [{ id: qOnlyLoser }, { id: qBoth }] = await db
      .insert(questions)
      .values([
        { syllabusId, tutorId: tutor.id, label: "1", stem: "a" },
        { syllabusId, tutorId: tutor.id, label: "2", stem: "b" },
      ])
      .returning({ id: questions.id });
    await db.insert(questionConcepts).values([
      { questionId: qOnlyLoser, conceptId: loser },
      { questionId: qBoth, conceptId: loser },
      { questionId: qBoth, conceptId: survivor },
    ]);
  });

  afterAll(async () => {
    await db.delete(concepts).where(eq(concepts.tutorId, tutor.id));
    await teardownTutor(tutor);
  });

  it("moves loser tags onto the survivor, without duplicating an existing pair", async () => {
    const fd = new FormData();
    fd.set("survivorId", survivor);
    fd.append("loserIds", loser);
    expect(await mergeConcepts({}, fd)).toEqual({ ok: true });

    const rows = await db.select().from(questionConcepts);
    const mine = rows.filter((r) => [qOnlyLoser, qBoth].includes(r.questionId));
    expect(mine.every((r) => r.conceptId === survivor)).toBe(true);
    expect(mine.map((r) => r.questionId).sort()).toEqual([qOnlyLoser, qBoth].sort());
  });
});
