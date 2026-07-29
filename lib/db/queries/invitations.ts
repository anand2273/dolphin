import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { classes, enrollments, invitations, profiles } from "@/lib/db/schema";
import { hashToken } from "@/lib/tokens";

/** Look up an invitation by its raw token, with class + tutor context. */
export async function getInvitationByToken(rawToken: string) {
  const [row] = await db
    .select({
      invitation: invitations,
      className: classes.name,
      classSubject: classes.subject,
      tutorName: profiles.fullName,
    })
    .from(invitations)
    .innerJoin(classes, eq(classes.id, invitations.classId))
    .innerJoin(profiles, eq(profiles.id, classes.tutorId))
    .where(
      and(
        eq(invitations.tokenHash, hashToken(rawToken)),
        isNull(invitations.deletedAt),
        // A deleted class takes its pending invite links with it — the token
        // falls into the same not-found path as an expired one.
        isNull(classes.deletedAt),
      ),
    )
    .limit(1);
  return row ?? null;
}

/** A single invitation by id (used by the in-app, already-authenticated accept). */
export async function getInvitationById(id: string) {
  const [row] = await db
    .select()
    .from(invitations)
    .where(and(eq(invitations.id, id), isNull(invitations.deletedAt)))
    .limit(1);
  return row ?? null;
}

/** Pending invitations for a class (tutor view). */
export async function listPendingInvitesForClass(classId: string) {
  return db
    .select()
    .from(invitations)
    .where(
      and(
        eq(invitations.classId, classId),
        eq(invitations.status, "pending"),
        isNull(invitations.deletedAt),
      ),
    )
    .orderBy(desc(invitations.createdAt));
}

/** Pending invitations addressed to a given email (for the invitee's dashboard). */
export async function listPendingInvitesForEmail(email: string) {
  return db
    .select({
      invitation: invitations,
      className: classes.name,
      tutorName: profiles.fullName,
    })
    .from(invitations)
    .innerJoin(classes, eq(classes.id, invitations.classId))
    .innerJoin(profiles, eq(profiles.id, classes.tutorId))
    .where(
      and(
        eq(invitations.email, email.toLowerCase()),
        eq(invitations.status, "pending"),
        isNull(invitations.deletedAt),
        isNull(classes.deletedAt),
      ),
    )
    .orderBy(desc(invitations.createdAt));
}

/** Enrolled students of a class (tutor-only roster). */
export async function listRoster(classId: string) {
  return db
    .select({
      enrollmentId: enrollments.id,
      studentId: profiles.id,
      fullName: profiles.fullName,
      email: profiles.email,
      enrolledAt: enrollments.enrolledAt,
    })
    .from(enrollments)
    .innerJoin(profiles, eq(profiles.id, enrollments.studentId))
    .where(and(eq(enrollments.classId, classId), isNull(enrollments.deletedAt)))
    .orderBy(desc(enrollments.enrolledAt));
}

/** Classes a user is enrolled in (student view). */
export async function listEnrolledClasses(userId: string) {
  return db
    .select({
      classId: classes.id,
      name: classes.name,
      subject: classes.subject,
      tutorName: profiles.fullName,
    })
    .from(enrollments)
    .innerJoin(classes, eq(classes.id, enrollments.classId))
    .innerJoin(profiles, eq(profiles.id, classes.tutorId))
    .where(
      and(
        eq(enrollments.studentId, userId),
        isNull(enrollments.deletedAt),
        isNull(classes.deletedAt),
      ),
    )
    .orderBy(desc(enrollments.enrolledAt));
}

/** Is this user already enrolled (live) in this class? */
export async function isEnrolled(userId: string, classId: string): Promise<boolean> {
  const [row] = await db
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
  return Boolean(row);
}
