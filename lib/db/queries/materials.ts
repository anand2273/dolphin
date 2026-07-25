import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { attachments, materials, sessions } from "@/lib/db/schema";
import { resolveClassAccess, type ClassRelationship } from "@/lib/auth/authz";

export type MaterialListItem = {
  materialId: string;
  title: string | null;
  originalFilename: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: Date;
};

/**
 * Materials of a session the viewer can see. Like every other read, access is
 * resolved from the OWNING CLASS — never from the session or material id, which
 * are only lookup keys.
 */
export async function listMaterialsForSession(
  userId: string,
  sessionId: string,
): Promise<MaterialListItem[]> {
  const [session] = await db
    .select({ classId: sessions.classId })
    .from(sessions)
    .where(and(eq(sessions.id, sessionId), isNull(sessions.deletedAt)))
    .limit(1);
  if (!session) return [];

  const { relationship } = await resolveClassAccess(userId, session.classId);
  if (relationship === "none") return [];

  return db
    .select({
      materialId: materials.id,
      title: materials.title,
      originalFilename: attachments.originalFilename,
      mimeType: attachments.mimeType,
      sizeBytes: attachments.sizeBytes,
      createdAt: materials.createdAt,
    })
    .from(materials)
    .innerJoin(attachments, eq(attachments.id, materials.attachmentId))
    .where(and(eq(materials.sessionId, sessionId), isNull(materials.deletedAt)))
    .orderBy(desc(materials.createdAt));
}

export type MaterialForViewer = {
  materialId: string;
  sessionId: string;
  classId: string;
  bucket: string;
  objectKey: string;
  originalFilename: string;
  relationship: Exclude<ClassRelationship, "none">;
};

/**
 * A single material plus the viewer's standing, or null. THE gate in front of
 * signed-URL minting: the download route calls this and mints a URL only if it
 * returns non-null, which is what makes the private bucket meaningful.
 */
export async function getMaterialForViewer(
  userId: string,
  materialId: string,
): Promise<MaterialForViewer | null> {
  const [row] = await db
    .select({
      materialId: materials.id,
      sessionId: materials.sessionId,
      classId: sessions.classId,
      bucket: attachments.bucket,
      objectKey: attachments.objectKey,
      originalFilename: attachments.originalFilename,
    })
    .from(materials)
    .innerJoin(sessions, eq(sessions.id, materials.sessionId))
    .innerJoin(attachments, eq(attachments.id, materials.attachmentId))
    .where(
      and(
        eq(materials.id, materialId),
        isNull(materials.deletedAt),
        isNull(sessions.deletedAt),
        isNull(attachments.deletedAt),
      ),
    )
    .limit(1);
  if (!row) return null;

  const { relationship } = await resolveClassAccess(userId, row.classId);
  if (relationship === "none") return null;

  return { ...row, relationship };
}
