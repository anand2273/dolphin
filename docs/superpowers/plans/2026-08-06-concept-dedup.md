# Concept Deduplication Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a tutor find and merge duplicate concepts across their syllabuses, using string normalisation to propose clusters that the tutor confirms.

**Architecture:** Detection is a pure function that normalises a concept name into a comparison key; two concepts cluster iff their keys are equal. Clusters are derived on every read from data already loaded — nothing is cached, so nothing goes stale. Merging soft-deletes the losing rows and points them at the survivor with `merged_into_id`, which the extraction worker follows so a merge is never re-proposed. Rejections are stored pairwise and permanently.

**Tech Stack:** Next.js App Router, TypeScript, Drizzle ORM, PostgreSQL, Vitest, Tailwind + shadcn/ui.

**Spec:** [`../specs/2026-08-06-concept-dedup-design.md`](../specs/2026-08-06-concept-dedup-design.md) — read the Evidence section before changing the detection approach.

## Global Constraints

- **No new npm dependencies.** No pgvector, no embeddings, no Gemini call on this path.
- **Detection never merges.** The write path keeps exact `lower(name)` matching. Normalisation informs review only.
- **Every Server Action follows parse → authorize → mutate → revalidate.** Step 2 is never skipped.
- **Actions return typed results** (`FormState` = `{ error?: string; ok?: boolean }`). Never throw strings.
- **Authorization is ownership-only** for concepts — no class relationship exists. Mirror `assertSyllabusOwner`.
- **Never distinguish "missing" from "not yours"** in any error surfaced to a client.
- **Soft-delete only.** Nothing in this feature hard-deletes a concept.
- **Server Components by default.** A `"use client"` component carries a one-line comment saying why.
- **Migrations are Drizzle's** (`pnpm db:generate` / `pnpm db:migrate`) in `lib/db/migrations/`. `supabase db push` does nothing in this repo.
- **Never run `pnpm build` while a dev server is running.** Verify with `pnpm typecheck && pnpm test`.
- Branch is `feat/concept-dedup`, already created off `main`.

## File Structure

| File | Responsibility |
|---|---|
| `lib/concepts/normalise.ts` | **New.** Pure name → comparison key. The entire detection rule. |
| `lib/concepts/cluster.ts` | **New.** Pure grouping of concepts into clusters, honouring rejected pairs. |
| `lib/db/schema.ts` | **Modify.** `concepts.mergedIntoId`; new `conceptMergeRejections` table. |
| `lib/db/queries/concepts.ts` | **New.** Reads: clusters for a tutor, rejected pairs for a tutor. |
| `lib/auth/authz.ts` | **Modify.** `assertConceptsOwned`. |
| `lib/validation/concept.ts` | **New.** Zod schemas for merge and reject. |
| `app/(tutor)/concepts/actions.ts` | **New.** `mergeConcepts`, `rejectCluster`. |
| `app/(tutor)/concepts/page.tsx` | **New.** The Concepts destination. |
| `components/concept-cluster-review.tsx` | **New.** `"use client"` — radio state for survivor selection. |
| `worker/process-syllabus-extraction.ts` | **Modify.** `conceptIdFor` follows tombstones; race fix. |
| `tests/concepts.normalise.test.ts` | **New.** Positive and negative normalisation cases. |
| `tests/concepts.cluster.test.ts` | **New.** Grouping and rejection logic. |
| `tests/authz.concept.test.ts` | **New.** Negative authorization cases. |

Tasks 1 and 2 are independent. Tasks 3–6 depend on both. Tasks 7–8 depend on 3–5.

---

### Task 1: The normalisation function

Pure, no database. This is the whole detection rule, so it gets the most thorough tests in the plan.

**Files:**
- Create: `lib/concepts/normalise.ts`
- Test: `tests/concepts.normalise.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `normalisedKey(name: string): string`

- [ ] **Step 1: Write the failing test**

Create `tests/concepts.normalise.test.ts`. Every case below is drawn from the real 736-concept corpus.

```ts
import { describe, expect, it } from "vitest";
import { normalisedKey } from "@/lib/concepts/normalise";

const same = (a: string, b: string) =>
  expect(normalisedKey(a)).toBe(normalisedKey(b));
const different = (a: string, b: string) =>
  expect(normalisedKey(a)).not.toBe(normalisedKey(b));

describe("normalisedKey — pairs that MUST cluster", () => {
  it("collapses plurals", () => {
    same("alcohol", "alcohols");
    same("rate constant", "rate constants");
    same("ionisation energy", "ionisation energies");
    same("chiral centre", "chiral centres");
  });

  it("collapses apostrophe styles", () => {
    same("coulomb's law", "coulomb’s law");
    same("newton's law of gravitation", "newton’s law of gravitation");
  });

  it("collapses British and American spelling", () => {
    same("ideal gas behaviour", "ideal gas behavior");
  });

  it("collapses word order", () => {
    same("Inverse Matrix", "Matrix Inverse");
    same("batteries and fuel cells", "fuel cells and batteries");
    same("Concept of Definite Integral", "Definite Integral Concept");
  });

  it("collapses stopword differences", () => {
    same("nucleus of the atom", "the nucleus of the atom");
    same("recycling of plastics", "recycling plastics");
    same("Testing a population mean", "Testing for Population Mean");
  });

  it("is case insensitive", () => {
    same("Binomial Coefficient", "binomial coefficients");
  });
});

describe("normalisedKey — pairs that MUST NOT cluster", () => {
  it("keeps chemically distinct names apart", () => {
    different("nitrate", "nitrite");
    different("alkanes", "alkenes");
    different("acid dissociation constants", "base dissociation constants");
  });

  it("keeps physically distinct names apart", () => {
    different("electric potential", "electric potential energy");
    different("gravitational field strength", "gravitational potential");
  });

  it("keeps different aspects of one subject apart", () => {
    different(
      "formation of carboxylic acids",
      "reactions of carboxylic acids",
    );
  });
});

