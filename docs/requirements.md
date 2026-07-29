# Dolphn — Requirements (v1)

Scope is defined by [`../CLAUDE.md`](../CLAUDE.md); this document states it as
testable requirements. Status values: **Built** · **Partial** · **Planned** ·
**Out of scope for v1**.

Anything marked *Out of scope* is a deliberate exclusion, not an oversight. If a
task appears to need one, stop and ask rather than building a partial version.

---

## Functional requirements

### FR-1 — Accounts and roles · Built

1. A tutor creates their own account at `/signup`. This is the paying account.
2. A student creates their own account at `/signup/student`.
3. `profiles.role` is `tutor | student`, decided by **which entry point was
   used**, never by client input, and fixed for the account's lifetime.
4. A student account can never reach the tutor area, and a tutor account can
   never join a class as a student.
5. An authenticated user with no profile row is treated as low-privilege, never
   as a tutor.
6. Self-signup is refused for any email that already has an auth account,
   including an unclaimed invitation shell.
7. Either role can reset a forgotten password from `/forgot-password`. The
   response is identical whether or not the address has an account — this
   endpoint is not an account-enumeration oracle. (FR-1.6 discloses the opposite
   on purpose, because it is buying a security gate; here there is nothing to
   buy.)
8. A recovery link grants a session, so setting a new password requires **both**
   that session and a recovery marker minted for that same user by
   `/auth/confirm`. A session alone must never be sufficient: that would make
   `/reset-password` a change-password form with no old-password prompt.
9. A completed reset revokes every other session for that account, and the
   recovery marker is single-use.

### FR-2 — Classes · Built

1. A tutor creates a class with a name and optional free-text subject.
2. A class has exactly one tutor and many students. The 1:N model is mandatory
   from day one even while the UI assumes 1:1.
3. A tutor sees only their own classes. Another tutor's class is indistinguishable
   from a non-existent one.
4. A tutor may soft-delete a class, gated by typing `delete <class name>` (the
   server re-checks the phrase). Afterwards the class and everything reachable
   through it — lessons, materials, enrollments — is inaccessible to every role,
   and pending invite links stop working.

### FR-3 — Invitations and enrollment · Built

1. A tutor invites a student to a class by email address.
2. An invitation is **email-bound, single-use, and expires** (7 days).
3. Accepting requires the accepting account to control the invited address.
   Possessing the link is not sufficient.
4. A brand-new invitee is prompted to create an account and join in one step; an
   existing student joins with one click.
5. A tutor may revoke a pending invitation.
6. Re-inviting the same address re-sends rather than silently doing nothing.
7. Acceptance creates an `enrollment` and consumes the invitation atomically.

### FR-4 — Sessions · Built

1. A tutor creates a session (one dated lesson) in a class, with an optional
   title and a required date/time.
2. Sessions may be in the future (planned) or past (delivered). This is
   **derived** from `scheduled_at`, never stored.
3. A tutor may edit or soft-delete a session.
4. An enrolled student may view their class's sessions and open one, read-only.
5. Times are stored UTC and rendered in the **viewer's** timezone; the tutor's
   IANA zone is stored alongside as context.

### FR-5 — Materials · Built

1. A tutor uploads a file to a specific session.
2. Allowed types and a size cap are enforced **server-side**, from one config
   module.
3. Files live in a private bucket under opaque keys. No public URLs.
4. Downloads are served through short-lived signed URLs minted only **after** an
   authorization check.
5. Any member of the class (owning tutor or enrolled student) may download.
6. A tutor may remove a material; this is a soft delete and the stored object is
   deliberately retained.

### FR-6 — Assignments · Planned (CP6)

1. A tutor issues an assignment within a session (`issued_in_session_id`,
   required).
2. An assignment may name a later `review_session_id` (nullable).
3. Due dates are independent of session dates and never derived from them.
4. An assignment may carry worksheet attachments.
5. Enrolled students see assignments for their own classes.

### FR-7 — Submissions · Planned (CP6)

1. A student submits work against an assignment.
2. Submissions are **append-only**: a resubmission creates a new version and
   never overwrites. Same for corrections.
3. A tutor may submit **on behalf of** a student — this is common, because
   students hand in paper. `uploaded_by_user_id` is stored separately from
   `student_id`.
