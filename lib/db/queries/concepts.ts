import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { conceptMergeRejections, concepts, topicConcepts } from "@/lib/db/schema";
import { clusterConcepts, pairKey, type ConceptCluster } from "@/lib/concepts/cluster";

/**
 * Every read here is gated on tutor ownership. A concept has no class and no
 * "enrolled" relationship, so there is only "owner" or nothing.
 */

/** Pair keys this tutor has already ruled "not duplicates". */
export async function listRejectedPairKeysForTutor(
  userId: string,
): Promise<Set<string>> {
  const rows = await db
    .select({
      a: conceptMergeRejections.conceptAId,
      b: conceptMergeRejections.conceptBId,
    })
    .from(conceptMergeRejections)
    .where(eq(conceptMergeRejections.tutorId, userId));

  return new Set(rows.map((r) => pairKey(r.a, r.b)));
}

/**
 * Duplicate clusters awaiting this tutor's decision.
 *
 * Deliberately reads the concepts it needs directly rather than adding a
 * similarity query: detection is a pure function over rows we already have, so
 * there is no index, no threshold, and nothing to keep in sync.
 */
export async function listConceptClustersForTutor(
  userId: string,
): Promise<ConceptCluster[]> {
  const [rows, rejected] = await Promise.all([
    db
      .select({ id: concepts.id, name: concepts.name })
      .from(concepts)
      .where(and(eq(concepts.tutorId, userId), isNull(concepts.deletedAt)))
      .orderBy(asc(concepts.name)),
    listRejectedPairKeysForTutor(userId),
  ]);

  return clusterConcepts(rows, rejected);
}

/** How many topics each of the given concepts is linked to, for the review UI. */
export async function countTopicsForConcepts(
  userId: string,
  conceptIds: string[],
): Promise<Map<string, number>> {
  if (conceptIds.length === 0) return new Map();

  const rows = await db
    .select({
      conceptId: topicConcepts.conceptId,
      count: sql<number>`count(*)::int`,
    })
    .from(topicConcepts)
    .innerJoin(concepts, eq(concepts.id, topicConcepts.conceptId))
    .where(
      and(
        inArray(topicConcepts.conceptId, conceptIds),
        eq(concepts.tutorId, userId),
      ),
    )
    .groupBy(topicConcepts.conceptId);

  return new Map(rows.map((r) => [r.conceptId, r.count]));
}
