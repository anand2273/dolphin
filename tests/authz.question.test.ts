import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { questionImports, syllabuses } from "@/lib/db/schema";
import { assertQuestionImportOwner, AuthzError } from "@/lib/auth/authz";
import {
  createTestSyllabus,
  createTestUser,
  insertImport,
  teardownTutor,
  type TestUser,
} from "./helpers/seed";

/**
 * The question bank is tutor-private and syllabus-scoped. The negatives here
 * are the point: a rival tutor or a student must never resolve another tutor's
 * import, and a soft-deleted import or syllabus must look missing.
 */
describe("question import ownership", () => {
  let tutorA: TestUser;
  let tutorB: TestUser;
  let student: TestUser;
  let syllabusA: string;
  let importA: string;

  beforeAll(async () => {
    tutorA = await createTestUser("qi-tutor-a", "tutor");
    tutorB = await createTestUser("qi-tutor-b", "tutor");
    student = await createTestUser("qi-student", "student");
    syllabusA = await createTestSyllabus(tutorA.id, "H2 Math");
    ({ importId: importA } = await insertImport(tutorA.id, syllabusA));
  });

  afterAll(async () => {
    for (const u of [tutorA, tutorB, student]) await teardownTutor(u);
  });

  it("resolves for the owning tutor", async () => {
    const imp = await assertQuestionImportOwner(tutorA.id, importA);
    expect(imp.id).toBe(importA);
  });

  it("DENIES a rival tutor", async () => {
    await expect(assertQuestionImportOwner(tutorB.id, importA)).rejects.toThrow(AuthzError);
  });

  it("DENIES a student", async () => {
    await expect(assertQuestionImportOwner(student.id, importA)).rejects.toThrow(AuthzError);
  });

  it("DENIES a soft-deleted import", async () => {
    const { importId } = await insertImport(tutorA.id, syllabusA);
    await db
      .update(questionImports)
      .set({ deletedAt: new Date() })
      .where(eq(questionImports.id, importId));
    await expect(assertQuestionImportOwner(tutorA.id, importId)).rejects.toThrow(AuthzError);
  });

  it("DENIES an import whose syllabus was soft-deleted", async () => {
    const other = await createTestSyllabus(tutorA.id, "Doomed");
    const { importId } = await insertImport(tutorA.id, other);
    await db.update(syllabuses).set({ deletedAt: new Date() }).where(eq(syllabuses.id, other));
    await expect(assertQuestionImportOwner(tutorA.id, importId)).rejects.toThrow(AuthzError);
  });
});
