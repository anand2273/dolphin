import { createClient } from "@supabase/supabase-js";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  attachments,
  classes,
  profiles,
  questionImports,
  syllabuses,
} from "@/lib/db/schema";
import { generateObjectKey } from "@/lib/storage/objects";
import { QUESTION_DOCUMENTS_BUCKET } from "@/lib/storage/config";

/**
 * Admin Supabase client (service-role) — TEST ONLY. Used to create real
 * auth.users rows so profiles' FK is satisfied, exactly as production signup
 * would. Never import this outside tests.
 */
const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

export type TestUser = { id: string; email: string };

/** Create a real GoTrue user + matching profile row. Returns the user id. */
export async function createTestUser(
  label: string,
  role: "tutor" | "student" = "tutor",
): Promise<TestUser> {
  const email = `${label}-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2, 8)}@test.local`;

  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: "password12345",
    email_confirm: true,
  });
  if (error || !data.user) {
    throw new Error(`createTestUser failed: ${error?.message}`);
  }

  await db
    .insert(profiles)
    .values({ id: data.user.id, email, role })
    .onConflictDoNothing({ target: profiles.id });

  return { id: data.user.id, email };
}

/** Insert a class owned by the given tutor. Returns the class id. */
export async function createTestClass(
  tutorId: string,
  name = "Test Class",
): Promise<string> {
  const [row] = await db
    .insert(classes)
    .values({ tutorId, name })
    .returning({ id: classes.id });
  return row.id;
}

/** Insert a syllabus owned by the given tutor. Returns the syllabus id. */
export async function createTestSyllabus(
  tutorId: string,
  title = "Test Syllabus",
): Promise<string> {
  const [row] = await db
    .insert(syllabuses)
    .values({ tutorId, title })
    .returning({ id: syllabuses.id });
  return row.id;
}

/** Tear down a test user: their classes, syllabuses, profile, and the auth.users row. */
export async function deleteTestUser(user: TestUser) {
  await db.delete(classes).where(eq(classes.tutorId, user.id));
  await db.delete(syllabuses).where(eq(syllabuses.tutorId, user.id));
  await db.delete(profiles).where(eq(profiles.id, user.id));
  await admin.auth.admin.deleteUser(user.id);
}

/** Insert an attachment + question import for a tutor's syllabus. No storage object is created. */
export async function insertImport(
  tutorId: string,
  syllabusId: string,
  status: "pending" | "processing" | "done" | "failed" = "pending",
): Promise<{ importId: string; attachmentId: string }> {
  const [attachment] = await db
    .insert(attachments)
    .values({
      bucket: QUESTION_DOCUMENTS_BUCKET,
      objectKey: generateObjectKey(),
      originalFilename: "paper.pdf",
      mimeType: "application/pdf",
      sizeBytes: 1000,
      uploadedByUserId: tutorId,
    })
    .returning({ id: attachments.id });
  const [row] = await db
    .insert(questionImports)
    .values({ syllabusId, tutorId, sourceAttachmentId: attachment.id, status })
    .returning({ id: questionImports.id });
  return { importId: row.id, attachmentId: attachment.id };
}

/** Syllabus first (cascades imports/questions), then attachments (restrict on profiles), then the user. */
export async function teardownTutor(user: TestUser) {
  await db.delete(syllabuses).where(eq(syllabuses.tutorId, user.id));
  await db.delete(attachments).where(eq(attachments.uploadedByUserId, user.id));
  await deleteTestUser(user);
}
