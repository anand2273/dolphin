import { NextResponse, type NextRequest } from "next/server";
import { getAuthUser } from "@/lib/auth/session";
import { getMaterialForViewer } from "@/lib/db/queries/materials";
import { createSignedDownloadUrl } from "@/lib/storage/objects";

/**
 * The ONLY way bytes leave the private bucket.
 *
 * Order matters and is the whole point: resolve the caller, authorize them
 * against the material's class, and only then mint a signed URL. The signed URL
 * is short-lived (see SIGNED_DOWNLOAD_TTL_SECONDS) because links get forwarded,
 * and it is never stored or rendered into a page — it exists only as this
 * redirect's Location.
 *
 * A material that doesn't exist, is soft-deleted, or belongs to a class the
 * caller isn't in are all 404: never confirm that an id is real.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ materialId: string }> },
) {
  const { materialId } = await params;

  const user = await getAuthUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const material = await getMaterialForViewer(user.id, materialId);
  if (!material) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const signedUrl = await createSignedDownloadUrl(
    material.objectKey,
    material.originalFilename,
  );

  // no-store: the redirect embeds a credential-bearing URL. It must never be
  // cached by the browser or an intermediary and replayed later.
  return NextResponse.redirect(signedUrl, {
    headers: { "Cache-Control": "no-store" },
  });
}
