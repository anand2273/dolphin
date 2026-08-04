"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { concepts, syllabuses, topicConcepts, topics } from "@/lib/db/schema";
import { requireAuthUser } from "@/lib/auth/session";
import { assertSyllabusOwner, AuthzError } from "@/lib/auth/authz";
import { recordEvent } from "@/lib/db/events";
import {
  createConceptSchema,
  createTopicSchema,
  linkTopicConceptSchema,
  updateSyllabusSchema,
  updateTopicSchema,
} from "@/lib/validation/syllabus";
import { enqueueSyllabusExtraction } from "@/lib/queue/syllabus-extraction";
import { deleteSyllabus } from "@/app/(tutor)/syllabi/actions";
import type { FormState } from "@/lib/types";

/**
 * UI-only wrapper around deleteSyllabus: that action returns void and doesn't
 * redirect (unlike deleteClass), because the detail page — not the action
 * itself — knows it needs to navigate the tutor away afterwards. Matches
 * ConfirmButton's `() => Promise<void>` shape exactly.
 */
export async function deleteSyllabusAndRedirect(syllabusId: string): Promise<void> {
  await deleteSyllabus(syllabusId);
  redirect("/syllabi?notice=syllabus-deleted");
}

/**
 * Every mutation here re-derives the syllabus from the topic/concept id given —
 * none of them trust a syllabusId or tutorId supplied by the client to imply
 * ownership. See lib/auth/authz.ts#assertSyllabusOwner.
 */

