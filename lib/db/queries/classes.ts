import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { classes } from "@/lib/db/schema";
import { resolveClassAccess, type Class } from "@/lib/auth/authz";

/** All live classes owned by this tutor, newest first. */
export async function listClassesForTutor(userId: string): Promise<Class[]> {
  return db
    .select()
    .from(classes)
    .where(and(eq(classes.tutorId, userId), isNull(classes.deletedAt)))
    .orderBy(desc(classes.createdAt));
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
