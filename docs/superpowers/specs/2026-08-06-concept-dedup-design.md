# Embedding-based concept deduplication — design

Date: 2026-08-06
Status: approved design, not yet implemented

## Problem

`concepts` are tutor-global and persist across every syllabus a tutor uploads.
The only deduplication today is exact-string: `conceptIdFor` in
`worker/process-syllabus-extraction.ts` looks up `lower(name)` and reuses a live
row, backed by the partial unique index `concepts_tutor_name_live_uidx` on
`(tutor_id, lower(name)) where deleted_at is null`.

`BASE_PROMPT`'s NAMING rules push hard to make that exact match succeed —
lowercase everything, strip numbering, strip articles, don't pluralise, don't
translate. That is normalisation-as-prompt-engineering, and it cannot reach
synonymy. `"the quadratic formula"` collapses into `"quadratic formula"` today.
`"differentiating composite functions"` and `"chain rule"` do not, and never
will by string comparison.

The local corpus is 736 live concepts across 6 syllabuses and 162 topics. Every
further upload adds more near-duplicates.

**Goal: a clean, navigable vocabulary.** This is a curation feature, judged by
whether the tutor's concept list is usable as a picker — not by whether later
analytics aggregate correctly. Correct aggregation is a welcome side effect, not
the acceptance criterion.

## Scope

**In:** embedding concept names, detecting duplicate clusters, a tutor review
surface, merging with a reversible tombstone, and a one-off backfill of existing
concepts.

**Out:** auto-merging without tutor confirmation; embedding anything other than
concept names; analytics; the question bank; `classes.syllabus_id`. Similarity
ranks candidates. The tutor decides. Nothing merges on its own, ever.

## Decisions

| Decision | Choice | Why |
|---|---|---|
| Goal | Clean vocabulary | Curation, not statistics |
| Coverage | Backfill + forward | An already-messy list must improve, and new concepts need existing vectors to compare against anyway |
| Review unit | Cluster, pick a survivor | Real duplication is 3–4 variants of one idea, not isolated pairs; pairwise votes can contradict each other |
| Academic level | One concept, level derived | `syllabuses.level` already exists; a concept's levels are a join. Zero schema cost, and difficulty belongs on the question |
| Review home | Concepts destination + syllabus banner | Backfill clusters span syllabuses and belong to no single one |
| Embedding input | Name only | One recipe for every vector. The 736 existing rows have no description, so mixing name and name+description would make scores incomparable |
| Merge model | Tombstone `merged_into_id` | Survives re-extraction, gives undo, preserves provenance |
| Cluster storage | Derived on read | Nothing to invalidate |

### Why clusters are derived, not stored

Persist three things: **embeddings**, **tombstones**, **rejected pairs**.
Everything else is a query.

```
clusters = f(live concepts + vectors, rejected pairs)
```

Stored candidate rows would go stale on every merge — merging one cluster
changes the membership of any cluster that overlaps it. That produces confusing
UI rather than loud failures. Deriving removes the invalidation logic entirely,
because there is no cache to be wrong.

### Why rejections are pairwise, not per-cluster

Clusters have no stable identity. "chain rule +3" is a different set after any
merge anywhere near it, so a cluster-level rejection has nothing durable to
attach to. Pairs are stable forever.

"Not duplicates — keep all" on a cluster of N writes N·(N−1)/2 rejection rows.
Derived clustering then excludes those pairs, and the cluster stops appearing.

## Schema diff

Propose before migrating, per the working agreement. Drizzle 0.45.2 exports
`vector` from `drizzle-orm/pg-core` — no new npm dependency. pgvector is a
Postgres extension, enabled in the migration.