4. A student may read **only their own** submissions, including inside a group
   class.
5. A tutor may record feedback against a submission.

### FR-8 — Profiles · Partial

Minimal tutor and student profiles exist (name, email, role). There is no
profile editing UI.

### Out of scope for v1

LLM calls of any kind · auto-marking · analytics dashboards · note editing ·
payments or invoicing · calendar sync · scheduling · notifications beyond one
transactional email · in-app messaging · mobile apps · multi-tutor agencies ·
admin panels.

---

## Non-functional requirements

### NFR-1 — Authorization is server-side and single-sourced · Built

Every data access passes through `lib/auth/authz.ts`. No role, class id, session
id or student id from the client is trusted; the owning class is always
re-derived from the database. Existence is never leaked: missing, soft-deleted
and not-yours are indistinguishable to the caller.

**Verify:** [`authz-matrix.md`](authz-matrix.md) is the contract; `tests/authz.*`
is the proof.

### NFR-2 — File confidentiality · Built

Private bucket, opaque object keys (`uuid/uuid`) carrying no filename, class id
or session id. Signed URLs are short-lived (60s), sent as `no-store` redirects,
and never rendered into a page. Original filenames are metadata only, never part
of a storage path.

### NFR-3 — Upload integrity · Built

MIME type and size are validated server-side against one config module before a
signed upload URL is issued, and the object's **actual** size and type are
re-read from storage before any row is written. Client claims are never
recorded. Browser-executable types (SVG, HTML) are excluded, because these files
are served back to students.

### NFR-4 — Recoverability · Partial

Everything user-visible carries `deleted_at` and is soft-deleted. **Gap:** the
cloud project has no database backups configured, and there is no storage
garbage collection.

### NFR-5 — Auditability · Built

An append-only `events` table records actor, verb, subject and timestamp on
domain-significant actions. It is the deliberate exception to soft-delete.

### NFR-6 — Time correctness · Built

All timestamps are UTC `timestamptz`. A session additionally stores the tutor's
IANA timezone. Wall-clock input is converted to an instant **in the browser**,
which is the only place that knows the user's zone; the server performs no
timezone arithmetic and carries no timezone dependency.

### NFR-7 — Input validation · Built

Every server action parses with Zod before doing anything else. Actions return
typed results (`{ ok }` / `{ error }`) rather than throwing strings.

### NFR-8 — Vendor portability · Built

Exactly three Supabase touchpoints: `DATABASE_URL`, `lib/storage/`, `lib/auth/`.
Domain data never goes through PostgREST — it is direct Postgres via Drizzle,
which is why RLS is defense-in-depth only and not the security boundary.

### NFR-9 — Testability · Built

Every authorization rule has a test, and the suite includes **negative** cases:
student A cannot read student B's submission, tutor A cannot read tutor B's
class, a student cannot issue an assignment. 56 tests currently.

**Gap:** no Playwright E2E happy path yet, though CLAUDE.md calls for one.

### NFR-10 — Serverless-safe data access · Built

Production connects through Supabase's transaction pooler with `prepare: false`.
Migrations use a direct connection. The Postgres client is cached on `globalThis`
so hot reloads don't leak connections.

### NFR-11 — Email deliverability · Partial

Invitations are the only way a student reaches the app, so transactional email is
load-bearing rather than incidental. Production sends via Resend over a verified
domain with SPF/DKIM/DMARC.

**Gap:** no bounce handling, no send monitoring, no retry if an invite fails to
deliver. A tutor currently learns about a failure by the student not appearing.

### NFR-12 — Identity assurance · **Gap — accepted risk**

`auth.email.enable_confirmations` is **off**. Anyone can self-register an address
they do not control and wait to be invited to a class, which undercuts the
email-binding the entire invitation model rests on. `findAccountByEmail` closes
the invite-shell case only.

Closing this needs a "check your email" state in both signup flows. Until then,
the invariant in FR-3.3 is weaker in practice than it is on paper. This is the
single most significant known security gap.

### NFR-13 — Scale · Built by assumption

Sized for a single freelance tutor: tens of students, hundreds of sessions,
thousands of files. No rollups, caches or materialized views. Revisit only when
something is measurably slow.