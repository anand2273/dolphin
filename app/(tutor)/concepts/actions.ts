"use server";

import { revalidatePath } from "next/cache";
import { eq, or } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { conceptMergeRejections, concepts, topicConcepts } from "@/lib/db/schema";
import { requireAuthUser } from "@/lib/auth/session";
import { assertConceptsOwned, AuthzError } from "@/lib/auth/authz";
import { recordEvent } from "@/lib/db/events";
import { mergeConceptsSchema, rejectClusterSchema } from "@/lib/validation/concept";
import type { FormState } from "@/lib/types";

/**
 * Merging is the only destructive operation on a tutor's vocabulary, so both
 * actions here authorize the ENTIRE id set before touching anything — a
 * survivor id the caller legitimately owns must not launder loser ids they do
 * not.
 */

export async function mergeConcepts(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = mergeConceptsSchema.safeParse({
    survivorId: formData.get("survivorId"),
    loserIds: formData.getAll("loserIds"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const { survivorId, loserIds } = parsed.data;

  const user = await requireAuthUser();
  try {
    await assertConceptsOwned(user.id, [survivorId, ...loserIds]);
  } catch (e) {
    if (e instanceof AuthzError) return { error: "Not authorized" };
    throw e;
  }

  await db.transaction(async (tx) => {
    for (const loserId of loserIds) {
      // Repoint topic links. onConflictDoNothing because a topic may already
      // link to both concepts, and the composite PK would reject the duplicate.
      const links = await tx
        .select({ topicId: topicConcepts.topicId })
        .from(topicConcepts)
        .where(eq(topicConcepts.conceptId, loserId));
      for (const link of links) {
        await tx
          .insert(topicConcepts)
          .values({ topicId: link.topicId, conceptId: survivorId })
          .onConflictDoNothing();
      }
      await tx.delete(topicConcepts).where(eq(topicConcepts.conceptId, loserId));

      // Tombstone. Soft-deleting drops the row out of
      // concepts_tutor_name_live_uidx, which is partial on deleted_at is null,
      // so this can never collide with the survivor's name.
      await tx
        .update(concepts)
        .set({ deletedAt: new Date(), mergedIntoId: survivorId, updatedAt: new Date() })
        .where(eq(concepts.id, loserId));

      // Repoints any pre-existing tombstone that already pointed at this
      // loser (an earlier merge chain) at the new survivor instead, so
      // resolution is always exactly one hop and needs no loop guard. Order
      // relative to the tombstone update above doesn't matter for
      // well-formed input: pre-merge the loser's mergedIntoId is NULL, so it
      // can't match this statement's WHERE clause either way.
      await tx
        .update(concepts)
        .set({ mergedIntoId: survivorId })
        .where(eq(concepts.mergedIntoId, loserId));

      // Rejections naming a now-dead row would accumulate forever.
      await tx
        .delete(conceptMergeRejections)
        .where(
          or(
            eq(conceptMergeRejections.conceptAId, loserId),
            eq(conceptMergeRejections.conceptBId, loserId),
          ),
        );
    }

    await recordEvent(
      {
        actorId: user.id,
        verb: "concept.merged",
        subjectType: "concept",
        subjectId: survivorId,
        payload: { mergedConceptIds: loserIds },
      },
      tx,
    );
  });

  revalidatePath("/concepts");
  return { ok: true };
}

export async function rejectCluster(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = rejectClusterSchema.safeParse({
    conceptIds: formData.getAll("conceptIds"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const conceptIds = [...new Set(parsed.data.conceptIds)];

  // The schema's `.min(2)` ran on the pre-dedupe list, so it doesn't catch a
  // submission that only looked like a real cluster: duplicate ids in the
  // form, or two ids that differed only by UUID case before the schema's
  // lowercase normalisation collapsed them to the same value. Deduping can
  // still fold the set below 2, and a single concept has no pair to record —
  // check before authorizing so a doomed request doesn't cost a DB round trip.
  if (conceptIds.length < 2) {
    return { error: "A cluster needs at least two concepts" };
  }

  const user = await requireAuthUser();
  try {
    await assertConceptsOwned(user.id, conceptIds);
  } catch (e) {
    if (e instanceof AuthzError) return { error: "Not authorized" };
    throw e;
  }

  // Every pair in the cluster, stored in the canonical order the table's
  // CHECK (concept_a_id < concept_b_id) requires.
  const rows: { tutorId: string; conceptAId: string; conceptBId: string }[] = [];
  for (let i = 0; i < conceptIds.length; i++) {
    for (let j = i + 1; j < conceptIds.length; j++) {
      const [a, b] = [conceptIds[i], conceptIds[j]].sort();
      rows.push({ tutorId: user.id, conceptAId: a, conceptBId: b });
    }
  }

  await db.insert(conceptMergeRejections).values(rows).onConflictDoNothing();

  revalidatePath("/concepts");
  return { ok: true };
}
