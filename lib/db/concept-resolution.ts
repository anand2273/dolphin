import { and, desc, eq, isNotNull, isNull, sql } from "drizzle-orm";
import type { DbOrTx } from "./client";
import { concepts } from "./schema";

/**
 * Resolves a concept NAME to a tutor-owned concept id, creating the row only
 * when nothing already stands for that name.
 *
 * Lives in lib/ because both writers of concepts need it and they cannot see
 * each other: the extraction worker (worker/process-syllabus-extraction.ts)
 * and the preset deep-copy (app/(tutor)/syllabi/actions.ts). worker/ may
 * import from lib/ but never from app/, so lib/ is the only shareable home.
 * A second, subtly different copy of this logic is exactly how the preset path
 * ended up defeating the merge tombstone.
 *
 * Take a resolver per transaction (see `createConceptResolver`) — the cache it
 * closes over is only valid for the life of that transaction.
 */

/** Resolve one name; memoised per resolver. */
export type ConceptResolver = (
  name: string,
  description?: string,
) => Promise<string>;

/**
 * Build a resolver bound to one tutor and one transaction handle.
 *
 * `tx` is passed in rather than reaching for `db` so every write lands on the
 * caller's transaction and rolls back with it.
 */
export function createConceptResolver(tx: DbOrTx, tutorId: string): ConceptResolver {
  const conceptIdByName = new Map<string, string>();

  return async function conceptIdFor(name, description) {
    const key = name.toLowerCase();
    const cached = conceptIdByName.get(key);
    if (cached) return cached;

    // 1. A live concept under this name. Matched case-insensitively
    // because concepts_tutor_name_live_uidx is on (tutor_id, lower(name)) —
    // a case-sensitive lookup misses a row differing only in case and then
    // collides with that index on insert.
    const [live] = await tx
      .select({ id: concepts.id })
      .from(concepts)
      .where(
        and(
          eq(concepts.tutorId, tutorId),
          sql`lower(${concepts.name}) = ${key}`,
          isNull(concepts.deletedAt),
        ),
      )
      .limit(1);
    if (live) {
      conceptIdByName.set(key, live.id);
      return live.id;
    }

    // 2. A tombstone: this name was merged away by the tutor. Follow the
    // pointer instead of recreating the row.
    //
    // Load-bearing. concepts_tutor_name_live_uidx is PARTIAL on
    // "deleted_at is null", so without this a merged-away name has no live
    // row, gets recreated here, and the tutor is proposed the identical
    // merge after every future upload. Merges repoint tombstones at the new
    // survivor and take FOR UPDATE locks over the whole cluster so two of them
    // cannot interleave into a cycle — that is what makes one hop enough here,
    // so no loop guard is needed.
    const [tombstone] = await tx
      .select({ mergedIntoId: concepts.mergedIntoId })
      .from(concepts)
      .where(
        and(
          eq(concepts.tutorId, tutorId),
          sql`lower(${concepts.name}) = ${key}`,
          isNotNull(concepts.deletedAt),
          isNotNull(concepts.mergedIntoId),
        ),
      )
      .orderBy(desc(concepts.updatedAt))
      .limit(1);
    if (tombstone?.mergedIntoId) {
      conceptIdByName.set(key, tombstone.mergedIntoId);
      return tombstone.mergedIntoId;
    }

    // 3. Create. onConflictDoNothing + re-select rather than a bare insert:
    // the worker runs concurrency 2, so two jobs for one tutor can both
    // miss the select above and collide on the unique index (23505), which
    // aborts the whole transaction and fails a job that has already paid
    // for every Gemini call in the document.
    const [created] = await tx
      .insert(concepts)
      .values({ tutorId, name, description: description ?? null })
      .onConflictDoNothing()
      .returning({ id: concepts.id });

    if (created) {
      conceptIdByName.set(key, created.id);
      return created.id;
    }

    const [raced] = await tx
      .select({ id: concepts.id })
      .from(concepts)
      .where(
        and(
          eq(concepts.tutorId, tutorId),
          sql`lower(${concepts.name}) = ${key}`,
          isNull(concepts.deletedAt),
        ),
      )
      .limit(1);
    if (!raced) throw new Error(`Could not resolve concept "${name}"`);
    conceptIdByName.set(key, raced.id);
    return raced.id;
  };
}
