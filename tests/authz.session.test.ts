import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { enrollments, sessions } from "@/lib/db/schema";
import { assertClassOwner, AuthzError } from "@/lib/auth/authz";
import {
  getSessionForViewer,
  listSessionsForClass,
} from "@/lib/db/queries/sessions";
import {
  createTestClass,
  createTestUser,
  deleteTestUser,
  type TestUser,
} from "./helpers/seed";

/**
 * Sessions are reachable only through their owning class. These tests exist to
 * prove the negatives: another tutor, an unrelated student, and a student who is
 * enrolled in a *different* class must all be unable to see or mutate a session,
 * and an enrolled student must be able to read but never edit.
 */
describe("session authorization", () => {
  let tutorA: TestUser;
  let tutorB: TestUser;
  let studentIn: TestUser;
  let studentOut: TestUser;
  let classA: string;
  let classB: string;
  let sessionA: string;

  beforeAll(async () => {
    tutorA = await createTestUser("sess-tutor-a", "tutor");
    tutorB = await createTestUser("sess-tutor-b", "tutor");
    studentIn = await createTestUser("sess-student-in", "student");
    studentOut = await createTestUser("sess-student-out", "student");

    classA = await createTestClass(tutorA.id, "A");
    classB = await createTestClass(tutorB.id, "B");

    // studentIn is enrolled in A only; studentOut is enrolled in B only.
    await db.insert(enrollments).values([
      { classId: classA, studentId: studentIn.id },
      { classId: classB, studentId: studentOut.id },
    ]);

    const [s] = await db
      .insert(sessions)
      .values({
        classId: classA,
        title: "Quadratics",
        scheduledAt: new Date("2026-08-01T15:00:00Z"),
        timezone: "Europe/London",
      })
      .returning({ id: sessions.id });
    sessionA = s.id;
  });

  afterAll(async () => {
    await db.delete(sessions).where(eq(sessions.classId, classA));
    await db.delete(enrollments).where(eq(enrollments.classId, classA));
    await db.delete(enrollments).where(eq(enrollments.classId, classB));
    for (const u of [studentIn, studentOut, tutorA, tutorB]) {
      await deleteTestUser(u);
    }
  });

  it("lets the owning tutor read the session", async () => {
    const found = await getSessionForViewer(tutorA.id, sessionA);
    expect(found?.relationship).toBe("owner");
    expect(found?.session.title).toBe("Quadratics");
  });

  it("lets an enrolled student read the session", async () => {
    const found = await getSessionForViewer(studentIn.id, sessionA);
    expect(found?.relationship).toBe("enrolled");
  });

  it("DENIES another tutor — no leak that the session exists", async () => {
    expect(await getSessionForViewer(tutorB.id, sessionA)).toBeNull();
  });

  it("DENIES a student enrolled in a DIFFERENT class", async () => {
    expect(await getSessionForViewer(studentOut.id, sessionA)).toBeNull();
  });

  it("DENIES editing to an enrolled student (read is not write)", async () => {
    await expect(assertClassOwner(studentIn.id, classA)).rejects.toBeInstanceOf(
      AuthzError,
    );
  });

  it("DENIES editing to another tutor", async () => {
    await expect(assertClassOwner(tutorB.id, classA)).rejects.toBeInstanceOf(
      AuthzError,
    );
  });

  it("lists sessions for members and returns [] for everyone else", async () => {
    expect(await listSessionsForClass(tutorA.id, classA)).toHaveLength(1);
    expect(await listSessionsForClass(studentIn.id, classA)).toHaveLength(1);
    expect(await listSessionsForClass(tutorB.id, classA)).toEqual([]);
    expect(await listSessionsForClass(studentOut.id, classA)).toEqual([]);
  });

  it("hides a soft-deleted session from its own tutor", async () => {
    const [tmp] = await db
      .insert(sessions)
      .values({
        classId: classA,
        scheduledAt: new Date("2026-08-02T15:00:00Z"),
        timezone: "Europe/London",
        deletedAt: new Date(),
      })
      .returning({ id: sessions.id });

    expect(await getSessionForViewer(tutorA.id, tmp.id)).toBeNull();
    expect(await listSessionsForClass(tutorA.id, classA)).toHaveLength(1);
  });
});