```sql
CREATE EXTENSION IF NOT EXISTS vector;

-- 768, not gemini-embedding-001's native 3072: pgvector's HNSW/IVFFlat
-- indexes cap at 2000 dimensions, and measured quality is identical.
ALTER TABLE concepts
  ADD COLUMN embedding vector(768),
  ADD COLUMN merged_into_id uuid REFERENCES concepts(id) ON DELETE SET NULL;

-- Partial: only live concepts are ever searched.
CREATE INDEX concepts_embedding_hnsw_idx
  ON concepts USING hnsw (embedding vector_cosine_ops)
  WHERE deleted_at IS NULL;

CREATE TABLE concept_merge_rejections (
  tutor_id     uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  concept_a_id uuid NOT NULL REFERENCES concepts(id) ON DELETE CASCADE,
  concept_b_id uuid NOT NULL REFERENCES concepts(id) ON DELETE CASCADE,
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (concept_a_id, concept_b_id),
  CHECK (concept_a_id < concept_b_id)
);

CREATE INDEX concept_merge_rejections_tutor_id_idx
  ON concept_merge_rejections (tutor_id);
```

The `CHECK (concept_a_id < concept_b_id)` enforces canonical pair ordering so a
rejected pair is stored exactly once and can never be double-inserted in the
opposite order.

`concepts.description` needs **no schema change** — the column already exists
and is simply never written. See "Finding #7" below.

Migrations are Drizzle's (`pnpm db:generate` / `db:migrate`) against a direct or
session-pooler connection on 5432, never the transaction pooler.

## Architecture

### Write path — extraction (worker)

The flow is **resolve → embed → write**, with all network I/O completed before
the transaction opens, so nothing holds locks across an API call.

```
extract chunks → mergeExtractionResults() → full candidate concept list
  ↓
resolve each name by string (no vectors needed):
     live exact name match      → reuse that row
     tombstone name match       → follow merged_into_id, reuse the winner
     neither                    → genuinely new
  ↓
batch-embed ONLY the genuinely-new names    one API call, outside the TX
  ↓
BEGIN → write topics, concepts (with vectors), topic_concepts → COMMIT
```

Resolving by string first means we never pay to embed a name that was going to
reuse an existing row anyway — on a re-extraction of the same document, that is
every name.

**There is deliberately no vector search on the write path.** Because clusters
are derived on read, a write-time similarity lookup would compute something the
next page read recomputes anyway, and give the flag two places to disagree. The
write path's only job is to store a correct vector. Detection is entirely a read
concern. New concepts are written with their embedding already populated, so the
extraction path needs no follow-up job.

### Write path — manual and preset (Next.js)

`createConcept` and preset-clone run inside the Next app, which **must not**
import `@google/generative-ai` (CLAUDE.md restricts it to `worker/`). These
create the row with a `NULL` embedding and enqueue a `concept-embedding` job on
the existing BullMQ queue; the worker fills it in.

A concept with a `NULL` embedding simply does not participate in clustering
until the job lands. No special-casing beyond `embedding IS NOT NULL`.

### Read path — clustering

`lib/db/queries/concepts.ts` returns similar pairs; grouping into connected
components happens in TypeScript, where it is about ten lines.

```sql
SELECT a.id AS a_id, b.id AS b_id,
       1 - (a.embedding <=> b.embedding) AS similarity
  FROM concepts a
  JOIN concepts b
    ON  b.tutor_id   = a.tutor_id
    AND a.id < b.id                      -- canonical ordering, matches the CHECK
    AND b.deleted_at IS NULL
    AND b.embedding IS NOT NULL
 WHERE a.tutor_id = $1
   AND a.deleted_at IS NULL
   AND a.embedding IS NOT NULL
   AND (a.embedding <=> b.embedding) < $2
   AND NOT EXISTS (
         SELECT 1 FROM concept_merge_rejections r
          WHERE r.concept_a_id = a.id AND r.concept_b_id = b.id
       );
```

**Honest caveat about the index.** The all-pairs self-join above is a filtered
pairwise scan and **will not use the HNSW index** — and since the write path
does no vector search either, nothing in v1 of this feature actually uses it.
At 736 concepts the self-join is ~270k distance computations, which Postgres
does in milliseconds. It is not free at 10k.

The index is included anyway because it is cheap to declare and it is exactly
what the migration path needs: when the all-pairs query gets slow, it is
replaced by a per-concept top-k ANN query in a lateral join, which *does* use
it. Declaring it now avoids an index build on a large table later. If that
justification feels thin at review time, dropping it is a safe call — it can be
added in a one-line migration whenever it's needed.

### Merge

