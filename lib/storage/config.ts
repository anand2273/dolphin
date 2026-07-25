/**
 * THE single place file constraints are declared (CLAUDE.md: "File size and MIME
 * allowlists live in one config module, not sprinkled at call sites").
 *
 * These values are mirrored onto the bucket itself in supabase/config.toml, so
 * Storage rejects an oversized or wrong-typed object even if a caller somehow
 * reaches it without passing through our checks. Change both together.
 */

/** Private bucket. No public URLs are ever issued from it. */
export const MATERIALS_BUCKET = "materials";

export const MAX_FILE_BYTES = 25 * 1024 * 1024; // 25 MiB

/** How long a download link stays valid. Short: links get forwarded. */
export const SIGNED_DOWNLOAD_TTL_SECONDS = 60;

/** How long a tutor has to actually push the bytes after we mint an upload URL. */
export const SIGNED_UPLOAD_TTL_SECONDS = 120;

/**
 * Allowlist, not a blocklist. Anything absent is refused. Deliberately excludes
 * anything the browser would execute (svg, html) — these files are served back
 * to students, and an SVG is a script delivery vector.
 */
export const ALLOWED_MIME_TYPES = [
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/heic",
  "text/plain",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
] as const;

export type AllowedMimeType = (typeof ALLOWED_MIME_TYPES)[number];

export function isAllowedMimeType(value: string): value is AllowedMimeType {
  return (ALLOWED_MIME_TYPES as readonly string[]).includes(value);
}

/** For the file picker's `accept` attribute. Advisory only — never a check. */
export const ACCEPT_ATTRIBUTE = ALLOWED_MIME_TYPES.join(",");

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
