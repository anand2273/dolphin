import { randomUUID } from "node:crypto";
import { createSupabaseAdminClient } from "@/lib/auth/supabase-admin";
import { SIGNED_DOWNLOAD_TTL_SECONDS, SIGNED_UPLOAD_TTL_SECONDS } from "./config";

/**
 * The only module that talks to object storage. Everything here is server-only:
 * it goes through the service-role client, which reads a non-public env var and
 * therefore cannot initialize in the browser. Every function assumes the CALLER
 * HAS ALREADY AUTHORIZED — none of these do an access check, so never expose one
 * directly to a client component or a route without a guard in front.
 *
 * Every function takes the target bucket explicitly (materials, syllabus
 * documents, ...) rather than assuming one — there is more than one private
 * bucket in this app now.
 *
 * This is also one of the three deliberate vendor touchpoints; swapping Supabase
 * Storage for S3 later means rewriting this file and nothing else.
 */

/**
 * Opaque object key. Deliberately carries no sequential id, no class or session
 * id, and no filename — a leaked key must reveal nothing and must not let anyone
 * guess a neighbouring object. The original filename is stored as metadata on
 * the attachments row instead.
 */
export function generateObjectKey(): string {
  return `${randomUUID()}/${randomUUID()}`;
}

/** A short-lived URL the browser can PUT bytes to. Authorize before calling. */
export async function createSignedUploadUrl(bucket: string, objectKey: string) {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.storage
    .from(bucket)
    .createSignedUploadUrl(objectKey, { upsert: false });

  if (error || !data) {
    throw new Error(`Could not prepare the upload: ${error?.message}`);
  }
  return {
    signedUrl: data.signedUrl,
    token: data.token,
    expiresInSeconds: SIGNED_UPLOAD_TTL_SECONDS,
  };
}

export type ObjectStat = { sizeBytes: number; mimeType: string };

/**
 * What actually landed in the bucket. The confirm step trusts this, never the
 * client's claim about what it uploaded — otherwise a caller could mint a URL
 * for a 1 KB text file, push a 2 GB executable, and have us record the lie.
 * Returns null when nothing is there.
 */
export async function statObject(
  bucket: string,
  objectKey: string,
): Promise<ObjectStat | null> {
  const admin = createSupabaseAdminClient();
  const slash = objectKey.lastIndexOf("/");
  const prefix = slash === -1 ? "" : objectKey.slice(0, slash);
  const name = slash === -1 ? objectKey : objectKey.slice(slash + 1);

  const { data, error } = await admin.storage
    .from(bucket)
    .list(prefix, { limit: 1, search: name });

  if (error || !data?.length) return null;
  const found = data.find((o) => o.name === name);
  if (!found?.metadata) return null;

  const size = Number(found.metadata.size);
  const mimeType = String(found.metadata.mimetype ?? "");
  if (!Number.isFinite(size)) return null;

  return { sizeBytes: size, mimeType };
}

/**
 * A short-lived download URL. Mint ONLY after an authz check — this is what
 * stands in for the bucket being private.
 */
export async function createSignedDownloadUrl(
  bucket: string,
  objectKey: string,
  downloadFilename?: string,
): Promise<string> {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.storage
    .from(bucket)
    .createSignedUrl(objectKey, SIGNED_DOWNLOAD_TTL_SECONDS, {
      download: downloadFilename ?? true,
    });

  if (error || !data) {
    throw new Error(`Could not prepare the download: ${error?.message}`);
  }
  return data.signedUrl;
}

/** Best-effort cleanup of an object whose rows never got written. */
export async function removeObject(bucket: string, objectKey: string): Promise<void> {
  const admin = createSupabaseAdminClient();
  await admin.storage.from(bucket).remove([objectKey]);
}
