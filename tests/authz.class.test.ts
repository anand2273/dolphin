import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resolveClassAccess, assertClassOwner, AuthzError } from "@/lib/auth/authz";
import { getClassForViewer } from "@/lib/db/queries/classes";
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
