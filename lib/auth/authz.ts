import { and, eq, inArray, isNull } from "drizzle-orm";
import type { InferSelectModel } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  classes,
  concepts,
  enrollments,
  questionImports,
  syllabuses,
} from "@/lib/db/schema";

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

/**
 * Syllabus ownership. A syllabus is tutor-owned and independent of any class
 * (unlike materials/sessions, which resolve through class membership) — same
 * shape as the old class-independent `topics` ownership, just spelled out as
 * its own gate now that syllabuses exist. Students never have a relationship
 * to a syllabus at all.
 */
export type Syllabus = InferSelectModel<typeof syllabuses>;

export async function assertSyllabusOwner(
  userId: string,
  syllabusId: string,
): Promise<Syllabus> {
  const [syllabus] = await db
    .select()
    .from(syllabuses)
    .where(and(eq(syllabuses.id, syllabusId), isNull(syllabuses.deletedAt)))
    .limit(1);

  // Don't distinguish "missing" from "not yours" — same non-leak rule as classes.
  if (!syllabus || syllabus.tutorId !== userId) throw new AuthzError();
  return syllabus;
}

/**
 * Concepts are tutor-owned with no class relationship, so the only question is
 * ownership — the same shape as assertSyllabusOwner.
 *
 * Takes the whole set at once on purpose. A merge receives a survivor id and
 * several loser ids from the client, and checking only the survivor would let a
 * caller fold another tutor's concepts into their own.
 */
export async function assertConceptsOwned(
  userId: string,
  conceptIds: string[],
): Promise<void> {
  if (conceptIds.length === 0) throw new AuthzError();
  const unique = [...new Set(conceptIds)];

  const rows = await db
    .select({ id: concepts.id })
    .from(concepts)
    .where(
      and(
        inArray(concepts.id, unique),
        eq(concepts.tutorId, userId),
        isNull(concepts.deletedAt),
      ),
    );

  // Any shortfall is a failure, and we never say which id was the problem.
  if (rows.length !== unique.length) throw new AuthzError();
}

export type QuestionImport = InferSelectModel<typeof questionImports>;

/**
 * Same shape as assertSyllabusOwner: the question bank is tutor-private and
 * students have no relationship to it at all. A soft-deleted import, or one
 * whose syllabus was soft-deleted, is indistinguishable from "not yours".
 */
export async function assertQuestionImportOwner(
  userId: string,
  importId: string,
): Promise<QuestionImport> {
  const [row] = await db
    .select({ imp: questionImports })
    .from(questionImports)
    .innerJoin(syllabuses, eq(syllabuses.id, questionImports.syllabusId))
    .where(
      and(
        eq(questionImports.id, importId),
        isNull(questionImports.deletedAt),
        isNull(syllabuses.deletedAt),
      ),
    )
    .limit(1);

  if (!row || row.imp.tutorId !== userId) throw new AuthzError();
  return row.imp;
}
