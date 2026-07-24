import { and, eq, isNull } from "drizzle-orm";
import type { InferSelectModel } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { classes, enrollments } from "@/lib/db/schema";

/**
 * THE single authorization helper (CLAUDE.md security invariant).
 *
 * Every data access resolves the current user's relationship to the resource's
 * class, then a capability check decides if the action is allowed. Roles are
 * contextual: you are a "tutor" of classes you own and a "student" of classes
 * you're enrolled in. Nothing here trusts a client-supplied role or id — the
 * class is always re-derived from the database.
 */

export type Class = InferSelectModel<typeof classes>;

export type ClassRelationship = "owner" | "enrolled" | "none";

export type ClassAccess = {
  relationship: ClassRelationship;
  klass: Class | null;
};

export class AuthzError extends Error {
  constructor(message = "Not authorized") {
    super(message);
    this.name = "AuthzError";
  }
}

/**
 * Question 1 (membership): what is this user's relationship to this class?
 * Returns `none` for a missing/soft-deleted class or an unrelated user.
 */
export async function resolveClassAccess(
  userId: string,
  classId: string,
): Promise<ClassAccess> {
  const [klass] = await db
    .select()
    .from(classes)
    .where(and(eq(classes.id, classId), isNull(classes.deletedAt)))
    .limit(1);

  if (!klass) return { relationship: "none", klass: null };

  if (klass.tutorId === userId) {
    return { relationship: "owner", klass };
  }

  const [enrollment] = await db
    .select({ id: enrollments.id })
    .from(enrollments)
    .where(
      and(
        eq(enrollments.classId, classId),
        eq(enrollments.studentId, userId),
        isNull(enrollments.deletedAt),
      ),
    )
    .limit(1);

  if (enrollment) return { relationship: "enrolled", klass };

  // Class exists but the user is unrelated (another tutor, other student,
  // stranger). Do NOT leak its existence — treat as no access.
  return { relationship: "none", klass: null };
}

/**
 * Question 2 (capability), owner-only actions: create/edit/delete class,
 * sessions, materials, assignments; view roster and all submissions.
 * Returns the class or throws AuthzError.
 */
export async function assertClassOwner(
  userId: string,
  classId: string,
): Promise<Class> {
  const { relationship, klass } = await resolveClassAccess(userId, classId);
  if (relationship !== "owner" || !klass) throw new AuthzError();
  return klass;
}

/**
 * Capability, member actions: read class materials/assignments/sessions.
 * Owner or enrolled student. Returns the class or throws AuthzError.
 */
export async function assertClassMember(
  userId: string,
  classId: string,
): Promise<Class> {
  const { relationship, klass } = await resolveClassAccess(userId, classId);
  if (relationship === "none" || !klass) throw new AuthzError();
  return klass;
}