A Server Action in `app/(tutor)/concepts/actions.ts`, following parse → authorize
→ mutate → revalidate.

Given a survivor and N losers, in one transaction:

1. Verify **every** concept id belongs to the calling tutor. A survivor id alone
   does not authorize touching arbitrary loser ids — same rule
   `linkTopicConcept` already applies.
2. Repoint `topic_concepts` from each loser to the survivor, with
   `onConflictDoNothing` (a topic may already link to both).
3. Soft-delete each loser and set `merged_into_id = survivor`.
4. **Repoint existing tombstones** that point at any loser to the survivor, so
   tombstone chains stay exactly one hop deep and resolution never needs a loop
   guard.
5. Delete rejection rows involving the losers — they name rows that are no
   longer live and would otherwise accumulate forever.
6. Write a `concept.merged` event.

Soft-deleting the losers removes them from
`concepts_tutor_name_live_uidx` (it is partial on `deleted_at is null`), so the
merge can never collide with it.

### Undo

Clearing `merged_into_id` and `deleted_at` restores a loser — but its
`topic_concepts` links were repointed and are not recoverable from the tombstone
alone. **v1 ships no undo UI.** The tombstone makes undo *possible* later; it is
not a promise made to the tutor now. The merge dialog says the merge is not
reversible.

## Data flow — the re-extraction loop this closes

The trap: `concepts_tutor_name_live_uidx` is partial. A plain soft-delete leaves
no live row, so a later syllabus emitting the old name creates it fresh and the
tutor is proposed the identical merge again, forever.

```
concepts
  id=A  "chain rule"                  deleted_at=NULL
  id=B  "differentiating composites"  deleted_at=2026-08-06
                                      merged_into_id=A

later extraction emits "differentiating composites"
  → no live row
  → tombstone B found by name
  → follow merged_into_id → A
  → reuse A.  No new row. No re-prompt.
```

## Prerequisite fixes

Both are open findings in `docs/status.md` that sit inside the exact function
this feature rewrites. They are prerequisites, not cleanup.

**Finding #3 — select-then-insert race.** The worker runs `concurrency: 2`. Two
jobs for one tutor both miss the SELECT and collide on
`concepts_tutor_name_live_uidx` (23505), aborting the transaction and failing
the whole job; BullMQ then re-pays for every Gemini call. Today the window is
microseconds. This design does not widen it — embedding happens in a batch
before the transaction — but the function is being rewritten regardless, so it
gets `onConflictDoNothing().returning()` plus a re-select.

**Finding #7 — descriptions silently dropped.** Gemini returns and Zod validates
a per-concept `description`; `conceptIdFor` takes only `name` and the insert
writes `{ tutorId, name }`, so `concepts.description` is NULL for all 736 rows.
Fixed here by threading the description through. It does **not** enter the
embedding — that would give backfilled and new rows two different recipes in one
vector space and make the thresholds meaningless. Persisting it now means a
future re-embed with descriptions has data to work with.

## Embedding model — verified 2026-08-06

**`gemini-embedding-001`, `taskType: SEMANTIC_SIMILARITY`,
`outputDimensionality: 768`.** Called from `worker/` through the
`@google/generative-ai` client already in `dependencies`. Batch through
`batchEmbedContents`, verified working for 7 inputs in one call.

Three things were established by running it, not by reasoning:

**`text-embedding-004` is dead** — 404 on `embedContent`. So is `embedding-001`.
This draft originally named `text-embedding-004`; it would have failed on first
run. Exactly the trap CLAUDE.md's model-gotchas section describes. `ListModels`
reports only `gemini-embedding-001`, `gemini-embedding-2-preview` and
`gemini-embedding-2`.

**`taskType: SEMANTIC_SIMILARITY` is mandatory, not a nicety.** It is the
difference between a usable band and no band at all. Measured on a labelled set
of 6 should-merge and 6 should-not-merge pairs, the gap between the weakest
true duplicate and the strongest true distinct:

| Config | Usable threshold band |
|---|---|
| No `taskType` | 0.7274 – 0.7357 — **0.008 wide, unusable** |
| `SEMANTIC_SIMILARITY`, 3072d | 0.8973 – 0.9562 — 0.059 wide |
| `SEMANTIC_SIMILARITY`, 768d | 0.8949 – 0.9545 — 0.060 wide |

