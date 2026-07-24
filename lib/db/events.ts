import { db } from "./client";
import { events } from "./schema";

/**
 * Append a row to the immutable activity log. Written on domain-significant
 * actions (upload, issue, submit, grade, and — cheaply — class creation).
 * Accepts a transaction if the caller has one, so the event commits atomically
 * with the mutation it describes.
 */
export async function recordEvent(
  input: {
    actorId?: string | null;
    verb: string;
    subjectType: string;
    subjectId: string;
    payload?: unknown;
  },
  tx: Pick<typeof db, "insert"> = db,
) {
  await tx.insert(events).values({
    actorId: input.actorId ?? null,
    verb: input.verb,
    subjectType: input.subjectType,
    subjectId: input.subjectId,
    payload: input.payload ?? null,
  });
}
