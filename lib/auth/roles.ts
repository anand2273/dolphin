/**
 * Global account roles. This is the coarse authorization layer that sits above
 * the per-resource relationship checks in authz.ts. It is also the monetization
 * boundary: tutors are the paying users, students are invited and low-privilege.
 */

export type Role = "tutor" | "student";

export class RoleError extends Error {
  constructor(message = "Wrong account type for this action") {
    super(message);
    this.name = "RoleError";
  }
}

export function isTutor(role: Role | null | undefined): boolean {
  return role === "tutor";
}

/** Throws unless the account is a tutor. Used to gate class creation etc. */
export function assertTutor(
  role: Role | null | undefined,
): asserts role is "tutor" {
  if (role !== "tutor") throw new RoleError("Only tutors can do this.");
}

/**
 * Where an account lands after auth. Anything that isn't explicitly a tutor —
 * including a not-yet-provisioned (null) profile — goes to the low-privilege
 * student home. Never default an unknown account into the tutor area.
 */
export function homeForRole(role: Role | null | undefined): string {
  return role === "tutor" ? "/dashboard" : "/student";
}
