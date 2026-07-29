import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { classes, enrollments, invitations } from "@/lib/db/schema";
import { resolveClassAccess, assertClassOwner, AuthzError } from "@/lib/auth/authz";
import { getClassForViewer, listClassesForTutor } from "@/lib/db/queries/classes";
import { getInvitationByToken } from "@/lib/db/queries/invitations";
import { generateInviteToken } from "@/lib/tokens";
import {
  createTestClass,
  createTestUser,
  deleteTestUser,
  type TestUser,
} from "./helpers/seed";

/**
 * Negative authorization tests for classes (CLAUDE.md: tutor A cannot read
 * tutor B's class). Everything routes through the single authz helper.
 */
describe("class authorization", () => {
  let tutorA: TestUser;
  let tutorB: TestUser;
  let classA: string;

  beforeAll(async () => {
    tutorA = await createTestUser("tutor-a");
    tutorB = await createTestUser("tutor-b");
    classA = await createTestClass(tutorA.id, "Tutor A's class");
  });

  afterAll(async () => {
    await deleteTestUser(tutorA);
    await deleteTestUser(tutorB);
  });

  it("lets the owning tutor read their own class", async () => {
    const klass = await getClassForViewer(tutorA.id, classA);
    expect(klass).not.toBeNull();
    expect(klass?.id).toBe(classA);
  });

  it("resolves the owner relationship for the owning tutor", async () => {
    const access = await resolveClassAccess(tutorA.id, classA);
    expect(access.relationship).toBe("owner");
  });

  it("DENIES another tutor reading someone else's class (returns null, no leak)", async () => {
    const klass = await getClassForViewer(tutorB.id, classA);
    expect(klass).toBeNull();
  });

  it("resolves 'none' for an unrelated tutor and hides the row", async () => {
    const access = await resolveClassAccess(tutorB.id, classA);
    expect(access.relationship).toBe("none");
    expect(access.klass).toBeNull();
  });

  it("throws AuthzError when a non-owner attempts an owner-only action", async () => {
    await expect(assertClassOwner(tutorB.id, classA)).rejects.toBeInstanceOf(
      AuthzError,
    );
  });

  it("treats a missing/unknown class as no access", async () => {
    const access = await resolveClassAccess(
      tutorA.id,
      "00000000-0000-0000-0000-000000000000",
    );
    expect(access.relationship).toBe("none");
  });
});

/**
 * Soft-deleting a class must close off every path into it: the owner's reads,
 * the enrolled student's membership, and any live invite link. Tests run in
 * declaration order — the soft delete happens mid-suite on purpose, so the
 * before/after behaviour of the same rows is what's being asserted.
 */
describe("class soft-deletion", () => {
  let tutor: TestUser;
  let student: TestUser;
  let classId: string;
  let rawToken: string;

  beforeAll(async () => {
    tutor = await createTestUser("del-tutor");
    student = await createTestUser("del-student", "student");
    classId = await createTestClass(tutor.id, "Doomed class");
    await db.insert(enrollments).values({ classId, studentId: student.id });

    const { raw, hash } = generateInviteToken();
    rawToken = raw;
    await db.insert(invitations).values({
      classId,
      email: "doomed-invitee@test.local",
      tokenHash: hash,
      invitedByUserId: tutor.id,
      expiresAt: new Date(Date.now() + 24 * 3600 * 1000),
    });
  });

  afterAll(async () => {
    // Tutor first: dropping their class cascades the enrollment/invitation
    // rows whose FKs would otherwise restrict deleting the student's profile.
    await deleteTestUser(tutor);
    await deleteTestUser(student);
  });

  it("resolves a pending invite token while the class is live", async () => {
    const invite = await getInvitationByToken(rawToken);
    expect(invite).not.toBeNull();
  });

  it("hides a soft-deleted class from its owner", async () => {
    await db
      .update(classes)
      .set({ deletedAt: new Date() })
      .where(eq(classes.id, classId));
    expect(await getClassForViewer(tutor.id, classId)).toBeNull();
  });

  it("omits the deleted class from the tutor's class list", async () => {
    const list = await listClassesForTutor(tutor.id);
    expect(list.map((c) => c.id)).not.toContain(classId);
  });

  it("resolves 'none' for the previously enrolled student", async () => {
    const access = await resolveClassAccess(student.id, classId);
    expect(access.relationship).toBe("none");
    expect(access.klass).toBeNull();
  });

  it("DENIES owner-only actions on a deleted class", async () => {
    await expect(assertClassOwner(tutor.id, classId)).rejects.toBeInstanceOf(
      AuthzError,
    );
  });

  it("no longer resolves the pending invite token for the deleted class", async () => {
    expect(await getInvitationByToken(rawToken)).toBeNull();
  });
});
