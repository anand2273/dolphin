/**
 * Request headers by which middleware hands the *already verified* viewer to
 * the render pass, so a request costs one GoTrue round trip instead of two.
 *
 * These are trustworthy for exactly one reason: `updateSession` deletes any
 * inbound copy before forwarding, so a value that arrives at a Server Component
 * can only have been written by middleware after its own `getUser()` returned.
 * A client that sends these headers itself has them stripped.
 *
 * That guarantee rests on middleware running for every route that reads them —
 * see the matcher test in `tests/auth.identity-headers.test.ts`. If the matcher
 * ever stops covering a route, that route silently falls back to a real GoTrue
 * lookup (slower, still correct); it never trusts a client value.
 *
 * Kept dependency-free: imported from both the Edge middleware and the Node
 * render pass.
 */

export const IDENTITY_HEADER_USER_ID = "x-dolphn-user-id";
export const IDENTITY_HEADER_USER_EMAIL = "x-dolphn-user-email";

export const IDENTITY_HEADERS = [
  IDENTITY_HEADER_USER_ID,
  IDENTITY_HEADER_USER_EMAIL,
] as const;