describe("normalisedKey — shape", () => {
  it("is stable under repeated application of the same input", () => {
    expect(normalisedKey("Rate Constants")).toBe(normalisedKey("rate constant"));
  });

  it("returns a non-empty key for a name made only of stopwords", () => {
    expect(normalisedKey("the of and")).not.toBe("");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/concepts.normalise.test.ts`
Expected: FAIL — `Cannot find module '@/lib/concepts/normalise'`

- [ ] **Step 3: Write the implementation**

Create `lib/concepts/normalise.ts`:

```ts
/**
 * The whole of duplicate detection: a concept name reduced to a comparison
 * key. Two concepts are candidate duplicates iff their keys are equal.
 *
 * This is deliberately plain string work rather than embeddings. Calibrated
 * against the real 736-concept corpus, these rules found 45 of the 58 merges
 * embeddings found at their only safe threshold, with better precision and
 * better recall on plurals — and no API call, extension, or tunable number.
 * See docs/superpowers/specs/2026-08-06-concept-dedup-design.md, "Evidence".
 *
 * The key is never shown to a user and is never a display name: the crude
 * singulariser mangles words ("analysis" -> "analysi"), which is harmless for
 * comparison because both sides mangle identically.
 */

/**
 * Dropped before comparison, so "nucleus of the atom" and "the nucleus of the
 * atom" agree. Kept deliberately short — every word removed here is a word
 * that can no longer distinguish two concepts.
 */
const STOPWORDS = new Set([
  "the", "of", "and", "a", "an", "for", "to", "in",
  "on", "its", "it", "from", "with", "between", "by",
]);

/**
 * Crude on purpose. It only has to be *consistent*, not linguistically
 * correct, because it is applied to both sides of every comparison.
 */
function singularise(word: string): string {
  if (word.length > 4 && word.endsWith("ies")) return `${word.slice(0, -3)}y`;
  if (word.endsWith("ses") || word.endsWith("xes")) return word.slice(0, -2);
  if (word.length > 3 && word.endsWith("s") && !word.endsWith("ss")) {
    return word.slice(0, -1);
  }
  return word;
}

export function normalisedKey(name: string): string {
  const tokens = name
    .toLowerCase()
    // Curly and back quotes are a real source of duplicates: the extraction
    // model emits both "coulomb's law" and "coulomb’s law".
    .replace(/[’‘`]/g, "'")
    .replace(/'s\b/g, "")
    .replace(/'/g, "")
    .replace(/[^a-z0-9 ]+/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 0 && !STOPWORDS.has(word))
    .map(singularise)
    // behaviour -> behavior, colour -> color.
    .map((word) => word.replace(/our$/, "or"));

  // Sorting is what makes "Inverse Matrix" and "Matrix Inverse" agree.
  // De-duplicating means a repeated word cannot distinguish two names.
  return [...new Set(tokens)].sort().join(" ");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/concepts.normalise.test.ts`
Expected: PASS, 11 tests.

If `"the of and"` returns `""`, that is acceptable — adjust that single assertion to `expect(normalisedKey("the of and")).toBe("")` and add a comment that an all-stopword name yields an empty key which `clusterConcepts` (Task 3) must exclude. Do not add stopwords back to fix it.

- [ ] **Step 5: Commit**

```bash
git add lib/concepts/normalise.ts tests/concepts.normalise.test.ts
git commit -m "feat(concepts): add normalised-key duplicate detection

The whole of detection: a pure name -> comparison key function. Calibrated
against the real corpus; see the design doc's Evidence section for why this
beats embeddings here."
```

---

### Task 2: Schema — tombstone pointer and rejections table

**Files:**
- Modify: `lib/db/schema.ts` (the `concepts` table, ~line 524)
- Create: `lib/db/migrations/000N_*.sql` (generated)

**Interfaces:**
- Produces: `concepts.mergedIntoId`, `conceptMergeRejections` table export.

- [ ] **Step 1: Add the column and table to the schema**

In `lib/db/schema.ts`, add `AnyPgColumn` to the existing `drizzle-orm/pg-core` import (the self-reference needs it), and `check` if it is exported by this Drizzle version:

```ts
import type { AnyPgColumn } from "drizzle-orm/pg-core";
```

Add to the `concepts` table definition, after `description`:

```ts
    // Set when this concept was merged into another by its tutor. The row is
    // soft-deleted at the same time, so it leaves concepts_tutor_name_live_uidx
    // (partial on deleted_at is null) and cannot collide with it.
    //
    // Load-bearing for re-extraction: that unique index is partial, so a plain
    // soft-delete would let a later syllabus emitting the old name create a
    // fresh row and re-propose the identical merge forever. conceptIdFor
    // follows this pointer instead. Merges repoint existing tombstones at the
    // new survivor, so a chain is always exactly one hop.
    mergedIntoId: uuid("merged_into_id").references(
      (): AnyPgColumn => concepts.id,
      { onDelete: "set null" },
    ),
```

Then add the new table immediately after `topicConcepts`:

```ts
/* -------------------------------------------------------------------------- */
/* concept_merge_rejections — "these are not duplicates", remembered forever.   */
/* Pairwise, not per-cluster: clusters have no stable identity, and a group     */
/* rejection would also suppress a concept that joins the group later.          */
/* -------------------------------------------------------------------------- */

export const conceptMergeRejections = pgTable(
  "concept_merge_rejections",
  {
    tutorId: uuid("tutor_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    conceptAId: uuid("concept_a_id")
      .notNull()
      .references(() => concepts.id, { onDelete: "cascade" }),
    conceptBId: uuid("concept_b_id")
      .notNull()
      .references(() => concepts.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.conceptAId, t.conceptBId] }),
    index("concept_merge_rejections_tutor_id_idx").on(t.tutorId),
  ],
);
```

- [ ] **Step 2: Generate the migration**

Run: `pnpm db:generate`
Expected: a new file in `lib/db/migrations/`.

- [ ] **Step 3: Add the CHECK constraint to the generated migration by hand**

Canonical pair ordering (`a < b`) is what makes a pair storable exactly once and un-insertable in reverse. Open the generated `.sql` and append:

```sql
--> statement-breakpoint
ALTER TABLE "concept_merge_rejections"
  ADD CONSTRAINT "concept_merge_rejections_ordered"
  CHECK ("concept_a_id" < "concept_b_id");
```

- [ ] **Step 4: Apply and verify**

```bash
pnpm db:migrate
docker exec supabase_db_dolphin psql -U postgres -d postgres \
  -c "\d concept_merge_rejections" -c "\d concepts"
```

Expected: `concept_merge_rejections` exists with the check constraint; `concepts` has `merged_into_id`.

- [ ] **Step 5: Verify nothing else broke**

Run: `pnpm typecheck && pnpm test`
Expected: all existing tests pass unchanged.

- [ ] **Step 6: Commit**

```bash
git add lib/db/schema.ts lib/db/migrations/
git commit -m "feat(db): add concepts.merged_into_id and concept_merge_rejections

Tombstone pointer so a merge survives re-extraction, and pairwise rejections
so a declined cluster is never re-proposed."
```

---

### Task 3: Clustering

**Files:**
- Create: `lib/concepts/cluster.ts`
- Test: `tests/concepts.cluster.test.ts`

**Interfaces:**
- Consumes: `normalisedKey` from Task 1.
- Produces:
  - `pairKey(a: string, b: string): string`
  - `type ConceptCluster = { key: string; concepts: ClusterableConcept[] }`
  - `type ClusterableConcept = { id: string; name: string }`
  - `clusterConcepts(concepts: ClusterableConcept[], rejectedPairs: ReadonlySet<string>): ConceptCluster[]`

- [ ] **Step 1: Write the failing test**

Create `tests/concepts.cluster.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { clusterConcepts, pairKey } from "@/lib/concepts/cluster";

const c = (id: string, name: string) => ({ id, name });
const NONE = new Set<string>();

describe("pairKey", () => {
  it("is order independent", () => {
    expect(pairKey("b", "a")).toBe(pairKey("a", "b"));
  });
});

describe("clusterConcepts", () => {
  it("groups concepts sharing a normalised key", () => {
    const clusters = clusterConcepts(
      [c("1", "alcohol"), c("2", "alcohols"), c("3", "nitrate")],
      NONE,
    );
    expect(clusters).toHaveLength(1);
    expect(clusters[0].concepts.map((x) => x.id).sort()).toEqual(["1", "2"]);
  });

  it("drops groups of one", () => {
    expect(clusterConcepts([c("1", "nitrate"), c("2", "nitrite")], NONE))
      .toHaveLength(0);
  });

  it("hides a cluster whose every pair is rejected", () => {
    const rejected = new Set([pairKey("1", "2")]);
    expect(clusterConcepts([c("1", "alcohol"), c("2", "alcohols")], rejected))
      .toHaveLength(0);
  });

  it("still shows a cluster with one unrejected pair", () => {
    // 1 and 2 were rejected, but 3 has just arrived and was never ruled on.
    const rejected = new Set([pairKey("1", "2")]);
    const clusters = clusterConcepts(
      [c("1", "alcohol"), c("2", "alcohols"), c("3", "Alcohols")],
      rejected,
    );
    expect(clusters).toHaveLength(1);
    expect(clusters[0].concepts).toHaveLength(3);
  });

  it("excludes concepts whose key is empty", () => {
    expect(clusterConcepts([c("1", "the of"), c("2", "and a")], NONE))
      .toHaveLength(0);
  });

  it("orders clusters largest first", () => {
    const clusters = clusterConcepts(
      [
        c("1", "alcohol"), c("2", "alcohols"), c("3", "Alcohol"),
        c("4", "rate constant"), c("5", "rate constants"),
      ],
      NONE,
    );
    expect(clusters[0].concepts).toHaveLength(3);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/concepts.cluster.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `lib/concepts/cluster.ts`:

```ts
import { normalisedKey } from "./normalise";

export type ClusterableConcept = { id: string; name: string };
export type ConceptCluster = { key: string; concepts: ClusterableConcept[] };

/**
 * Canonical identifier for an unordered pair, matching the
 * CHECK (concept_a_id < concept_b_id) on concept_merge_rejections. Both sides
 * must agree or a stored rejection will never match the pair it describes.
 */
export function pairKey(a: string, b: string): string {
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}

/**
 * Derived on every read — deliberately not stored. A stored candidate goes
 * stale the moment a neighbouring merge changes group membership, and the
 * invalidation logic that would fix that is exactly the thing most likely to
 * be subtly wrong.
 *
 * Grouping is by *equal* key rather than by similarity, so it is transitive
 * and needs no connected-components pass.
 */
export function clusterConcepts(
  concepts: ClusterableConcept[],
  rejectedPairs: ReadonlySet<string>,
): ConceptCluster[] {
  const groups = new Map<string, ClusterableConcept[]>();
  for (const concept of concepts) {
    const key = normalisedKey(concept.name);
    // A name made only of stopwords normalises to nothing and would otherwise
    // pull every such concept into one meaningless cluster.
    if (key === "") continue;
    groups.set(key, [...(groups.get(key) ?? []), concept]);
  }

  const clusters: ConceptCluster[] = [];
  for (const [key, members] of groups) {
    if (members.length < 2) continue;

    // Shown while any pair remains unjudged, so a concept joining a
    // previously-rejected group re-surfaces it rather than inheriting a
    // decision the tutor never made about it.
    const hasUnrejectedPair = members.some((a, i) =>
      members.slice(i + 1).some((b) => !rejectedPairs.has(pairKey(a.id, b.id))),
    );
    if (!hasUnrejectedPair) continue;

    clusters.push({ key, concepts: members });
  }

  return clusters.sort((a, b) => b.concepts.length - a.concepts.length);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/concepts.cluster.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/concepts/cluster.ts tests/concepts.cluster.test.ts
git commit -m "feat(concepts): derive duplicate clusters from normalised keys

Grouping by equal key is transitive, so no connected-components pass is
needed. Rejections are pairwise so a new group member re-surfaces the cluster."
```

---

### Task 4: Queries and authorization

**Files:**
- Create: `lib/db/queries/concepts.ts`
- Modify: `lib/auth/authz.ts` (append after `assertSyllabusOwner`, ~line 120)

**Interfaces:**
- Consumes: `clusterConcepts`, `pairKey` from Task 3.
- Produces:
  - `assertConceptsOwned(userId: string, conceptIds: string[]): Promise<void>`
  - `listRejectedPairKeysForTutor(userId: string): Promise<Set<string>>`
  - `listConceptClustersForTutor(userId: string): Promise<ConceptCluster[]>`

- [ ] **Step 1: Write the authorization helper**

Append to `lib/auth/authz.ts` (it already imports `and`, `eq`, `inArray`, `isNull`, `db`; add `concepts` to the schema import and `inArray` if absent):

```ts
/**
 * Concepts are tutor-owned with no class relationship, so the only question is
 * ownership — the same shape as assertSyllabusOwner.
 *
 * Takes the whole set at once on purpose. A merge receives a survivor id and
 * several loser ids from the client, and checking only the survivor would let a
 * caller fold another tutor's concepts into their own.
 */
export async function assertConceptsOwned(
  userId: string,
  conceptIds: string[],
): Promise<void> {
  if (conceptIds.length === 0) throw new AuthzError();
  const unique = [...new Set(conceptIds)];

  const rows = await db
    .select({ id: concepts.id })
    .from(concepts)
    .where(
      and(
        inArray(concepts.id, unique),
        eq(concepts.tutorId, userId),
        isNull(concepts.deletedAt),
      ),
    );

  // Any shortfall is a failure, and we never say which id was the problem.
  if (rows.length !== unique.length) throw new AuthzError();
}
```

- [ ] **Step 2: Write the queries**

Create `lib/db/queries/concepts.ts`:

```ts
import { and, asc, eq, isNull, or } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { conceptMergeRejections, concepts } from "@/lib/db/schema";
import { clusterConcepts, pairKey, type ConceptCluster } from "@/lib/concepts/cluster";

/**
 * Every read here is gated on tutor ownership. A concept has no class and no
 * "enrolled" relationship, so there is only "owner" or nothing.
 */

/** Pair keys this tutor has already ruled "not duplicates". */
export async function listRejectedPairKeysForTutor(
  userId: string,
): Promise<Set<string>> {
  const rows = await db
    .select({
      a: conceptMergeRejections.conceptAId,
      b: conceptMergeRejections.conceptBId,
    })
    .from(conceptMergeRejections)
    .where(eq(conceptMergeRejections.tutorId, userId));

  return new Set(rows.map((r) => pairKey(r.a, r.b)));
}

/**
 * Duplicate clusters awaiting this tutor's decision.
 *
 * Deliberately reads the concepts it needs directly rather than adding a
 * similarity query: detection is a pure function over rows we already have, so
 * there is no index, no threshold, and nothing to keep in sync.
 */
export async function listConceptClustersForTutor(
  userId: string,
): Promise<ConceptCluster[]> {
  const [rows, rejected] = await Promise.all([
    db
      .select({ id: concepts.id, name: concepts.name })
      .from(concepts)
      .where(and(eq(concepts.tutorId, userId), isNull(concepts.deletedAt)))
      .orderBy(asc(concepts.name)),
    listRejectedPairKeysForTutor(userId),
  ]);

  return clusterConcepts(rows, rejected);
}

/** How many topics each of the given concepts is linked to, for the review UI. */
export async function countTopicsForConcepts(
  userId: string,
  conceptIds: string[],
): Promise<Map<string, number>> {
  if (conceptIds.length === 0) return new Map();

  const { topicConcepts } = await import("@/lib/db/schema");
  const { inArray, sql } = await import("drizzle-orm");

  const rows = await db
    .select({
      conceptId: topicConcepts.conceptId,
      count: sql<number>`count(*)::int`,
    })
    .from(topicConcepts)
    .innerJoin(concepts, eq(concepts.id, topicConcepts.conceptId))
    .where(
      and(
        inArray(topicConcepts.conceptId, conceptIds),
        eq(concepts.tutorId, userId),
      ),
    )
    .groupBy(topicConcepts.conceptId);

  return new Map(rows.map((r) => [r.conceptId, r.count]));
}
```

Move the two dynamic `import()` calls in `countTopicsForConcepts` to static top-of-file imports — they are written inline above only to keep this task's diff readable. Static imports are the codebase convention.

- [ ] **Step 3: Verify it compiles**

Run: `pnpm typecheck`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add lib/db/queries/concepts.ts lib/auth/authz.ts
git commit -m "feat(concepts): add cluster queries and assertConceptsOwned

assertConceptsOwned takes the whole id set at once: checking only the merge
survivor would let a caller fold another tutor's concepts into their own."
```

---

### Task 5: Merge and reject actions

**Files:**
- Create: `lib/validation/concept.ts`
- Create: `app/(tutor)/concepts/actions.ts`
- Test: `tests/authz.concept.test.ts`

**Interfaces:**
- Consumes: `assertConceptsOwned` (Task 4), `pairKey` (Task 3), `conceptMergeRejections` (Task 2).
- Produces: `mergeConcepts`, `rejectCluster` — both `(prev: FormState, formData: FormData) => Promise<FormState>`.

- [ ] **Step 1: Write the validation schemas**

Create `lib/validation/concept.ts`:

```ts
import { z } from "zod";

export const mergeConceptsSchema = z
  .object({
    survivorId: z.string().uuid("Invalid concept"),
    loserIds: z.array(z.string().uuid("Invalid concept")).min(1, "Nothing to merge"),
  })
  .refine((v) => !v.loserIds.includes(v.survivorId), {
    message: "A concept cannot be merged into itself",
  });

export const rejectClusterSchema = z.object({
  conceptIds: z
    .array(z.string().uuid("Invalid concept"))
    .min(2, "A cluster needs at least two concepts"),
});

export type MergeConceptsInput = z.infer<typeof mergeConceptsSchema>;
export type RejectClusterInput = z.infer<typeof rejectClusterSchema>;
```

- [ ] **Step 2: Write the failing authorization test**

Create `tests/authz.concept.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { concepts } from "@/lib/db/schema";
import { assertConceptsOwned } from "@/lib/auth/authz";
import { AuthzError } from "@/lib/auth/authz";
import { listConceptClustersForTutor } from "@/lib/db/queries/concepts";
import { createTestUser, deleteTestUser, type TestUser } from "./helpers/seed";

/**
 * Concepts are tutor-global and have no class relationship, so ownership is
 * the only gate. These prove the negatives.
 */
describe("concept authorization", () => {
  let tutorA: TestUser;
  let tutorB: TestUser;
  let conceptA1: string;
  let conceptA2: string;
  let conceptB1: string;

  beforeAll(async () => {
    tutorA = await createTestUser("concept-tutor-a", "tutor");
    tutorB = await createTestUser("concept-tutor-b", "tutor");

    const inserted = await db
      .insert(concepts)
      .values([
        { tutorId: tutorA.id, name: "alcohol" },
        { tutorId: tutorA.id, name: "alcohols" },
        { tutorId: tutorB.id, name: "alcohol" },
      ])
      .returning({ id: concepts.id, tutorId: concepts.tutorId, name: concepts.name });

    conceptA1 = inserted.find((c) => c.tutorId === tutorA.id && c.name === "alcohol")!.id;
    conceptA2 = inserted.find((c) => c.tutorId === tutorA.id && c.name === "alcohols")!.id;
    conceptB1 = inserted.find((c) => c.tutorId === tutorB.id)!.id;
  });

  afterAll(async () => {
    await db.delete(concepts).where(eq(concepts.tutorId, tutorA.id));
    await db.delete(concepts).where(eq(concepts.tutorId, tutorB.id));
    await deleteTestUser(tutorA);
    await deleteTestUser(tutorB);
  });

  it("allows a tutor their own concepts", async () => {
    await expect(
      assertConceptsOwned(tutorA.id, [conceptA1, conceptA2]),
    ).resolves.toBeUndefined();
  });

  it("refuses another tutor's concept", async () => {
    await expect(assertConceptsOwned(tutorB.id, [conceptA1])).rejects.toThrow(AuthzError);
  });

  it("refuses a mixed-ownership set", async () => {
    // The critical case: a valid own-id must not launder an id belonging to
    // someone else through the same call.
    await expect(
      assertConceptsOwned(tutorB.id, [conceptB1, conceptA1]),
    ).rejects.toThrow(AuthzError);
  });

  it("refuses an empty set", async () => {
    await expect(assertConceptsOwned(tutorA.id, [])).rejects.toThrow(AuthzError);
  });

  it("refuses a soft-deleted concept", async () => {
    await db
      .update(concepts)
      .set({ deletedAt: new Date() })
      .where(eq(concepts.id, conceptA2));
    await expect(
      assertConceptsOwned(tutorA.id, [conceptA2]),
    ).rejects.toThrow(AuthzError);
    await db
      .update(concepts)
      .set({ deletedAt: null })
      .where(eq(concepts.id, conceptA2));
  });

  it("never surfaces another tutor's concepts in clusters", async () => {
    const clusters = await listConceptClustersForTutor(tutorB.id);
    const ids = clusters.flatMap((c) => c.concepts.map((x) => x.id));
    expect(ids).not.toContain(conceptA1);
    expect(ids).not.toContain(conceptA2);
  });

  it("clusters a tutor's own duplicate names", async () => {
    const clusters = await listConceptClustersForTutor(tutorA.id);
    expect(clusters.some((c) => c.concepts.length === 2)).toBe(true);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm vitest run tests/authz.concept.test.ts`
Expected: FAIL — `assertConceptsOwned` exists from Task 4, so failures should only be from `listConceptClustersForTutor` if Task 4 was skipped. If Task 4 is complete, this may already pass; that is fine, it is the regression guard.

- [ ] **Step 4: Write the actions**

Create `app/(tutor)/concepts/actions.ts`:

```ts
"use server";

import { revalidatePath } from "next/cache";
import { eq, or } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { conceptMergeRejections, concepts, topicConcepts } from "@/lib/db/schema";
import { requireAuthUser } from "@/lib/auth/session";
import { assertConceptsOwned, AuthzError } from "@/lib/auth/authz";
import { recordEvent } from "@/lib/db/events";
import { mergeConceptsSchema, rejectClusterSchema } from "@/lib/validation/concept";
import type { FormState } from "@/lib/types";

/**
 * Merging is the only destructive operation on a tutor's vocabulary, so both
 * actions here authorize the ENTIRE id set before touching anything — a
 * survivor id the caller legitimately owns must not launder loser ids they do
 * not.
 */

export async function mergeConcepts(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = mergeConceptsSchema.safeParse({
    survivorId: formData.get("survivorId"),
    loserIds: formData.getAll("loserIds"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const { survivorId, loserIds } = parsed.data;

  const user = await requireAuthUser();
  try {
    await assertConceptsOwned(user.id, [survivorId, ...loserIds]);
  } catch (e) {
    if (e instanceof AuthzError) return { error: "Not authorized" };
    throw e;
  }

  await db.transaction(async (tx) => {
    for (const loserId of loserIds) {
      // Repoint topic links. onConflictDoNothing because a topic may already
      // link to both concepts, and the composite PK would reject the duplicate.
      const links = await tx
        .select({ topicId: topicConcepts.topicId })
        .from(topicConcepts)
        .where(eq(topicConcepts.conceptId, loserId));
      for (const link of links) {
        await tx
          .insert(topicConcepts)
          .values({ topicId: link.topicId, conceptId: survivorId })
          .onConflictDoNothing();
      }
      await tx.delete(topicConcepts).where(eq(topicConcepts.conceptId, loserId));

      // Tombstone. Soft-deleting drops the row out of
      // concepts_tutor_name_live_uidx, which is partial on deleted_at is null,
      // so this can never collide with the survivor's name.
      await tx
        .update(concepts)
        .set({ deletedAt: new Date(), mergedIntoId: survivorId, updatedAt: new Date() })
        .where(eq(concepts.id, loserId));

      // Any tombstone already pointing at this loser now points at the
      // survivor, so resolution is always exactly one hop and needs no loop
      // guard. Must run after the update above, which is what stops the loser
      // matching its own predicate.
      await tx
        .update(concepts)
        .set({ mergedIntoId: survivorId })
        .where(eq(concepts.mergedIntoId, loserId));

      // Rejections naming a now-dead row would accumulate forever.
      await tx
        .delete(conceptMergeRejections)
        .where(
          or(
            eq(conceptMergeRejections.conceptAId, loserId),
            eq(conceptMergeRejections.conceptBId, loserId),
          ),
        );
    }

    await recordEvent(
      {
        actorId: user.id,
        verb: "concept.merged",
        subjectType: "concept",
        subjectId: survivorId,
        payload: { mergedConceptIds: loserIds },
      },
      tx,
    );
  });

  revalidatePath("/concepts");
  return { ok: true };
}

export async function rejectCluster(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = rejectClusterSchema.safeParse({
    conceptIds: formData.getAll("conceptIds"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const conceptIds = [...new Set(parsed.data.conceptIds)];

  const user = await requireAuthUser();
  try {
    await assertConceptsOwned(user.id, conceptIds);
  } catch (e) {
    if (e instanceof AuthzError) return { error: "Not authorized" };
    throw e;
  }

  // Every pair in the cluster, stored in the canonical order the table's
  // CHECK (concept_a_id < concept_b_id) requires.
  const rows: { tutorId: string; conceptAId: string; conceptBId: string }[] = [];
  for (let i = 0; i < conceptIds.length; i++) {
    for (let j = i + 1; j < conceptIds.length; j++) {
      const [a, b] = [conceptIds[i], conceptIds[j]].sort();
      rows.push({ tutorId: user.id, conceptAId: a, conceptBId: b });
    }
  }

  await db.insert(conceptMergeRejections).values(rows).onConflictDoNothing();

  revalidatePath("/concepts");
  return { ok: true };
}
```

- [ ] **Step 5: Run the full suite**

Run: `pnpm typecheck && pnpm test`
Expected: all pass, including the 7 new concept authorization tests.

- [ ] **Step 6: Commit**

```bash
git add lib/validation/concept.ts "app/(tutor)/concepts/actions.ts" tests/authz.concept.test.ts
git commit -m "feat(concepts): add merge and reject-cluster actions

Both authorize the entire id set before mutating. Merging tombstones the
losers, repoints topic links and any pre-existing tombstones, and drops
rejections naming dead rows."
```

---

### Task 6: Worker follows tombstones, and the race fix

**Files:**
- Modify: `worker/process-syllabus-extraction.ts` (`conceptIdFor`, ~lines 138–166)

**Interfaces:**
- Consumes: `concepts.mergedIntoId` (Task 2).
- Produces: nothing new — behaviour change only.

- [ ] **Step 1: Replace `conceptIdFor`**

Replace the whole inner `conceptIdFor` function with:

```ts
      const conceptIdByName = new Map<string, string>();
      async function conceptIdFor(
        name: string,
        description?: string,
      ): Promise<string> {
        const key = name.toLowerCase();
        const cached = conceptIdByName.get(key);
        if (cached) return cached;

        // 1. A live concept under this name. Matched case-insensitively
        // because concepts_tutor_name_live_uidx is on (tutor_id, lower(name)) —
        // a case-sensitive lookup misses a row differing only in case and then
        // collides with that index on insert.
        const [live] = await tx
          .select({ id: concepts.id })
          .from(concepts)
          .where(
            and(
              eq(concepts.tutorId, syllabus.tutorId),
              sql`lower(${concepts.name}) = ${key}`,
              isNull(concepts.deletedAt),
            ),
          )
          .limit(1);
        if (live) {
          conceptIdByName.set(key, live.id);
          return live.id;
        }

        // 2. A tombstone: this name was merged away by the tutor. Follow the
        // pointer instead of recreating the row.
        //
        // Load-bearing. concepts_tutor_name_live_uidx is PARTIAL on
        // "deleted_at is null", so without this a merged-away name has no live
        // row, gets recreated here, and the tutor is proposed the identical
        // merge after every future upload. Merges repoint tombstones at the new
        // survivor, so this is always one hop — no loop needed.
        const [tombstone] = await tx
          .select({ mergedIntoId: concepts.mergedIntoId })
          .from(concepts)
          .where(
            and(
              eq(concepts.tutorId, syllabus.tutorId),
              sql`lower(${concepts.name}) = ${key}`,
              isNotNull(concepts.deletedAt),
              isNotNull(concepts.mergedIntoId),
            ),
          )
          .orderBy(desc(concepts.updatedAt))
          .limit(1);
        if (tombstone?.mergedIntoId) {
          conceptIdByName.set(key, tombstone.mergedIntoId);
          return tombstone.mergedIntoId;
        }

        // 3. Create. onConflictDoNothing + re-select rather than a bare insert:
        // the worker runs concurrency 2, so two jobs for one tutor can both
        // miss the select above and collide on the unique index (23505), which
        // aborts the whole transaction and fails a job that has already paid
        // for every Gemini call in the document.
        const [created] = await tx
          .insert(concepts)
          .values({
            tutorId: syllabus.tutorId,
            name,
            description: description ?? null,
          })
          .onConflictDoNothing()
          .returning({ id: concepts.id });

        if (created) {
          conceptIdByName.set(key, created.id);
          return created.id;
        }

        const [raced] = await tx
          .select({ id: concepts.id })
          .from(concepts)
          .where(
            and(
              eq(concepts.tutorId, syllabus.tutorId),
              sql`lower(${concepts.name}) = ${key}`,
              isNull(concepts.deletedAt),
            ),
          )
          .limit(1);
        if (!raced) throw new Error(`Could not resolve concept "${name}"`);
        conceptIdByName.set(key, raced.id);
        return raced.id;
      }
```

- [ ] **Step 2: Pass the description through**

At the call site (~line 219), change:

```ts
          const conceptId = await conceptIdFor(extractedConcept.name);
```

to:

```ts
          const conceptId = await conceptIdFor(
            extractedConcept.name,
            extractedConcept.description,
          );
```

This closes finding #7 — Gemini returns and Zod validates a per-concept
description that was being silently discarded, leaving `concepts.description`
NULL on every row.

- [ ] **Step 3: Update the imports**

Add `desc` and `isNotNull` to the existing `drizzle-orm` import at the top of the file:

```ts
import { and, desc, eq, isNotNull, isNull, sql } from "drizzle-orm";
```

- [ ] **Step 4: Verify**

Run: `pnpm typecheck && pnpm test`
Expected: all pass, including the existing `tests/worker.extraction.test.ts`.

- [ ] **Step 5: Commit**

```bash
git add worker/process-syllabus-extraction.ts
git commit -m "fix(worker): follow merge tombstones and close the conceptIdFor race

Three changes to conceptIdFor:
- follows concepts.merged_into_id, so a merged-away name resolves to its
  survivor instead of being recreated and re-proposed forever
- onConflictDoNothing + re-select, closing the concurrency-2 collision on
  concepts_tutor_name_live_uidx that failed whole jobs (status.md finding 3)
- persists the concept description Gemini already returns (finding 7)"
```

---

### Task 7: The Concepts page and cluster review UI

**Files:**
- Create: `app/(tutor)/concepts/page.tsx`
- Create: `components/concept-cluster-review.tsx`
- Modify: the tutor top-bar nav component (find with `grep -rn "Syllabi" components/`)

**Interfaces:**
- Consumes: `listConceptClustersForTutor`, `countTopicsForConcepts` (Task 4); `mergeConcepts`, `rejectCluster` (Task 5).

- [ ] **Step 1: Write the review component**

Create `components/concept-cluster-review.tsx`:

```tsx
"use client";

// Client component: the tutor picks a survivor with radio buttons before
// submitting, which is local state the server cannot hold.

import { useActionState, useState } from "react";
import { mergeConcepts, rejectCluster } from "@/app/(tutor)/concepts/actions";
import { Button } from "@/components/ui/button";
import { PanelRow, RowMeta } from "@/components/ui/panel";

type ClusterConcept = { id: string; name: string; topicCount: number };

export function ConceptClusterReview({
  concepts,
}: {
  concepts: ClusterConcept[];
}) {
  const [survivorId, setSurvivorId] = useState(
    // Default to the most-used name: the one already attached to most topics
    // is the one the tutor has effectively been treating as canonical.
    [...concepts].sort((a, b) => b.topicCount - a.topicCount)[0]?.id ?? "",
  );
  const [mergeState, mergeAction, merging] = useActionState(mergeConcepts, {});
  const [rejectState, rejectAction, rejecting] = useActionState(rejectCluster, {});

  const error = mergeState.error ?? rejectState.error;

  return (
    <PanelRow>
      <div className="flex w-full flex-col gap-3">
        <RowMeta>
          {concepts.length} similar concepts — which name should survive?
        </RowMeta>

        <form action={mergeAction} className="flex flex-col gap-2">
          {concepts.map((concept) => (
            <label key={concept.id} className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="survivorId"
                value={concept.id}
                checked={survivorId === concept.id}
                onChange={() => setSurvivorId(concept.id)}
              />
              <span>{concept.name}</span>
              <span className="text-faint">
                {concept.topicCount} {concept.topicCount === 1 ? "topic" : "topics"}
              </span>
            </label>
          ))}

          {concepts
            .filter((c) => c.id !== survivorId)
            .map((c) => (
              <input key={c.id} type="hidden" name="loserIds" value={c.id} />
            ))}

          <div className="flex items-center gap-2">
            <Button type="submit" size="sm" disabled={merging || rejecting}>
              {merging ? "Merging…" : "Merge into this name"}
            </Button>
          </div>
        </form>

        <form action={rejectAction}>
          {concepts.map((c) => (
            <input key={c.id} type="hidden" name="conceptIds" value={c.id} />
          ))}
          <Button
            type="submit"
            variant="ghost"
            size="sm"
            disabled={merging || rejecting}
          >
            {rejecting ? "Saving…" : "Not duplicates — keep all"}
          </Button>
        </form>

        {error && <p className="text-sm text-destructive">{error}</p>}
      </div>
    </PanelRow>
  );
}
```

Merging is **not reversible in the UI**. If a confirmation dialog is added, use the existing `ConfirmButton` and say so plainly — do not imply an undo exists.

- [ ] **Step 2: Write the page**

Create `app/(tutor)/concepts/page.tsx`:

```tsx
import { requireAuthUser } from "@/lib/auth/session";
import {
  countTopicsForConcepts,
  listConceptClustersForTutor,
} from "@/lib/db/queries/concepts";
import { listConceptsForTutor } from "@/lib/db/queries/syllabuses";
import { Page, PageHeader } from "@/components/page";
import { Panel, PanelRow, RowMeta } from "@/components/ui/panel";
import { Section, SectionLabel } from "@/components/ui/section";
import { ConceptClusterReview } from "@/components/concept-cluster-review";

export default async function ConceptsPage() {
  const user = await requireAuthUser();

  const [all, clusters] = await Promise.all([
    listConceptsForTutor(user.id),
    listConceptClustersForTutor(user.id),
  ]);

  const topicCounts = await countTopicsForConcepts(
    user.id,
    clusters.flatMap((c) => c.concepts.map((x) => x.id)),
  );

  return (
    <Page>
      <PageHeader
        title="Concepts"
        sub={
          <span className="text-sm text-muted-foreground">
            {all.length} concepts
            {clusters.length > 0 && ` · ${clusters.length} to review`}
          </span>
        }
      />

      {clusters.length > 0 && (
        <Section aria-label="Possible duplicates">
          <SectionLabel>Possible duplicates</SectionLabel>
          <Panel>
            {clusters.map((cluster) => (
              <ConceptClusterReview
                key={cluster.key}
                concepts={cluster.concepts.map((c) => ({
                  ...c,
                  topicCount: topicCounts.get(c.id) ?? 0,
                }))}
              />
            ))}
          </Panel>
        </Section>
      )}

      <Section aria-label="All concepts">
        <SectionLabel>All concepts</SectionLabel>
        <Panel>
          {all.length === 0 ? (
            <PanelRow>
              <RowMeta>
                No concepts yet — they appear as you build syllabuses.
              </RowMeta>
            </PanelRow>
          ) : (
            all.map((concept) => (
              <PanelRow key={concept.id}>
                <span className="text-sm">{concept.name}</span>
              </PanelRow>
            ))
          )}
        </Panel>
      </Section>
    </Page>
  );
}
```

- [ ] **Step 3: Add the nav entry**

Find the tutor top-bar (`grep -rn "Syllabi" components/`) and add a `Concepts` link to `/concepts` beside it, matching the existing markup exactly.

- [ ] **Step 4: Verify**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: all pass.

Then ask the user to check `/concepts` in their running dev server — **do not start or restart it yourself.**

- [ ] **Step 5: Commit**

```bash
git add "app/(tutor)/concepts" components/concept-cluster-review.tsx components/
git commit -m "feat(concepts): add Concepts destination with cluster review

Cross-syllabus clusters have no single syllabus to belong to, so review lives
in its own top-level destination. Survivor defaults to the most-linked name."
```

---

### Task 8: Syllabus page banner

**Files:**
- Modify: `app/(tutor)/syllabi/[syllabusId]/page.tsx` (after the extraction-status block, ~line 114)

- [ ] **Step 1: Add the banner**

In `app/(tutor)/syllabi/[syllabusId]/page.tsx`, add to the existing `Promise.all` (~line 48):

```ts
  const [topics, allConcepts, clusters] = await Promise.all([
    listTopicsForSyllabus(user.id, syllabusId),
    listConceptsForTutor(user.id),
    listConceptClustersForTutor(user.id),
  ]);
```

Import it:

```ts
import { listConceptClustersForTutor } from "@/lib/db/queries/concepts";
```

Then insert after the extraction-status block, before `<Section aria-label="Topics">`:

```tsx
      {clusters.length > 0 && (
        <div className="flex items-center gap-3 rounded-lg border bg-card px-4 py-3">
          <span className="text-sm text-muted-foreground">
            {clusters.length} {clusters.length === 1 ? "group" : "groups"} of
            your concepts look like duplicates.
          </span>
          <Link
            href="/concepts"
            className="ml-auto text-sm font-medium text-primary underline underline-offset-2"
          >
            Review
          </Link>
        </div>
      )}
```

Add `import Link from "next/link";` if absent.

The banner never blocks the topics list: extraction always produces a complete, usable syllabus and review is optional cleanup.

- [ ] **Step 2: Verify**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: all pass.

- [ ] **Step 3: Commit**

```bash
git add "app/(tutor)/syllabi/[syllabusId]/page.tsx"
git commit -m "feat(syllabi): link to concept review when duplicates exist"
```

---

### Task 9: Documentation

**Files:**
- Modify: `CLAUDE.md`, `docs/status.md`, `docs/erd.txt`

- [ ] **Step 1: CLAUDE.md**

Add a "Concept deduplication" section after "Syllabus extraction". Cover: detection is `lib/concepts/normalise.ts` and is plain string work by *measurement*, not oversight; the write path deliberately keeps exact matching so nothing merges without the tutor; `merged_into_id` exists because the unique index is partial; rejections are pairwise because clusters have no stable identity. Link the spec's Evidence section.

Add **Cluster** and **Tombstone** to the vocabulary table.

- [ ] **Step 2: docs/status.md**

Add the checkpoint. Mark findings **#3 resolved** and **#7 resolved**. Retire the "No Syllabi tab UI" known gap — it was already stale before this work.

- [ ] **Step 3: docs/erd.txt**

Add `merged_into_id` to the `concepts` block and the new `concept_merge_rejections` table.

- [ ] **Step 4: Final verification**

```bash
pnpm typecheck && pnpm lint && pnpm test
```

Expected: all green. Report the actual test count.

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md docs/
git commit -m "docs: record concept deduplication and close findings 3 and 7"
```

---

## Self-review notes

- Spec sections without a task, by design: the pgvector schema, backfill script, and threshold calibration — all removed when embeddings were dropped. "Undo" is deliberately unbuilt (spec: "v1 ships no undo UI").
- `pairKey` (Task 3) and the `[a, b].sort()` in `rejectCluster` (Task 5) must produce the same ordering as the table's `CHECK (concept_a_id < concept_b_id)`. All three use plain string `<`.
- `ConceptCluster.concepts` is `{ id, name }`; the UI adds `topicCount` at the page level. The review component's prop type is `ClusterConcept`, deliberately a different, wider type.
