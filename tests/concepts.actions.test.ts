import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { concepts } from "@/lib/db/schema";
import {
  IDENTITY_HEADER_USER_EMAIL,
  IDENTITY_HEADER_USER_ID,
} from "@/lib/auth/identity-headers";
import { createTestUser, deleteTestUser, type TestUser } from "./helpers/seed";

/**
 * Regression tests for two review findings on the merge/reject actions:
 *
 * 1. Zod's .uuid() is case-insensitive but .includes() equality is not, so a
 *    survivorId/loserId pair that are the SAME uuid in different letter case
 *    used to slip past the self-merge refinement — and, once Postgres
 *    canonicalises the case on cast, run the merge loop with loserId ===
 *    survivorId, hard-deleting the survivor's own topic links. Fixed by
 *    lowercasing every uuid field in the validation schema.
 *
 * 2. rejectCluster deduped ids AFTER the schema's `.min(2)` had already
 *    judged the pre-dedupe list, so a submission with a duplicate id deduped
 *    down to a single concept, produced a zero-length pair list, and threw
 *    out of `db.insert(...).values([])` instead of returning a typed
 *    FormState — contradicting the "actions never throw" rule. Fixed with a
 *    length check before the pair loop.
 */

// Middleware forwards the verified viewer as headers; requireAuthUser reads
// those before ever asking Supabase. Mocking next/headers to return a real
// test tutor's identity lets rejectCluster run its actual authorize + mutate
// path so this test reaches the real bug (the empty-array insert) instead of
// failing earlier on "no request scope" or "no session".
let identityUserId: string | null = null;
let identityUserEmail: string | null = null;
vi.mock("next/headers", () => ({
  headers: async () => ({
    get: (name: string) => {
      if (name === IDENTITY_HEADER_USER_ID) return identityUserId;
      if (name === IDENTITY_HEADER_USER_EMAIL) return identityUserEmail;
      return null;
    },
  }),
}));

const { mergeConceptsSchema } = await import("@/lib/validation/concept");
const { rejectCluster } = await import("@/app/(tutor)/concepts/actions");

describe("mergeConceptsSchema", () => {
  it("refuses a survivor/loser pair that are the same UUID in different letter case", () => {
    const id = "123e4567-e89b-12d3-a456-426614174000";

    const result = mergeConceptsSchema.safeParse({
      survivorId: id.toUpperCase(),
      loserIds: [id.toLowerCase()],
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toMatch(
        /cannot be merged into itself/,
      );
    }
  });
});

describe("rejectCluster", () => {
  let tutor: TestUser;
  let conceptId: string;

  beforeAll(async () => {
    tutor = await createTestUser("reject-cluster-dup", "tutor");
    const [row] = await db
      .insert(concepts)
      .values({ tutorId: tutor.id, name: "osmosis" })
      .returning({ id: concepts.id });
    conceptId = row.id;

    identityUserId = tutor.id;
    identityUserEmail = tutor.email;
  });

  afterAll(async () => {
    await db.delete(concepts).where(eq(concepts.tutorId, tutor.id));
    await deleteTestUser(tutor);
  });

  it("returns a FormState error, not a thrown exception, when a duplicate id dedupes the cluster below 2", async () => {
    const fd = new FormData();
    fd.append("conceptIds", conceptId);
    fd.append("conceptIds", conceptId);

    const result = await rejectCluster({}, fd);

    expect(result.ok).not.toBe(true);
    expect(result.error).toMatch(/at least two concepts/);
  });
});
