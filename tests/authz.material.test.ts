import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  attachments,
  enrollments,
  materials,
  sessions,
} from "@/lib/db/schema";
import {
  getMaterialForViewer,
  listMaterialsForSession,
} from "@/lib/db/queries/materials";
import { isAllowedMimeType, MAX_FILE_BYTES } from "@/lib/storage/config";
import { generateObjectKey } from "@/lib/storage/objects";
import {
  createTestClass,
  createTestUser,
  deleteTestUser,
  type TestUser,
} from "./helpers/seed";

/**
 * Materials are the first thing that leaves the database and becomes a file, so
 * the gate in front of signed-URL minting is the security-critical piece. These
 * tests prove the negatives: a student in ANOTHER class, a rival tutor, and an
 * unrelated user must all fail to resolve a material — which is what stops the
 * download route from ever minting a URL for them.
 */
describe("material authorization", () => {
  let tutorA: TestUser;
  let tutorB: TestUser;
  let studentIn: TestUser;
  let studentOut: TestUser;
  let classA: string;
  let classB: string;
  let sessionA: string;
  let materialA: string;
  let attachmentA: string;

  beforeAll(async () => {
    tutorA = await createTestUser("mat-tutor-a", "tutor");
    tutorB = await createTestUser("mat-tutor-b", "tutor");
    studentIn = await createTestUser("mat-student-in", "student");
    studentOut = await createTestUser("mat-student-out", "student");

    classA = await createTestClass(tutorA.id, "A");
    classB = await createTestClass(tutorB.id, "B");
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

    const [a] = await db
      .insert(attachments)
      .values({
        bucket: "materials",
        objectKey: generateObjectKey(),
        originalFilename: "worksheet.pdf",
        mimeType: "application/pdf",
        sizeBytes: 1234,
        uploadedByUserId: tutorA.id,
      })
      .returning({ id: attachments.id });
    attachmentA = a.id;

    const [m] = await db
      .insert(materials)
      .values({
        sessionId: sessionA,
        attachmentId: attachmentA,
        title: "Worksheet",
        createdByUserId: tutorA.id,
      })
      .returning({ id: materials.id });
    materialA = m.id;
  });

  afterAll(async () => {
    await db.delete(materials).where(eq(materials.sessionId, sessionA));
    await db.delete(attachments).where(inArray(attachments.id, [attachmentA]));
    await db.delete(sessions).where(eq(sessions.classId, classA));
    await db.delete(enrollments).where(inArray(enrollments.classId, [classA, classB]));
    for (const u of [studentIn, studentOut, tutorA, tutorB]) {
      await deleteTestUser(u);
    }
  });

  it("resolves for the owning tutor", async () => {
    const found = await getMaterialForViewer(tutorA.id, materialA);
    expect(found?.relationship).toBe("owner");
    expect(found?.originalFilename).toBe("worksheet.pdf");
  });

  it("resolves for an enrolled student — they may download", async () => {
    const found = await getMaterialForViewer(studentIn.id, materialA);
    expect(found?.relationship).toBe("enrolled");
  });

  it("DENIES a student enrolled in a DIFFERENT class", async () => {
    expect(await getMaterialForViewer(studentOut.id, materialA)).toBeNull();
  });

  it("DENIES a rival tutor", async () => {
    expect(await getMaterialForViewer(tutorB.id, materialA)).toBeNull();
  });

  it("lists materials for members and returns [] for everyone else", async () => {
    expect(await listMaterialsForSession(tutorA.id, sessionA)).toHaveLength(1);
    expect(await listMaterialsForSession(studentIn.id, sessionA)).toHaveLength(1);
    expect(await listMaterialsForSession(tutorB.id, sessionA)).toEqual([]);
    expect(await listMaterialsForSession(studentOut.id, sessionA)).toEqual([]);
  });

  it("hides a soft-deleted material from everyone, including its tutor", async () => {
    await db
      .update(materials)
      .set({ deletedAt: new Date() })
      .where(eq(materials.id, materialA));

    expect(await getMaterialForViewer(tutorA.id, materialA)).toBeNull();
    expect(await listMaterialsForSession(tutorA.id, sessionA)).toEqual([]);

    await db
      .update(materials)
      .set({ deletedAt: null })
      .where(eq(materials.id, materialA));
  });

  it("becomes unreachable when its session is soft-deleted", async () => {
    await db
      .update(sessions)
      .set({ deletedAt: new Date() })
      .where(eq(sessions.id, sessionA));

    expect(await getMaterialForViewer(tutorA.id, materialA)).toBeNull();
    expect(await listMaterialsForSession(studentIn.id, sessionA)).toEqual([]);

    await db
      .update(sessions)
      .set({ deletedAt: null })
      .where(eq(sessions.id, sessionA));
  });
});

describe("upload policy", () => {
  it("allows the document types tutors actually hand out", () => {
    expect(isAllowedMimeType("application/pdf")).toBe(true);
    expect(isAllowedMimeType("image/jpeg")).toBe(true);
    expect(
      isAllowedMimeType(
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      ),
    ).toBe(true);
  });

  it("REFUSES browser-executable types — these are served back to students", () => {
    expect(isAllowedMimeType("image/svg+xml")).toBe(false);
    expect(isAllowedMimeType("text/html")).toBe(false);
    expect(isAllowedMimeType("application/x-msdownload")).toBe(false);
    expect(isAllowedMimeType("")).toBe(false);
  });

  it("caps file size at 25 MiB", () => {
    expect(MAX_FILE_BYTES).toBe(25 * 1024 * 1024);
  });

  it("mints opaque object keys — no filename, no ids, never colliding", () => {
    const keys = new Set(Array.from({ length: 200 }, () => generateObjectKey()));
    expect(keys.size).toBe(200);
    for (const k of keys) {
      expect(k).toMatch(
        /^[0-9a-f-]{36}\/[0-9a-f-]{36}$/,
      );
    }
  });
});
