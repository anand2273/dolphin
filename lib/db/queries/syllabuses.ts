import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import type { InferSelectModel } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { concepts, syllabuses, topicConcepts, topics } from "@/lib/db/schema";

export type Syllabus = InferSelectModel<typeof syllabuses>;
export type Topic = InferSelectModel<typeof topics>;
export type Concept = InferSelectModel<typeof concepts>;

/**
 * Every read here is gated on tutor ownership — a syllabus has no class and no
 * "enrolled" relationship, so unlike materials/sessions there is only "owner" or
 * nothing. A syllabus id from the client is only ever a lookup key.
 */

/** A tutor's own live syllabuses, most recently updated first. */
export async function listSyllabiForTutor(userId: string): Promise<Syllabus[]> {
  return db
    .select()
    .from(syllabuses)
    .where(and(eq(syllabuses.tutorId, userId), isNull(syllabuses.deletedAt)))
    .orderBy(desc(syllabuses.updatedAt));
}

/**
 * A single syllabus, or null if it doesn't exist, is soft-deleted, or belongs to
 * another tutor. Never distinguishes those cases to the caller — same non-leak
 * rule as classes/materials.
 */
export async function getSyllabusForOwner(
  userId: string,
  syllabusId: string,
): Promise<Syllabus | null> {
  const [syllabus] = await db
    .select()
    .from(syllabuses)
    .where(
      and(
        eq(syllabuses.id, syllabusId),
        eq(syllabuses.tutorId, userId),
        isNull(syllabuses.deletedAt),
      ),
    )
    .limit(1);
  return syllabus ?? null;
}

export type TopicWithConcepts = Topic & { concepts: Concept[] };

/**
 * A syllabus's live topics in display order, each with its associated concepts.
 * Returns [] (not an error) if the syllabus doesn't belong to this tutor — same
 * defensive gate as every other list query, even though today's only caller
 * already checked ownership itself.
 */
export async function listTopicsForSyllabus(
  userId: string,
  syllabusId: string,
): Promise<TopicWithConcepts[]> {
  const owned = await getSyllabusForOwner(userId, syllabusId);
  if (!owned) return [];

  const rows = await db
    .select()
    .from(topics)
    .where(and(eq(topics.syllabusId, syllabusId), isNull(topics.deletedAt)))
    .orderBy(asc(topics.orderIndex), asc(topics.createdAt));

  if (rows.length === 0) return [];

  const links = await db
    .select({
      topicId: topicConcepts.topicId,
      concept: concepts,
    })
    .from(topicConcepts)
    .innerJoin(concepts, eq(concepts.id, topicConcepts.conceptId))
    .where(
      inArray(
        topicConcepts.topicId,
        rows.map((r) => r.id),
      ),
    );

  const conceptsByTopic = new Map<string, Concept[]>();
  for (const link of links) {
    const list = conceptsByTopic.get(link.topicId) ?? [];
    list.push(link.concept);
    conceptsByTopic.set(link.topicId, list);
  }

  return rows.map((topic) => ({
    ...topic,
    concepts: conceptsByTopic.get(topic.id) ?? [],
  }));
}

/** A tutor's own live concepts, alphabetical — the picker list when tagging a topic. */
export async function listConceptsForTutor(userId: string): Promise<Concept[]> {
  return db
    .select()
    .from(concepts)
    .where(and(eq(concepts.tutorId, userId), isNull(concepts.deletedAt)))
    .orderBy(asc(concepts.name));
}
