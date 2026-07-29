import { and, asc, eq, gte, isNull } from "drizzle-orm";
import type { InferSelectModel } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { classes, sessions } from "@/lib/db/schema";
import {
  resolveClassAccess,
  type Class,
  type ClassRelationship,
} from "@/lib/auth/authz";

export type Session = InferSelectModel<typeof sessions>;

/**
 * Every read here resolves the viewer's relationship to the OWNING CLASS before
 * returning anything. A session id from the client is only ever a lookup key —
 * it never confers access, and an unrelated user gets null/[] rather than a hint
 * that the row exists.
 */

/** Live sessions of a class the viewer can see, soonest first. */
export async function listSessionsForClass(
  userId: string,
  classId: string,
): Promise<Session[]> {
  const { relationship } = await resolveClassAccess(userId, classId);
  if (relationship === "none") return [];

  return db
    .select()
    .from(sessions)
    .where(and(eq(sessions.classId, classId), isNull(sessions.deletedAt)))
    .orderBy(asc(sessions.scheduledAt));
}

/**
 * The dashboard's "Up next" feed: the soonest upcoming lessons across every
 * live class this tutor owns. Ownership is the WHERE clause — same trust model
 * as listClassesForTutor, so nothing another tutor owns can appear.
 */
export async function listUpcomingSessionsForTutor(
  userId: string,
  limit = 5,
): Promise<Array<{ session: Session; className: string }>> {
  return db
    .select({ session: sessions, className: classes.name })
    .from(sessions)
    .innerJoin(classes, eq(classes.id, sessions.classId))
    .where(
      and(
        eq(classes.tutorId, userId),
        isNull(classes.deletedAt),
        isNull(sessions.deletedAt),
        gte(sessions.scheduledAt, new Date()),
      ),
    )
    .orderBy(asc(sessions.scheduledAt))
    .limit(limit);
}

export type SessionForViewer = {
  session: Session;
  klass: Class;
  relationship: Exclude<ClassRelationship, "none">;
};

/**
 * A single session plus the viewer's standing in its class, or null. This is the
 * ONLY sanctioned way to read one session — the detail page and every mutation
 * go through it, so the owner/enrolled distinction is decided in one place.
 */
export async function getSessionForViewer(
  userId: string,
  sessionId: string,
): Promise<SessionForViewer | null> {
  const [session] = await db
    .select()
    .from(sessions)
    .where(and(eq(sessions.id, sessionId), isNull(sessions.deletedAt)))
    .limit(1);
  if (!session) return null;

  const { relationship, klass } = await resolveClassAccess(
    userId,
    session.classId,
  );
  if (relationship === "none" || !klass) return null;

  return { session, klass, relationship };
}
