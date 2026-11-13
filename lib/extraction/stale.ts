/**
 * An extraction runs inside a Vercel function capped at 300s. If that function
 * is killed (timeout, redeploy, crash) nothing is left to write `failed`, so the
 * row would say pending/processing forever. Instead, a row still in flight
 * well past the cap is *read* as failed — derived on every read, never written
 * by a sweeper — so the existing failed UI (pill + Retry button) applies.
 *
 * 10 minutes is comfortably over 300s plus retry backoff, so a run that is
 * genuinely still going is never shown as failed.
 */
export const STALE_AFTER_MS = 10 * 60 * 1000;

export const STALE_MESSAGE =
  "Extraction stopped before finishing (it may have timed out). Try again.";

type InFlight = "pending" | "processing";

export function isStale(
  status: string,
  updatedAt: Date,
  now: Date = new Date(),
): status is InFlight {
  return (
    (status === "pending" || status === "processing") &&
    now.getTime() - updatedAt.getTime() > STALE_AFTER_MS
  );
}

/** A syllabus row as the tutor should see it. */
export function withStaleSyllabusAsFailed<
  T extends { extractionStatus: string; extractionError: string | null; updatedAt: Date },
>(row: T, now: Date = new Date()): T {
  if (!isStale(row.extractionStatus, row.updatedAt, now)) return row;
  return { ...row, extractionStatus: "failed", extractionError: STALE_MESSAGE };
}
