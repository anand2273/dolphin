import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { concepts, syllabuses, topicConcepts, topics } from "@/lib/db/schema";
import { assertSyllabusOwner, AuthzError } from "@/lib/auth/authz";
import {
  getSyllabusForOwner,
  listConceptsForTutor,
  listSyllabiForTutor,
  listTopicsForSyllabus,
} from "@/lib/db/queries/syllabuses";
import {
  createTestSyllabus,
  createTestUser,
  deleteTestUser,
  type TestUser,
} from "./helpers/seed";

/**
 * A syllabus is tutor-owned and independent of any class — there is no
 * "enrolled" relationship at all, unlike materials/sessions. These tests prove
 * the negatives: a rival tutor and a student must never resolve, read, or list
 * another tutor's syllabus, topics, or concepts.
 */
describe("syllabus authorization", () => {
  let tutorA: TestUser;
  let tutorB: TestUser;
  let student: TestUser;
  let syllabusA: string;
  let topicA: string;
  let conceptA: string;

  beforeAll(async () => {
    tutorA = await createTestUser("syl-tutor-a", "tutor");
    tutorB = await createTestUser("syl-tutor-b", "tutor");
    student = await createTestUser("syl-student", "student");

    syllabusA = await createTestSyllabus(tutorA.id, "Cambridge IGCSE Maths");

    const [concept] = await db
      .insert(concepts)
      .values({ tutorId: tutorA.id, name: "Quadratic Formula" })
      .returning({ id: concepts.id });
    conceptA = concept.id;

    const [topic] = await db
      .insert(topics)
      .values({
        syllabusId: syllabusA,
        tutorId: tutorA.id,
        name: "Algebra",
        orderIndex: 0,
      })
      .returning({ id: topics.id });
    topicA = topic.id;

    await db.insert(topicConcepts).values({ topicId: topicA, conceptId: conceptA });
  });

  afterAll(async () => {
    await db.delete(topicConcepts).where(eq(topicConcepts.topicId, topicA));
    await db.delete(topics).where(eq(topics.syllabusId, syllabusA));
    await db.delete(concepts).where(inArray(concepts.id, [conceptA]));
    for (const u of [tutorA, tutorB, student]) {
      await deleteTestUser(u);
    }
  });

  it("assertSyllabusOwner resolves for the owning tutor", async () => {
    const syllabus = await assertSyllabusOwner(tutorA.id, syllabusA);
    expect(syllabus.id).toBe(syllabusA);
  });

  it("assertSyllabusOwner DENIES a rival tutor", async () => {
    await expect(assertSyllabusOwner(tutorB.id, syllabusA)).rejects.toThrow(AuthzError);
  });

  it("assertSyllabusOwner DENIES a student", async () => {
    await expect(assertSyllabusOwner(student.id, syllabusA)).rejects.toThrow(AuthzError);
  });

  it("assertSyllabusOwner DENIES a non-existent syllabus without leaking", async () => {
    await expect(
      assertSyllabusOwner(tutorA.id, "00000000-0000-0000-0000-000000000000"),
    ).rejects.toThrow(AuthzError);
  });

  it("getSyllabusForOwner resolves for the owner and null for everyone else", async () => {
    expect((await getSyllabusForOwner(tutorA.id, syllabusA))?.id).toBe(syllabusA);
    expect(await getSyllabusForOwner(tutorB.id, syllabusA)).toBeNull();
    expect(await getSyllabusForOwner(student.id, syllabusA)).toBeNull();
  });

  it("listSyllabiForTutor only ever returns the caller's own syllabuses", async () => {
    const forA = await listSyllabiForTutor(tutorA.id);
    expect(forA.map((s) => s.id)).toContain(syllabusA);

    const forB = await listSyllabiForTutor(tutorB.id);
    expect(forB.map((s) => s.id)).not.toContain(syllabusA);
  });

  it("listTopicsForSyllabus returns topics+concepts for the owner, [] for everyone else", async () => {
    const forA = await listTopicsForSyllabus(tutorA.id, syllabusA);
    expect(forA).toHaveLength(1);
    expect(forA[0].name).toBe("Algebra");
    expect(forA[0].concepts.map((c) => c.name)).toContain("Quadratic Formula");

    expect(await listTopicsForSyllabus(tutorB.id, syllabusA)).toEqual([]);
    expect(await listTopicsForSyllabus(student.id, syllabusA)).toEqual([]);
  });

  it("listConceptsForTutor is scoped per tutor", async () => {
    const forA = await listConceptsForTutor(tutorA.id);
    expect(forA.map((c) => c.id)).toContain(conceptA);

    const forB = await listConceptsForTutor(tutorB.id);
    expect(forB.map((c) => c.id)).not.toContain(conceptA);
  });

  it("hides a soft-deleted syllabus from its own tutor", async () => {
    await db
      .update(syllabuses)
      .set({ deletedAt: new Date() })
      .where(eq(syllabuses.id, syllabusA));

    expect(await getSyllabusForOwner(tutorA.id, syllabusA)).toBeNull();
    await expect(assertSyllabusOwner(tutorA.id, syllabusA)).rejects.toThrow(AuthzError);

    await db
      .update(syllabuses)
      .set({ deletedAt: null })
      .where(eq(syllabuses.id, syllabusA));
  });
});
