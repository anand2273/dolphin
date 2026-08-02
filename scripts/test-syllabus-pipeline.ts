import "../worker/env";

import { extname } from "node:path";
import { readFile } from "node:fs/promises";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { attachments, concepts, syllabuses, topicConcepts, topics } from "@/lib/db/schema";
import { profiles } from "@/lib/db/schema";
import { createSupabaseAdminClient } from "@/lib/auth/supabase-admin";
import { generateObjectKey, removeObject } from "@/lib/storage/objects";
import {
  SYLLABUS_DOCUMENTS_BUCKET,
  isAllowedSyllabusDocumentMimeType,
  type SyllabusDocumentMimeType,
} from "@/lib/storage/config";
import { enqueueSyllabusExtraction } from "@/lib/queue/syllabus-extraction";

/**
 * A dev-only harness for exercising the syllabus-extraction pipeline without a
 * UI — there is no Syllabi tab yet, and Server Actions can't be invoked from
 * curl/Postman (they use a Next.js-internal encoding, not plain REST), so this
 * is the intended way to test upload -> enqueue -> worker -> Gemini -> DB
 * end to end. Reuses one fixed test tutor account across runs rather than
 * creating a new one every time. NOT wired into the app — never imported from
 * app/ or lib/.
 *
 * Usage:
 *   pnpm tsx scripts/test-syllabus-pipeline.ts <file> [title]
 *   pnpm tsx scripts/test-syllabus-pipeline.ts --status <syllabusId>
 *   pnpm tsx scripts/test-syllabus-pipeline.ts --cleanup
 *
 * After seeding, run `pnpm worker:dev` in another terminal to actually process
 * the job, then re-run with --status <syllabusId> (or use `pnpm db:studio`)
 * to see the result.
 */

const TEST_TUTOR_EMAIL = "syllabus-pipeline-test@test.local";

const EXT_MIME: Record<string, SyllabusDocumentMimeType> = {
  ".txt": "text/plain",
  ".pdf": "application/pdf",
  ".doc": "application/msword",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

async function findOrCreateTestTutor(): Promise<string> {
  const [existing] = await db
    .select({ id: profiles.id })
    .from(profiles)
    .where(eq(profiles.email, TEST_TUTOR_EMAIL))
    .limit(1);
  if (existing) return existing.id;

  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.auth.admin.createUser({
    email: TEST_TUTOR_EMAIL,
    password: "password12345",
    email_confirm: true,
  });
  if (error || !data.user) throw new Error(`createUser failed: ${error?.message}`);

  await db
    .insert(profiles)
    .values({ id: data.user.id, email: TEST_TUTOR_EMAIL, role: "tutor" })
    .onConflictDoNothing({ target: profiles.id });

  return data.user.id;
}

async function seed(filePath: string, title: string) {
  const ext = extname(filePath).toLowerCase();
  const mimeType = EXT_MIME[ext];
  if (!mimeType || !isAllowedSyllabusDocumentMimeType(mimeType)) {
    throw new Error(
      `Unsupported file extension "${ext}". Allowed: ${Object.keys(EXT_MIME).join(", ")}`,
    );
  }

  const tutorId = await findOrCreateTestTutor();
  const bytes = await readFile(filePath);

  const admin = createSupabaseAdminClient();
  const objectKey = generateObjectKey();
  const { error: uploadError } = await admin.storage
    .from(SYLLABUS_DOCUMENTS_BUCKET)
    .upload(objectKey, bytes, { contentType: mimeType });
  if (uploadError) throw new Error(`storage upload failed: ${uploadError.message}`);

  const [attachment] = await db
    .insert(attachments)
    .values({
      bucket: SYLLABUS_DOCUMENTS_BUCKET,
      objectKey,
      originalFilename: filePath.split("/").pop() ?? filePath,
      mimeType,
      sizeBytes: bytes.length,
      uploadedByUserId: tutorId,
    })
    .returning({ id: attachments.id });

  const [syllabus] = await db
    .insert(syllabuses)
    .values({
      tutorId,
      title,
      sourceAttachmentId: attachment.id,
      extractionStatus: "pending",
    })
    .returning({ id: syllabuses.id });

  await enqueueSyllabusExtraction({ syllabusId: syllabus.id, attachmentId: attachment.id });

  console.log(`Seeded and enqueued.
  syllabusId:   ${syllabus.id}
  attachmentId: ${attachment.id}
  tutorId:      ${tutorId}

Next: run \`pnpm worker:dev\` in another terminal, then:
  pnpm tsx scripts/test-syllabus-pipeline.ts --status ${syllabus.id}`);
}

async function status(syllabusId: string) {
  const [syllabus] = await db
    .select()
    .from(syllabuses)
    .where(eq(syllabuses.id, syllabusId))
    .limit(1);
  if (!syllabus) {
    console.log("No such syllabus.");
    return;
  }
  console.log(
    `"${syllabus.title}" — extraction_status: ${syllabus.extractionStatus}` +
      (syllabus.extractionError ? ` (${syllabus.extractionError})` : ""),
  );

  const rows = await db
    .select()
    .from(topics)
    .where(and(eq(topics.syllabusId, syllabusId), isNull(topics.deletedAt)))
    .orderBy(topics.orderIndex);

  for (const topic of rows) {
    const links = await db
      .select({ name: concepts.name })
      .from(topicConcepts)
      .innerJoin(concepts, eq(concepts.id, topicConcepts.conceptId))
      .where(eq(topicConcepts.topicId, topic.id));
    console.log(`  - ${topic.name}${links.length ? ": " + links.map((l) => l.name).join(", ") : ""}`);
  }
}

/** Wipes this test tutor's syllabuses/topics/concepts/attachments + storage objects. Keeps the account itself. */
async function cleanup() {
  const [tutor] = await db
    .select({ id: profiles.id })
    .from(profiles)
    .where(eq(profiles.email, TEST_TUTOR_EMAIL))
    .limit(1);
  if (!tutor) {
    console.log("No test tutor to clean up.");
    return;
  }

  const theirSyllabuses = await db
    .select({ id: syllabuses.id })
    .from(syllabuses)
    .where(eq(syllabuses.tutorId, tutor.id));

  const theirAttachments = await db
    .select({ id: attachments.id, objectKey: attachments.objectKey })
    .from(attachments)
    .where(eq(attachments.uploadedByUserId, tutor.id));

  // syllabuses -> topics -> topic_concepts all cascade via FK; concepts don't
  // (they're tutor-scoped, not syllabus-scoped) so delete them explicitly.
  await db.delete(syllabuses).where(eq(syllabuses.tutorId, tutor.id));
  await db.delete(concepts).where(eq(concepts.tutorId, tutor.id));
  await db.delete(attachments).where(eq(attachments.uploadedByUserId, tutor.id));

  for (const a of theirAttachments) {
    await removeObject(SYLLABUS_DOCUMENTS_BUCKET, a.objectKey);
  }

  console.log(
    `Cleaned up ${theirSyllabuses.length} syllabus(es) and ${theirAttachments.length} attachment(s). Test tutor account kept for reuse.`,
  );
}

async function main() {
  const [arg1, arg2] = process.argv.slice(2);

  if (arg1 === "--cleanup") return cleanup();
  if (arg1 === "--status") {
    if (!arg2) throw new Error("usage: --status <syllabusId>");
    return status(arg2);
  }
  if (!arg1) {
    throw new Error(
      "usage: tsx scripts/test-syllabus-pipeline.ts <file> [title] | --status <id> | --cleanup",
    );
  }
  return seed(arg1, arg2 ?? "Pipeline test syllabus");
}

main().then(() => process.exit(0));
