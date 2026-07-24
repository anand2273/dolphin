# Checkpoint 1 — decisions I'm least sure about

Ranked by how much they'd hurt to get wrong. Each has my current call and the
cheapest reversal path if you disagree.

## 1. Attachments: one shared table, mixed link styles (1:1 vs join)
`materials` link 1:1 (`materials.attachment_id`), while `assignments` and
`submissions` link to files through **1:N join tables** (`assignment_attachments`,
`submission_attachments`). To be precise about cardinality: submission→assignment
is N:1 (a submission belongs to one assignment); the join tables are
submission→*attachment* and assignment→*attachment*, each one-owner-to-many-files.
The join is used because `attachments` is a shared file-metadata table (materials,
worksheets, submissions all point at it), so ownership lives in per-owner join
tables rather than three nullable FKs on `attachments`.
**Open question:** enforce 1:N with `UNIQUE(attachment_id)` on each join so a file
can't belong to two submissions? Currently not enforced.
**Reversal cost:** low either way.

## 2. `profiles.id` is a hard FK to `auth.users.id`
Simplest identity model and gives a real DB cascade, but couples us to Supabase
Auth. Mitigated by routing *all* auth through `lib/auth` so nothing else reads
`auth.users`. See the AWS discussion: the alternative is a soft link
(`auth_subject` + `auth_provider` on our own PK) for provider portability.
**Current call:** hard FK for v1. **Reversal cost:** medium (one table + backfill),
localized.

## 3. Role is GLOBAL and strictly separated (reversed in CP3 for monetization)
`profiles.role` is `'tutor' | 'student'`, fixed at account creation:
**self-signup → tutor** (the paying account), **invite acceptance → student**
(invited, low-privilege). Students can never self-register and never see the
tutor UI; a tutor's email can't be added as a student (blocked). This is the
monetization boundary — the thing you sell is tutor access — and it realigns
with CLAUDE.md's "Tutor = the paying user."
Two authz layers: **role** (coarse: which half of the app, can-create-class,
billing) sits above the existing **relationship** check (fine: owner/enrolled/
none for a specific resource). Profile-less authenticated users default to the
low-privilege student home — we never mint a tutor by accident.
*(This reverses the CP1 "contextual roles" decision, which had drifted from
CLAUDE.md; the flexibility of one person being both a tutor and a student is
intentionally dropped for v1.)*

## 4. `sessions.status` removed — planned/delivered derived from `scheduled_at`
Your call. `scheduled_at > now()` => planned, else delivered. Nothing stored.
**Caveat I want on record:** *cancellation* is NOT derivable from time. v1 has no
cancel feature; if you later want one, it's an explicit `cancelled_at` column
(and "cancelled" then wins over the derived planned/delivered). Flagging so a
future cancel button doesn't get mistaken for something the current model
already supports.

## 5. `due_at` and worksheet attachments nullable/optional at the DB
`assignments.due_at` is nullable and worksheet attachments are optional at the
schema level, even though the product (Checkpoint 6) says "with a due date."
I'm enforcing "has a due date" in Zod/UI, not in the column, so drafts and
imports stay flexible.
**Risk:** a bad code path could persist a due-less assignment. Mitigated by
validation + the fact it's easily tightened later with a NOT NULL.
**Reversal cost:** trivial.

## 6. Invitation stores `token_hash`, and email-match is the real gate
The link's token is stored hashed (not plaintext) and is only an *identifier*;
the actual authority is "the accepting user controls the invited email." I'm
fairly confident here, but it means acceptance UX depends on Supabase email
verification working. If email is flaky, acceptance is blocked by design (that's
the point — no unbound enrollment).
**Reversal cost:** n/a (this is a security invariant, not a preference).

## 7. `enrolled_at` separate from `created_at` on enrollments
"Semantic enrollment time" = the real-world moment the student *joined the
class* (a domain fact), as opposed to `created_at` = when the DB row was
inserted (a storage fact). They're identical today. They diverge only if we ever
import history: e.g. a student who actually joined in Jan 2025 but whose row you
insert today — `enrolled_at` = Jan 2025 (true), `created_at` = today (true).
Keeping them separate avoids having to lie in either field later. It's free.
**If you'd rather not carry it:** drop `enrolled_at`, use `created_at`. Trivial.
Tell me your preference and I'll match it.

## 8. Object-store ↔ DB atomicity gap (documented, not "solved")
There is no distributed transaction across Supabase Storage and Postgres.
Pattern: upload object → insert `attachments` row in a DB transaction →
best-effort delete on failure; a periodic GC reconciles orphans. Orphaned
objects are wasteful but not a correctness or security problem (opaque keys,
soft-deleted, invisible). Flagging so this isn't mistaken for a bug later.

---

## Things I deliberately did NOT add (out of scope / YAGNI)
- No `subjects` table — `classes.subject` is free text until it needs attributes.
- No submission-count rollups / materialized views — a `GROUP BY` is fine at a
  single tutor's scale; revisit only if Checkpoint 7's status view gets slow.
- No `class_tutors` join — multi-tutor classes are explicitly out of scope.
- No LLM SDKs, vector stores, or embedding columns (per CLAUDE.md).

## Transaction discipline to carry into Checkpoint 2+
Each multi-row mutation is wrapped in a single `db.transaction()`:
accept-invitation, create-material, submit/resubmit, and every mutation +
its `events` row. Resubmission relies on the
`(assignment_id, student_id, version)` unique index as its concurrency guard
(catch unique violation → retry with next version), not `SERIALIZABLE`.
