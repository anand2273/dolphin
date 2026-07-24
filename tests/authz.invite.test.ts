import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db/client";
import { enrollments, invitations } from "@/lib/db/schema";
import { resolveClassAccess, assertClassOwner, AuthzError } from "@/lib/auth/authz";
import { getClassForViewer } from "@/lib/db/queries/classes";
import { evaluateInviteAcceptance } from "@/lib/auth/invite-access";
import { generateInviteToken } from "@/lib/tokens";
import {
  createTestClass,
  createTestUser,
  deleteTestUser,
  type TestUser,
} from "./helpers/seed";

const FUTURE = () => new Date(Date.now() + 7 * 24 * 3600 * 1000);
const PAST = () => new Date(Date.now() - 1000);

describe("invitation acceptance gate (pure)", () => {
  const invited = "student@test.local";

  it("allows the invited email on a live pending invite", () => {
    const r = evaluateInviteAcceptance({
      invitation: { email: invited, status: "pending", expiresAt: FUTURE() },
      userEmail: invited,
    });
    expect(r.ok).toBe(true);
  });

  it("DENIES a different email (forwarded link opened by someone else)", () => {
    const r = evaluateInviteAcceptance({
      invitation: { email: invited, status: "pending", expiresAt: FUTURE() },
      userEmail: "randa@test.local",
    });
    expect(r).toEqual({ ok: false, reason: "wrong_email" });
  });

  it("DENIES an expired invite", () => {
    const r = evaluateInviteAcceptance({
      invitation: { email: invited, status: "pending", expiresAt: PAST() },
      userEmail: invited,
    });
    expect(r).toEqual({ ok: false, reason: "expired" });
  });

  it("DENIES a revoked invite", () => {
    const r = evaluateInviteAcceptance({
      invitation: { email: invited, status: "revoked", expiresAt: FUTURE() },
      userEmail: invited,
    });
    expect(r).toEqual({ ok: false, reason: "revoked" });
  });

  it("DENIES an already-accepted invite (single use)", () => {
    const r = evaluateInviteAcceptance({
      invitation: { email: invited, status: "accepted", expiresAt: FUTURE() },
      userEmail: invited,
    });
    expect(r).toEqual({ ok: false, reason: "already_accepted" });
  });

  it("DENIES a missing invite", () => {
    const r = evaluateInviteAcceptance({ invitation: null, userEmail: invited });
    expect(r).toEqual({ ok: false, reason: "not_found" });
  });
});

describe("invitation + enrollment authorization (integration)", () => {
  let tutorA: TestUser;
  let student: TestUser;
  let outsider: TestUser;
  let classA: string;

  beforeAll(async () => {
    tutorA = await createTestUser("inv-tutor-a", "tutor");
    student = await createTestUser("inv-student", "student");
    outsider = await createTestUser("inv-outsider", "student");
    classA = await createTestClass(tutorA.id, "Invite test class");

    const { hash } = generateInviteToken();
    await db.insert(invitations).values({
      classId: classA,
      email: student.email.toLowerCase(),
      tokenHash: hash,
      invitedByUserId: tutorA.id,
      expiresAt: FUTURE(),
    });
  });

  afterAll(async () => {
    // Delete the owning tutor first so the class (and its enrollments/invites)
    // cascade away before we remove the referenced student/outsider profiles.
    await deleteTestUser(tutorA);
    await deleteTestUser(student);
    await deleteTestUser(outsider);
  });

  it("only the class owner may invite/revoke (non-owner throws)", async () => {
    await expect(assertClassOwner(outsider.id, classA)).rejects.toBeInstanceOf(
      AuthzError,
    );
    await expect(assertClassOwner(student.id, classA)).rejects.toBeInstanceOf(
      AuthzError,
    );
  });

  it("a not-yet-enrolled invitee cannot see the class", async () => {
    const access = await resolveClassAccess(student.id, classA);
    expect(access.relationship).toBe("none");
    expect(await getClassForViewer(student.id, classA)).toBeNull();
  });

  it("after enrollment, the student can see the class as 'enrolled'", async () => {
    await db
      .insert(enrollments)
      .values({ classId: classA, studentId: student.id })
      .onConflictDoNothing();

    const access = await resolveClassAccess(student.id, classA);
    expect(access.relationship).toBe("enrolled");
    expect(await getClassForViewer(student.id, classA)).not.toBeNull();
  });

  it("an enrolled student still cannot perform owner-only actions", async () => {
    await expect(assertClassOwner(student.id, classA)).rejects.toBeInstanceOf(
      AuthzError,
    );
  });

  it("an unrelated user (not invited, not enrolled) sees nothing", async () => {
    const access = await resolveClassAccess(outsider.id, classA);
    expect(access.relationship).toBe("none");
    expect(await getClassForViewer(outsider.id, classA)).toBeNull();
  });
});
