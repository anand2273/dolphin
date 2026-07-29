import { and, asc, desc, eq, gte, inArray, isNull } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  classes,
  enrollments,
  invitations,
  profiles,
  sessions,
} from "@/lib/db/schema";
import { resolveClassAccess, type Class } from "@/lib/auth/authz";

/** All live classes owned by this tutor, newest first. */
export async function listClassesForTutor(userId: string): Promise<Class[]> {
  return db
    .select()
    .from(classes)
    .where(and(eq(classes.tutorId, userId), isNull(classes.deletedAt)))
    .orderBy(desc(classes.createdAt));
}

export type ClassOverview = Class & {
  /** Enrolled students' display names (name, else email) for the facepile. */
  studentNames: string[];
  pendingInviteCount: number;
  nextSession: { id: string; title: string | null; scheduledAt: Date } | null;
};

/**
 * The dashboard's class cards in one read. The child selects are keyed ONLY by
 * the class ids listClassesForTutor already scoped to this owner — no id from
 * anywhere else enters, so nothing here can cross a tutor boundary.
 */
export async function listClassOverviewsForTutor(
  userId: string,
): Promise<ClassOverview[]> {
  const owned = await listClassesForTutor(userId);
  if (owned.length === 0) return [];
  const ids = owned.map((c) => c.id);

  const [rosterRows, inviteRows, upcomingRows] = await Promise.all([
    db
      .select({
        classId: enrollments.classId,
        fullName: profiles.fullName,
        email: profiles.email,
      })
      .from(enrollments)
      .innerJoin(profiles, eq(profiles.id, enrollments.studentId))
      .where(
        and(inArray(enrollments.classId, ids), isNull(enrollments.deletedAt)),
      ),
    db
      .select({ classId: invitations.classId })
      .from(invitations)
      .where(
        and(
          inArray(invitations.classId, ids),
          eq(invitations.status, "pending"),
          isNull(invitations.deletedAt),
        ),
      ),
    db
      .select({
        classId: sessions.classId,
        id: sessions.id,
        title: sessions.title,
        scheduledAt: sessions.scheduledAt,
      })
      .from(sessions)
      .where(
        and(
          inArray(sessions.classId, ids),
          isNull(sessions.deletedAt),
          gte(sessions.scheduledAt, new Date()),
        ),
      )
      .orderBy(asc(sessions.scheduledAt)),
  ]);

  const namesByClass = new Map<string, string[]>();
  for (const r of rosterRows) {
    const list = namesByClass.get(r.classId) ?? [];
    list.push(r.fullName ?? r.email);
    namesByClass.set(r.classId, list);
  }
  const invitesByClass = new Map<string, number>();
  for (const r of inviteRows) {
    invitesByClass.set(r.classId, (invitesByClass.get(r.classId) ?? 0) + 1);
  }
  // Rows arrive soonest-first, so the first row per class is its next lesson.
  const nextByClass = new Map<string, ClassOverview["nextSession"]>();
  for (const r of upcomingRows) {
    if (!nextByClass.has(r.classId)) {
      nextByClass.set(r.classId, {
        id: r.id,
        title: r.title,
        scheduledAt: r.scheduledAt,
      });
    }
  }

  return owned.map((c) => ({
    ...c,
    studentNames: namesByClass.get(c.id) ?? [],
    pendingInviteCount: invitesByClass.get(c.id) ?? 0,
    nextSession: nextByClass.get(c.id) ?? null,
  }));
}

/**
 * A class the given user is allowed to view (owner or enrolled), or null.
 * This is the ONLY sanctioned way to read a single class — it goes through the
 * authz helper, so an unrelated user always gets null (never a leaked row).
 */
export async function getClassForViewer(
  userId: string,
  classId: string,
): Promise<Class | null> {
  const { relationship, klass } = await resolveClassAccess(userId, classId);
  if (relationship === "none") return null;
  return klass;
}
