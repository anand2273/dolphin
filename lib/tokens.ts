import { createHash, randomBytes } from "node:crypto";

/**
 * Opaque invite tokens. We email the raw token (inside the accept link) and
 * store only its SHA-256 hash, so a leaked DB can't be used to accept invites.
 * The token merely *selects* which invitation; email-control is the real gate.
 */
export function generateInviteToken(): { raw: string; hash: string } {
  const raw = randomBytes(32).toString("base64url");
  return { raw, hash: hashToken(raw) };
}

export function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}