export async function updateSyllabus(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = updateSyllabusSchema.safeParse({
    syllabusId: formData.get("syllabusId"),
    title: formData.get("title"),
    subject: formData.get("subject") ?? undefined,
    level: formData.get("level") ?? undefined,
    description: formData.get("description") ?? undefined,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const user = await requireAuthUser();
  try {
    await assertSyllabusOwner(user.id, parsed.data.syllabusId);
  } catch (e) {
    if (e instanceof AuthzError) return { error: "Not authorized" };
    throw e;
  }

  await db
    .update(syllabuses)
    .set({
      title: parsed.data.title,
      subject: parsed.data.subject ?? null,
      level: parsed.data.level ?? null,
      description: parsed.data.description ?? null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(syllabuses.id, parsed.data.syllabusId),
        isNull(syllabuses.deletedAt),
      ),
    );

  await recordEvent({
    actorId: user.id,
    verb: "syllabus.updated",
    subjectType: "syllabus",
    subjectId: parsed.data.syllabusId,
  });

  revalidatePath(`/syllabi/${parsed.data.syllabusId}`);
  return { ok: true };
}

/**
 * Re-run extraction on a syllabus's source document (e.g. after a failure).
 * Owner-only; no-op if there's no source document to re-process.
 */
export async function retrySyllabusExtraction(syllabusId: string): Promise<void> {
  const user = await requireAuthUser();
  let syllabus;
  try {
    syllabus = await assertSyllabusOwner(user.id, syllabusId);
  } catch (e) {
    if (e instanceof AuthzError) return;
    throw e;
  }
  if (!syllabus.sourceAttachmentId) return;

  await db
    .update(syllabuses)
    .set({ extractionStatus: "pending", extractionError: null, updatedAt: new Date() })
    .where(eq(syllabuses.id, syllabusId));

  // Same reasoning as confirmSyllabusDocumentUpload: a queue outage must land
  // back on the row as a readable error, not throw out of the action.
  try {
    await enqueueSyllabusExtraction({
      syllabusId,
      attachmentId: syllabus.sourceAttachmentId,
    });
  } catch (e) {
    await db
      .update(syllabuses)
      .set({
        extractionStatus: "failed",
        extractionError: `Could not queue extraction: ${
          e instanceof Error ? e.message : "unknown error"
        }`,
        updatedAt: new Date(),
      })
      .where(eq(syllabuses.id, syllabusId));
  }

  revalidatePath(`/syllabi/${syllabusId}`);
}

export async function createTopic(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = createTopicSchema.safeParse({
    syllabusId: formData.get("syllabusId"),
    name: formData.get("name"),
    description: formData.get("description") ?? undefined,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const user = await requireAuthUser();
  try {
    await assertSyllabusOwner(user.id, parsed.data.syllabusId);
  } catch (e) {
    if (e instanceof AuthzError) return { error: "Not authorized" };
    throw e;
  }

  await db.insert(topics).values({
    syllabusId: parsed.data.syllabusId,
    tutorId: user.id,
    name: parsed.data.name,
    description: parsed.data.description ?? null,
  });

  revalidatePath(`/syllabi/${parsed.data.syllabusId}`);
  return { ok: true };
}

/** Re-derives the syllabus from the topic itself — a topicId never implies ownership. */
async function ownedTopic(userId: string, topicId: string) {
  const [topic] = await db
    .select()
    .from(topics)
    .where(and(eq(topics.id, topicId), isNull(topics.deletedAt)))
    .limit(1);
  if (!topic) return null;
  await assertSyllabusOwner(userId, topic.syllabusId);
  return topic;
}

export async function updateTopic(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = updateTopicSchema.safeParse({
    topicId: formData.get("topicId"),
    name: formData.get("name"),
    description: formData.get("description") ?? undefined,
    orderIndex: formData.get("orderIndex")
      ? Number(formData.get("orderIndex"))
      : undefined,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const user = await requireAuthUser();
  let topic;
  try {
    topic = await ownedTopic(user.id, parsed.data.topicId);
  } catch (e) {
    if (e instanceof AuthzError) return { error: "Not authorized" };
    throw e;
  }
  if (!topic) return { error: "Not authorized" };

  await db
    .update(topics)
    .set({
      name: parsed.data.name,
      description: parsed.data.description ?? null,
      orderIndex: parsed.data.orderIndex ?? topic.orderIndex,
      updatedAt: new Date(),
    })
    .where(eq(topics.id, parsed.data.topicId));

  revalidatePath(`/syllabi/${topic.syllabusId}`);
  return { ok: true };
}

export async function deleteTopic(topicId: string): Promise<void> {
  const user = await requireAuthUser();
  let topic;
  try {
    topic = await ownedTopic(user.id, topicId);
  } catch (e) {
    if (e instanceof AuthzError) return;
    throw e;
  }
  if (!topic) return;

  await db
    .update(topics)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(eq(topics.id, topicId));

  revalidatePath(`/syllabi/${topic.syllabusId}`);
}

/** Concepts are tutor-scoped, not syllabus-scoped — created here for convenience
 * while editing a syllabus's topics, but not owned by any one syllabus. */
export async function createConcept(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = createConceptSchema.safeParse({
    name: formData.get("name"),
    description: formData.get("description") ?? undefined,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const user = await requireAuthUser();

  await db
    .insert(concepts)
    .values({
      tutorId: user.id,
      name: parsed.data.name,
      description: parsed.data.description ?? null,
    })
    .onConflictDoNothing();

  return { ok: true };
}

export async function linkTopicConcept(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = linkTopicConceptSchema.safeParse({
    topicId: formData.get("topicId"),
    conceptId: formData.get("conceptId"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const user = await requireAuthUser();
  let topic;
  try {
    topic = await ownedTopic(user.id, parsed.data.topicId);
  } catch (e) {
    if (e instanceof AuthzError) return { error: "Not authorized" };
    throw e;
  }
  if (!topic) return { error: "Not authorized" };

  // The concept must also belong to this tutor — a topic id alone doesn't
  // authorize attaching an arbitrary concept id from another account.
  const [concept] = await db
    .select({ id: concepts.id })
    .from(concepts)
    .where(
      and(
        eq(concepts.id, parsed.data.conceptId),
        eq(concepts.tutorId, user.id),
        isNull(concepts.deletedAt),
      ),
    )
    .limit(1);
  if (!concept) return { error: "Not authorized" };

  await db
    .insert(topicConcepts)
    .values({ topicId: parsed.data.topicId, conceptId: parsed.data.conceptId })
    .onConflictDoNothing();

  revalidatePath(`/syllabi/${topic.syllabusId}`);
  return { ok: true };
}

export async function unlinkTopicConcept(
  topicId: string,
  conceptId: string,
): Promise<void> {
  const user = await requireAuthUser();
  let topic;
  try {
    topic = await ownedTopic(user.id, topicId);
  } catch (e) {
    if (e instanceof AuthzError) return;
    throw e;
  }
  if (!topic) return;

  await db
    .delete(topicConcepts)
    .where(
      and(
        eq(topicConcepts.topicId, topicId),
        eq(topicConcepts.conceptId, conceptId),
      ),
    );

  revalidatePath(`/syllabi/${topic.syllabusId}`);
}