(Bands exclude one deep-synonym pair; see the section below.)

**768 dimensions, not the native 3072.** Two reasons. Quality is
indistinguishable — the band is the same to three decimal places. And pgvector's
HNSW and IVFFlat indexes **cap at 2000 dimensions**, so a 3072-d column can be
stored but never indexed, permanently foreclosing the top-k migration path.
`outputDimensionality: 768` is Matryoshka truncation and is verified working.

The dimension is baked into the column type; changing it later means a column
change plus a full re-embed.

## What this catches, and what it does not

Measured, not assumed. This bounds what the feature can honestly promise.

**Caught reliably** — surface and morphological variants, all ≥ 0.954:

```
0.9952  quadratic formula        ~  the quadratic formula
0.9922  chain rule               ~  the chain rule
0.9742  simultaneous equations   ~  solving simultaneous equations
0.9618  completing the square    ~  method of completing the square
0.9545  vectors                  ~  vector geometry
```

Every one of these is invisible to today's exact-string matching. This is the
feature's real value.

**Correctly left alone** — sibling concepts, all ≤ 0.895:

```
0.8949  mean          ~  median
0.8887  algebra       ~  trigonometry
0.8497  differentiation ~ integration
0.7925  quadratic formula ~ photosynthesis
```

**Not caught** — deep synonyms with no shared vocabulary:

```
0.8358  chain rule  ~  differentiating composite functions
```

This scores *below* `mean ~ median` (0.8949). **No threshold catches the deep
synonym without also merging mean into median**, which would be a destructive
false positive on curated data. So the honest scope is: this feature catches
morphological variants, not conceptual synonyms. A tutor who writes
"differentiating composite functions" in one syllabus and "chain rule" in
another still ends up with two concepts.

That is a real limitation and it should not be papered over in the UI copy. It
is also fine: morphological variants are the bulk of what an LLM extracting the
same subject from different documents actually produces.

## Threshold and calibration

Cosine similarity **0.93** — the midpoint of the measured band (0.8949 –
0.9545) at 768 dimensions with `SEMANTIC_SIMILARITY`.

**Tune upward, not downward, when in doubt.** The costs are asymmetric: a false
positive spends tutor attention and, if rubber-stamped, destroys curated data;
a false negative just leaves a duplicate in place, which is exactly the status
quo. Precision over recall.

The band above comes from 12 hand-labelled pairs, which is enough to establish
that a band exists and roughly where — not enough to fix the constant. Before
shipping, run a calibration script over the real 736-concept corpus, dump the
clusters each candidate value produces, and read them. `mean ~ median` at 0.8949
is the canary: any threshold at or below the sibling band floods the tutor with
false clusters and the feature gets ignored.

Store the constant in one module alongside the other tunables, not inline at the
query.

## Error handling

- **Embedding API fails during extraction** — extraction proceeds and writes
  concepts with `NULL` embeddings. Topics and concepts are the primary value and
  must not be lost to a dedup failure. The rows get picked up by the backfill
  path later.
- **Embedding job fails (manual/preset path)** — BullMQ retry/backoff. The
  concept exists and is usable; it just isn't clustered yet.
- **Backfill fails partway** — idempotent by construction, since it only selects
  `embedding IS NULL`. Re-run it.
- **Merge action** — typed result objects (`{ ok }` / `{ error }`), never thrown
  strings. Authorization failure returns the same opaque "Not authorized" as
  every other action, disclosing nothing.
- **Extraction status is unaffected by dedup.** `syllabuses.extraction_status`
  continues to describe extraction only. Dedup never sets it to `failed`.

## Backfill

A checked-in script in `scripts/`, in the same spirit as
`scripts/test-syllabus-pipeline.ts` — a permanent dev tool, not a migration
step. Selects concepts where `embedding IS NULL`, batches them through the
embedding API, writes vectors. Idempotent and resumable.

## Authorization

Concepts are tutor-owned with no class relationship, so the rule is ownership
only — the same shape as `assertSyllabusOwner`.

