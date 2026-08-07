import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { concepts } from "@/lib/db/schema";
import { assertConceptsOwned, AuthzError } from "@/lib/auth/authz";
import { listConceptClustersForTutor } from "@/lib/db/queries/concepts";
import { createTestUser, deleteTestUser, type TestUser } from "./helpers/seed";

/**
 * Concepts are tutor-global and have no class relationship, so ownership is
 * the only gate. These prove the negatives.
 */
describe("concept authorization", () => {
  let tutorA: TestUser;
  let tutorB: TestUser;
  let conceptA1: string;
  let conceptA2: string;
  let conceptB1: string;

  beforeAll(async () => {
    tutorA = await createTestUser("concept-tutor-a", "tutor");
    tutorB = await createTestUser("concept-tutor-b", "tutor");

    const inserted = await db
      .insert(concepts)
      .values([
        { tutorId: tutorA.id, name: "alcohol" },
        { tutorId: tutorA.id, name: "alcohols" },
        { tutorId: tutorB.id, name: "alcohol" },
      ])
      .returning({ id: concepts.id, tutorId: concepts.tutorId, name: concepts.name });

    conceptA1 = inserted.find((c) => c.tutorId === tutorA.id && c.name === "alcohol")!.id;
    conceptA2 = inserted.find((c) => c.tutorId === tutorA.id && c.name === "alcohols")!.id;
    conceptB1 = inserted.find((c) => c.tutorId === tutorB.id)!.id;
  });

  afterAll(async () => {
    await db.delete(concepts).where(eq(concepts.tutorId, tutorA.id));
    await db.delete(concepts).where(eq(concepts.tutorId, tutorB.id));
    await deleteTestUser(tutorA);
    await deleteTestUser(tutorB);
  });

  it("allows a tutor their own concepts", async () => {
    await expect(
      assertConceptsOwned(tutorA.id, [conceptA1, conceptA2]),
    ).resolves.toBeUndefined();
  });

  it("refuses another tutor's concept", async () => {
    await expect(assertConceptsOwned(tutorB.id, [conceptA1])).rejects.toThrow(AuthzError);
  });

  it("refuses a mixed-ownership set", async () => {
    // The critical case: a valid own-id must not launder an id belonging to
    // someone else through the same call.
    await expect(
      assertConceptsOwned(tutorB.id, [conceptB1, conceptA1]),
    ).rejects.toThrow(AuthzError);
  });

  it("refuses an empty set", async () => {
    await expect(assertConceptsOwned(tutorA.id, [])).rejects.toThrow(AuthzError);
  });

  it("refuses a soft-deleted concept", async () => {
    await db
      .update(concepts)
      .set({ deletedAt: new Date() })
      .where(eq(concepts.id, conceptA2));
    await expect(
      assertConceptsOwned(tutorA.id, [conceptA2]),
    ).rejects.toThrow(AuthzError);
    await db
      .update(concepts)
      .set({ deletedAt: null })
      .where(eq(concepts.id, conceptA2));
  });

  it("never surfaces another tutor's concepts in clusters", async () => {
    const clusters = await listConceptClustersForTutor(tutorB.id);
    const ids = clusters.flatMap((c) => c.concepts.map((x) => x.id));
    expect(ids).not.toContain(conceptA1);
    expect(ids).not.toContain(conceptA2);
  });

  it("clusters a tutor's own duplicate names", async () => {
    const clusters = await listConceptClustersForTutor(tutorA.id);
    expect(clusters.some((c) => c.concepts.length === 2)).toBe(true);
  });
});
