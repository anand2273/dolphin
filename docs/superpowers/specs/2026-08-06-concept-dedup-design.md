# Concept deduplication — design

Date: 2026-08-06
Status: approved design, not yet implemented

## Problem

`concepts` are tutor-global and persist across every syllabus a tutor uploads.
The only deduplication today is exact-string: `conceptIdFor` in
`worker/process-syllabus-extraction.ts` looks up `lower(name)` and reuses a live
row, backed by the partial unique index `concepts_tutor_name_live_uidx` on
`(tutor_id, lower(name)) where deleted_at is null`.

`BASE_PROMPT`'s NAMING rules push hard to make that exact match succeed —
lowercase everything, strip numbering, strip articles, don't pluralise. That is
normalisation-as-prompt-engineering, and it does not survive contact with real
documents. The local corpus is **736 live concepts across 6 syllabuses**, and it
contains this:

```
alcohol            |  alcohols
rate constant      |  rate constants
coulomb's law      |  coulomb’s law          (straight vs curly apostrophe)
ideal gas behavior |  ideal gas behaviour    (US vs UK spelling)
Inverse Matrix     |  Matrix Inverse         (word order)
batteries and fuel cells | fuel cells and batteries
```

**Goal: a clean, navigable vocabulary.** This is a curation feature, judged by
whether the tutor's concept list is usable as a picker — not by whether later
analytics aggregate correctly.

## What this is, after measurement

This began as an embedding/pgvector design. It was calibrated against the real
736-concept corpus, and **the embeddings did not earn their complexity**. The
full measurements are in "Evidence" below and are the main reason this document
exists — they should be read before anyone proposes reinstating embeddings.

The feature ships as **normalised-key clustering with tutor sign-off**. All the
human-facing machinery — cluster review, tombstone merges, pairwise rejections,
the Concepts destination — is unchanged from the original design. Only the
detection function differs, and it is deliberately one swappable module.

## Scope

**In:** normalised-key duplicate detection, a cluster review surface, merging
with a reversible tombstone, and permanent pairwise rejections.

**Out:** pgvector, embeddings, any Gemini call on this path, a backfill job,
auto-merging without tutor confirmation, analytics, the question bank.

Detection ranks candidates. The tutor decides. Nothing merges on its own.

## Decisions

| Decision | Choice | Why |
|---|---|---|
| Goal | Clean vocabulary | Curation, not statistics |
| Detection | Normalised-key match | Measured: 45 of the 58 merges embeddings find, at ~5% of the machinery, with better precision on plurals |
| Review unit | Cluster, pick a survivor | Real duplication is 3–4 variants of one idea |
| Academic level | One concept, level derived | `syllabuses.level` already exists; a concept's levels are a join. Zero schema cost |
| Review home | Concepts destination + syllabus banner | Clusters span syllabuses and belong to no single one |
| Merge model | Tombstone `merged_into_id` | Survives re-extraction, gives undo, preserves provenance |
| Cluster storage | Derived on read | Nothing to invalidate |
| Write-path matching | Unchanged, exact `lower(name)` | Normalising at write time would silently merge `alcohol` into `alcohols` with no tutor sign-off |

### Why detection is read-time only

The write path deliberately keeps its existing exact-match behaviour. If
`conceptIdFor` matched on the normalised key, extraction would quietly collapse
`alcohol` and `alcohols` into one row — a merge decision made without the tutor,
which is the one thing this feature must never do. Normalisation informs review;
it never performs a merge.

### Why clusters are derived, not stored

Persist two things: **tombstones** and **rejected pairs**. Everything else is
computed.

```
clusters = f(live concepts, rejected pairs)
```

Stored candidate rows would go stale on every merge. Deriving removes the
invalidation logic entirely, because there is no cache to be wrong.

Because clustering is by *equal normalised key*, grouping is transitive — a
plain `GROUP BY` over the key, with no connected-components pass. This is
strictly simpler than the similarity-graph version an embedding approach would
have required.

### Why rejections are pairwise

Two concepts may share a key today and a third may join that group tomorrow. A
rejection recorded against the group would suppress the new member too. Pairs
are stable: a cluster is shown when it contains at least one pair the tutor has
not already rejected, so a new arrival re-surfaces it while previously-rejected
pairs stay quiet.

## The normalisation

The whole of detection. Deliberately small, pure, and unit-testable — a single
module, no database involvement:

