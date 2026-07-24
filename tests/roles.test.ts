import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { assertTutor, isTutor, RoleError } from "@/lib/auth/roles";
import { getProfile } from "@/lib/auth/session";
import { createTestUser, deleteTestUser, type TestUser } from "./helpers/seed";

describe("role gate (pure)", () => {
  it("allows a tutor", () => {
    expect(() => assertTutor("tutor")).not.toThrow();
    expect(isTutor("tutor")).toBe(true);
  });

  it("DENIES a student", () => {
    expect(() => assertTutor("student")).toThrow(RoleError);
    expect(isTutor("student")).toBe(false);
  });

  it("DENIES a missing role", () => {
    expect(() => assertTutor(undefined)).toThrow(RoleError);
    expect(() => assertTutor(null)).toThrow(RoleError);
  });
});

describe("role assignment + gate (integration)", () => {
  let tutor: TestUser;
  let student: TestUser;

  beforeAll(async () => {
    tutor = await createTestUser("role-tutor", "tutor");
    student = await createTestUser("role-student", "student");
  });

  afterAll(async () => {
    await deleteTestUser(tutor);
    await deleteTestUser(student);
  });

  it("stores the tutor role and lets them create classes", async () => {
    const profile = await getProfile(tutor.id);
    expect(profile?.role).toBe("tutor");
    expect(() => assertTutor(profile?.role)).not.toThrow();
  });

  it("stores the student role and BLOCKS class creation", async () => {
    const profile = await getProfile(student.id);
    expect(profile?.role).toBe("student");
    // This is exactly the check createClass performs — a student is rejected.
    expect(() => assertTutor(profile?.role)).toThrow(RoleError);
  });
});