- `assertConceptOwner` in `lib/auth/authz.ts`.
- The merge action verifies **every** id in the cluster, survivor and losers
  alike, belongs to the caller.
- The rejection action verifies both ids in every pair.
- `lib/db/queries/concepts.ts` filters on `tutor_id` before any row is read; a
  concept id from the client is only ever a lookup key.
- A student has no access to any of this. Concepts live under `(tutor)/`.

## UI

**Concepts destination** — `app/(tutor)/concepts/page.tsx`, a new top-level nav
entry. Lists the tutor's live concepts and the derived clusters awaiting review.
Server Component, following the existing panel/row/pill vocabulary.

**Cluster review** — the tutor picks which name survives; the rest merge into it.
Shows each variant's topic count so the choice is informed. "Not duplicates —
keep all" writes the pairwise rejections. A `"use client"` component, because it
holds radio selection state — with the one-line comment saying so.

**Syllabus banner** — on `app/(tutor)/syllabi/[syllabusId]/page.tsx`, after
extraction completes: "3 of 12 new concepts may duplicate concepts you already
have", linking into the Concepts page. Dismissible, and never blocks the topics
list.

Extraction always produces a complete, usable syllabus. Flagged concepts are
created and linked normally; review is optional cleanup the tutor does whenever
they like, or never.

## Testing

Every authorization rule gets a test, negatives included — the suite's existing
discipline.

**Authorization (negative):**
- Tutor B cannot merge tutor A's concepts.
- Tutor B cannot merge their own concept into tutor A's (mixed-ownership cluster).
- Tutor B cannot write a rejection for tutor A's pair.
- Tutor B's concept list and clusters never include tutor A's rows.
- A student reaching any concepts route is refused.

**Unit:**
- Connected-components grouping: transitive pairs form one cluster; rejected
  pairs split a cluster; a fully-rejected cluster disappears.
- Tombstone resolution: name → tombstone → survivor; a chain stays one hop after
  a second merge.
- `conceptIdFor` reuses a live row, follows a tombstone, and creates only when
  neither exists.
- Merge repoints `topic_concepts` without violating the composite PK when the
  topic already links to both concepts.
- Concepts with `NULL` embeddings are excluded from clustering.

**Not covered:** whether the threshold produces *good* clusters. That is a
judgment call against real output, handled by the calibration step, not by an
assertion.

## Documentation to update in the same commit

Per the working agreement:

- `CLAUDE.md` — a "Concept deduplication" section next to "Syllabus extraction";
  the vocabulary table gains **Cluster** and **Tombstone** if those names survive
  implementation.
- `docs/status.md` — the new checkpoint; retire the stale "No Syllabi tab UI"
  gap, which is already wrong; mark findings #3 and #7 resolved.
- `docs/erd.txt` — the two new `concepts` columns and
  `concept_merge_rejections`.
- `docs/deploy.md` — pgvector must be enabled on the cloud Postgres, and the
  worker needs no new env beyond what it already has.

## Open risks

1. ~~**Gemini embedding model availability.**~~ **Resolved 2026-08-06 by
   running it.** `text-embedding-004` — which this draft originally specified —
   is 404. `gemini-embedding-001` works, needs `taskType: SEMANTIC_SIMILARITY`
   to be useful at all, and is truncated to 768 dimensions for indexability.
2. **Threshold still needs corpus calibration.** A band is now measured (0.895 –
   0.955) and 0.93 is a defensible starting point, but 12 hand-labelled pairs
   only prove the band exists. Confirm against the real 736 before shipping.
3. **Deep synonyms are out of reach.** Measured, not assumed: no threshold
   catches `chain rule ~ differentiating composite functions` without also
   merging `mean` into `median`. The feature is a morphological-variant
   detector. UI copy must not promise more.
4. **All-pairs clustering does not use the HNSW index.** Fine at 736, not fine
   at 10k. The migration path is a lateral top-k ANN query — which is why the
   768-dimension choice matters, since 3072 could never be indexed at all.
5. **Undo is possible but not built.** If tutors merge wrongly and want it back,
   that is follow-up work, and the merge dialog must not imply otherwise.