1. Lowercase
2. Unify apostrophes (`’ ‘ \``  → `'`), strip `'s`, then strip `'`
3. Replace any non-alphanumeric run with a space
4. Drop stopwords: `the of and a an for to in on its it from with between by`
5. Crude singularise: `ies`→`y`, `ses`/`xes`→ drop `es`, trailing `s` (but not `ss`)
6. `-our` → `-or` (`behaviour` → `behavior`)
7. Deduplicate tokens, sort them, join with a space

Two concepts belong to the same cluster **iff their keys are equal**.

Measured on the real corpus: 39 clusters, 84 concepts affected, **45 net
reduction, and no false positives** across all 39 (each was read individually).

Steps 5–7 are what earn this over `lower(name)`: singularising catches
`alcohol/alcohols`, `-our` catches `behaviour/behavior`, and sorting catches
`Inverse Matrix/Matrix Inverse`.

## Schema diff

Propose before migrating, per the working agreement. **No extension, no new
dependency, no index changes.**

```sql
ALTER TABLE concepts
  ADD COLUMN merged_into_id uuid REFERENCES concepts(id) ON DELETE SET NULL;

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

`CHECK (concept_a_id < concept_b_id)` enforces canonical pair ordering, so a
rejected pair is stored exactly once and cannot be double-inserted reversed.

`concepts.description` needs no schema change — the column exists and is simply
never written. See "Finding #7".

Migrations are Drizzle's, against a direct or session-pooler connection on 5432,
never the transaction pooler.

## Architecture

### Read path

No new query is needed. `listConceptsForTutor` already returns exactly the rows
required; clustering happens in TypeScript over its result.

```
listConceptsForTutor(tutorId)        existing query, unchanged
  ↓
group by normalisedKey(name)          pure function, unit-testable
  ↓
drop groups of size 1
  ↓
drop groups where every pair is already rejected
  ↓
