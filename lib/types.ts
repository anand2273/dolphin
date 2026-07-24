/** Typed result object returned by every Server Action (CLAUDE.md convention). */
export type ActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: string };

/** Shape passed to/from useActionState-driven forms. */
export type FormState = { error?: string; ok?: boolean };
