/**
 * The complete set of messages a `?notice=` param may produce.
 *
 * The lookup is the point: these pages are reachable by anyone holding a link,
 * so rendering the raw param would let a stranger put arbitrary text into the
 * app's own chrome — "Your account was suspended, call…" reads as if the product
 * said it. An unknown key resolves to null and nothing renders.
 */
const NOTICES = {
  "lesson-deleted": "Lesson deleted.",
  "class-deleted": "Class deleted.",
  "syllabus-deleted": "Syllabus deleted.",
} as const;

export type NoticeKey = keyof typeof NOTICES;

/** Resolves a raw search param to a known message, or null. */
export function resolveNotice(raw: string | string[] | undefined): string | null {
  if (typeof raw !== "string") return null;
  return NOTICES[raw as NoticeKey] ?? null;
}