clusters
```

At 736 concepts this is a single pass over a few hundred short strings. There is
no similarity search, no index, and nothing to tune.

### Write path

Unchanged, except that `conceptIdFor` gains tombstone resolution:

```
live exact name match   → reuse that row          (today's behaviour)
tombstone name match    → follow merged_into_id   (new)
neither                 → create
```

### Merge

A Server Action in `app/(tutor)/concepts/actions.ts`, following parse →
authorize → mutate → revalidate. Given a survivor and N losers, in one
transaction:

1. Verify **every** concept id belongs to the calling tutor. A survivor id alone
   does not authorize touching arbitrary loser ids — the rule `linkTopicConcept`
   already applies.
2. Repoint `topic_concepts` from each loser to the survivor, with
   `onConflictDoNothing` (a topic may already link to both).
3. Soft-delete each loser and set `merged_into_id = survivor`.
4. **Repoint existing tombstones** pointing at any loser to the survivor, so
   chains stay one hop deep and resolution needs no loop guard.
5. Delete rejection rows involving the losers — they name rows that are no
   longer live and would otherwise accumulate forever.
6. Write a `concept.merged` event.

Soft-deleting the losers removes them from `concepts_tutor_name_live_uidx` (it
is partial on `deleted_at is null`), so a merge can never collide with it.

### Undo

Clearing `merged_into_id` and `deleted_at` restores a loser, but its
`topic_concepts` links were repointed and are not recoverable from the tombstone
alone. **v1 ships no undo UI.** The tombstone makes undo possible later; it is
not a promise to the tutor now, and the merge dialog says so.

## The re-extraction loop this closes

`concepts_tutor_name_live_uidx` is partial. A plain soft-delete leaves no live
row, so a later syllabus emitting the old name creates it fresh and the tutor is
proposed the identical merge again, forever.

```
concepts
  id=A  "carboxylic acids"   deleted_at=NULL
  id=B  "carboxylic acid"    deleted_at=2026-08-06
                             merged_into_id=A

later extraction emits "carboxylic acid"
  → no live row
  → tombstone B found by name
  → follow merged_into_id → A
  → reuse A.  No new row. No re-prompt.
```

## Prerequisite and adjacent fixes

**Finding #3 — select-then-insert race. Prerequisite.** The worker runs
`concurrency: 2`; two jobs for one tutor can both miss the SELECT and collide on
`concepts_tutor_name_live_uidx` (23505), aborting the transaction and failing
the whole job, after which BullMQ re-pays for every Gemini call. `conceptIdFor`
is being modified for tombstone resolution regardless, so it gets
`onConflictDoNothing().returning()` plus a re-select at the same time.

**Finding #7 — descriptions silently dropped. Adjacent, not required.** Gemini
returns and Zod validates a per-concept `description`; `conceptIdFor` takes only
`name`, so `concepts.description` is NULL for all 736 rows. In the embedding
design this was a prerequisite. It no longer is — nothing here reads
descriptions. It remains a real bug worth fixing in the same area of code, and
persisting descriptions is what would make a future evaluation of
description-based detection possible at all.

## Authorization

Concepts are tutor-owned with no class relationship, so the rule is ownership
only — the same shape as `assertSyllabusOwner`.

- `assertConceptOwner` in `lib/auth/authz.ts`.
- The merge action verifies **every** id in the cluster, survivor and losers
  alike, belongs to the caller.
- The rejection action verifies both ids in every pair.
- `lib/db/queries/concepts.ts` filters on `tutor_id` before any row is read; a
  concept id from the client is only ever a lookup key.
- Students have no access. Concepts live under `(tutor)/`.

## UI

**Concepts destination** — `app/(tutor)/concepts/page.tsx`, a new top-level nav
entry listing the tutor's live concepts and the clusters awaiting review. Server
Component, using the existing panel/row/pill vocabulary.

**Cluster review** — the tutor picks which name survives; the rest merge into it.
Each variant shows its topic count so the choice is informed. "Not duplicates —
keep all" writes the pairwise rejections. `"use client"` for the radio state,
with the one-line comment saying why.

**Syllabus banner** — on the syllabus page after extraction: "3 of 12 new
concepts may duplicate concepts you already have", linking to Concepts.
Dismissible, never blocks the topics list.

Extraction always produces a complete, usable syllabus. Flagged concepts are
created and linked normally; review is optional cleanup.

## Testing

**Authorization (negative):**
- Tutor B cannot merge tutor A's concepts.
- Tutor B cannot merge their own concept into tutor A's (mixed-ownership cluster).
- Tutor B cannot write a rejection for tutor A's pair.
- Tutor B's concept list and clusters never include tutor A's rows.
- A student reaching any concepts route is refused.

**Unit — normalisation.** The function is pure, so this is cheap and should be
thorough. Each rule gets a case, drawn from the real corpus:
`alcohol/alcohols`, `coulomb's law/coulomb’s law`, `ideal gas
behavior/behaviour`, `Inverse Matrix/Matrix Inverse`, `batteries and fuel
cells/fuel cells and batteries`.

**Unit — negative normalisation.** The pairs that must NOT collide, also from
the corpus: `nitrate/nitrite`, `alkanes/alkenes`, `acid dissociation
constants/base dissociation constants`, `electric potential/electric potential
energy`, `formation of carboxylic acids/reactions of carboxylic acids`. These
are the regression guard on any future change to the normalisation rules.

**Unit — clustering and merge:**
- Groups of size 1 are dropped; a fully-rejected group is hidden; a group with
  one unrejected pair is shown.
- A new concept joining a previously-rejected group re-surfaces it.
- Tombstone resolution: name → tombstone → survivor; a chain stays one hop after
  a second merge.
- `conceptIdFor` reuses a live row, follows a tombstone, creates only when
  neither exists.
- Merge repoints `topic_concepts` without violating the composite PK when a
  topic already links to both concepts.

## Evidence

Measured 2026-08-06 against the real 736-concept corpus (6 syllabuses; H2
Mathematics, Chemistry and Physics). **This section is why the design is what it
is. Read it before proposing embeddings again.**

### Embeddings were tested properly first

- `text-embedding-004` and `embedding-001` are **404** on `embedContent`. Only
  `gemini-embedding-001` responds. An earlier draft specified the dead model.
- `taskType: SEMANTIC_SIMILARITY` is load-bearing: without it the usable
  threshold band is 0.008 wide; with it, 0.060 on a soft labelled set.
- `gemini-embedding-2` is **worse**, not better — it cannot separate
  morphological variants from sibling concepts at all, at either 768 or 3072
  dimensions. Do not "upgrade".
- 768 dimensions is forced regardless: pgvector's HNSW/IVFFlat indexes cap at
  2000, so `gemini-embedding-001`'s native 3072 could never be indexed.

### Descriptions in the embedding make it worse

| Recipe | Morph min | Deep min | Sibling max | Band |
|---|---|---|---|---|
| Name only | 0.9545 | 0.8358 | 0.9470 | 0.0075 |
| Name — description | 0.9109 | 0.9118 | 0.9246 | none |
| Description only | 0.9084 | 0.9173 | 0.9208 | none |

Deep synonyms converge (+0.076) but morphological variants degrade (−0.044),
because two syllabuses describe the same concept in different words. Net, no
band at all. (Descriptions here were hand-written for the test, not real Gemini
output.)

### Threshold calibration on the real corpus

| Threshold | Clusters | Net reduction | Verdict |
|---|---|---|---|
| 0.93 | 143 | 307 | Merges `electric potential` with `gravitational potential` and `standard hydrogen electrode` |
| 0.95 | 121 | 178 | Merges `nitrate` with `nitrite` (0.9516) |
| 0.97 | 71 | 82 | Merges `electric potential` with `electric potential energy` |
| **0.98** | **51** | **58** | No false positives found |

### The comparison that decided it

| | Clusters | Net reduction |
|---|---|---|
| Embeddings @ 0.98 | 51 | 58 |
| **Normalised key** | **39** | **45** |

Of the 66 pairs embeddings find at 0.98: **41 are exact matches after
normalisation, 18 more fall to token overlap, and 7 need embeddings** — and most
of those 7 are stemming (`enantiomerism/enantiomers`,
`Formulating/Formulation`, `Interpretation/Interpreting`).

Meanwhile the embedding **misses 11 pairs normalisation catches**, all trivially
correct: `alcohol/alcohols` (0.9647), `carboxylic acid/carboxylic acids`
(0.9764), `ionisation energies/ionisation energy` (0.9789), `order of
reaction/orders of reaction` (0.9635).

**Conclusion:** on this corpus the cheap method has better precision, better
recall on plurals, no API cost, no extension, no threshold, and no failure mode.
Embeddings add roughly 13 net merges for pgvector, a Gemini dependency in the
write path, a backfill job, and a 0.008-wide threshold band.

### Limits of this evidence

Six syllabuses from roughly three real documents, all in mathematics, chemistry
and physics. Repeated uploads of similar documents inflate the
morphological-variant share. A humanities corpus, where synonymy is genuinely
richer, might favour embeddings more — though note that deep synonyms were
measured as **not separable at any safe threshold** (`chain rule ~
differentiating composite functions` at 0.836 scores below `mean ~ median` at
0.895), so that upside is largely unreachable regardless of corpus.

## If embeddings are revisited

Detection is one module behind one function signature. Adding embeddings later
is a contained change, and the honest trigger for it is evidence — a tutor whose
list is still cluttered after normalisation, with examples normalisation cannot
reach. At that point:

1. Re-run the corpus comparison above; do not assume it still holds.
2. Prefer a **union** with normalisation, not a replacement — embeddings at a
   safe threshold miss plurals that normalisation gets.
3. `gemini-embedding-001`, `SEMANTIC_SIMILARITY`, 768 dimensions, threshold
   0.98. Not `gemini-embedding-2`.
4. Persisting `concepts.description` (Finding #7) is what makes a
   description-based evaluation possible at all.

## Documentation to update in the same commit

- `CLAUDE.md` — a "Concept deduplication" section next to "Syllabus extraction".
  **The pgvector/embedding carve-out added on 2026-08-06 should be narrowed back
  out**, since nothing here uses it; the measurements above are the record of
  why. The vocabulary table gains **Cluster** and **Tombstone** if those names
  survive implementation.
- `docs/status.md` — the new checkpoint; retire the stale "No Syllabi tab UI"
  gap, which is already wrong; mark finding #3 resolved, #7 if fixed.
- `docs/erd.txt` — `concepts.merged_into_id` and `concept_merge_rejections`.
- `docs/future-enhancements.md` — item 1 of "Syllabus Feature Enhancements" is
  addressed; the embedding option is deferred with evidence, not dropped.

## Open risks

1. **45 merges out of 736 concepts is an 8% reduction.** Modest. The feature's
   value depends on tutors actually engaging with cluster review; if they do
   not, no detection method would have helped.
2. **The normalisation rules are hand-tuned to this corpus.** They generalise
   reasonably (plurals, spelling, word order are subject-independent), but the
   negative test cases are the guard, and new corpora may need new rules.
3. **Undo is possible but not built.**
4. **The crude singulariser will mangle some words** (`analysis` → `analysi`).
   Harmless for clustering, since both sides normalise identically, but the key
   must never be shown to a user or used as a display name.
