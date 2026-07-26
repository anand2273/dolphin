# Dolphn — Implementation Status

**Check this before assuming a feature exists.** Several tables are in the schema
with no code behind them yet — that is deliberate (see the forward-compat hooks
in [`../CLAUDE.md`](../CLAUDE.md)), not an oversight.

Last updated: end of Checkpoint 5, first cloud deployment.

---

## Summary

| Checkpoint | Scope | Status |
|---|---|---|
| CP1 | Schema, ERD, authorization matrix, decisions | Done |
| CP2 | Walking skeleton: signup → login → class → dashboard | Done |
| CP3 | Invitations, enrollment, global roles, student self-signup | Done |
| CP4 | Sessions — create, list, edit, detail page | Done |
| CP5 | Materials — private bucket, signed upload/download | Done |
| — | Cloud deployment (Vercel + Supabase + Resend) | Done |
| CP6 | Assignments and submissions | **Not started** |
| CP7+ | Everything in [`future-enhancements.md`](future-enhancements.md) | Not started |

**45 tests, all passing.** Every one is an authorization test; the suite is
deliberately weighted toward negative cases.

---

## CP1 — Schema and authorization design

No runtime code. Produced the 15-table schema, a plain-text ERD, the 38-row
authorization matrix, and a written record of the decisions least likely to be
right.

- `lib/db/schema.ts` — all 15 tables, including AI forward-compat hooks
  (`attachments.extracted_text`, `feedback`, `topics`, `events`)
- [`erd.txt`](erd.txt), [`authz-matrix.md`](authz-matrix.md),
  [`checkpoint-1-decisions.md`](checkpoint-1-decisions.md)

Migrations `0000` and `0001` are the **only** migrations in the project. CP3, CP4
and CP5 each required zero schema changes — the model was built ahead of the
features.

## CP2 — Walking skeleton · US-T1, US-T2

Tutor signup, login, class creation, dashboard, on real GoTrue auth and a
migrated Postgres.

- `lib/auth/authz.ts` — **the** authorization helper. `resolveClassAccess`
  answers "what is this user to this class" (owner / enrolled / none);
  `assertClassOwner` and `assertClassMember` are the capability gates.
- `app/(auth)/actions.ts`, `app/(tutor)/dashboard/`, `app/(tutor)/classes/[classId]/`
- `tests/authz.class.test.ts` — including tutor B cannot read tutor A's class

## CP3 — Invitations, enrollment, roles · US-T3, US-T4, US-T5, US-S1, US-S2

Email-bound, single-use, expiring invitations; acceptance creates enrollment;
global tutor/student roles enforced server-side.

- `lib/auth/invite-access.ts` — pure, unit-testable acceptance gate
- `lib/tokens.ts` — raw token emailed, only its SHA-256 hash stored
- `app/invite/accept/` — role-aware: new invitee gets create-account-and-join,
  existing student gets one-click join
- `app/(auth)/signup/student/` — student self-registration
- `lib/auth/account-lookup.ts` — refuses self-signup for an address that already
  has an auth account, including an unclaimed invitation shell
- `tests/authz.invite.test.ts`, `tests/authz.signup.test.ts`, `tests/roles.test.ts`

Two significant course corrections landed here: roles reverted from "contextual"
to **global** (the monetization boundary), and students gained self-signup while
class membership stayed invite-only.

## CP4 — Sessions · US-T6, US-T7, US-S3

The session detail page, which is the app's main screen.

- `lib/db/queries/sessions.ts` — `listSessionsForClass`, `getSessionForViewer`
- `app/sessions/[sessionId]/` — **one route serving both roles.** Access is
  resolved once and tutor controls hang off the result, so the read rule cannot
  drift between a tutor copy and a student copy.
- `components/session-form.tsx` — converts wall-clock input to an instant in the
  browser, the only place that knows the user's timezone
- `tests/authz.session.test.ts`

## CP5 — Materials · US-T8, US-S4

Per-session file upload and download against a private bucket.

- `lib/storage/config.ts` — the single MIME/size allowlist (25 MiB; excludes SVG
  and HTML, which are script delivery vectors when served back to students)
- `lib/storage/objects.ts` — the only module touching storage. Opaque keys
  (`uuid/uuid`), signed upload/download minting, `statObject`.
- `app/sessions/[sessionId]/actions.ts` — three-step upload: mint → browser PUTs
  direct to storage → confirm. **The confirm step re-reads the object's real size
  and MIME and records those, never the client's claim.**
- `app/api/materials/[materialId]/download/route.ts` — authorizes, *then* mints a
  short-lived signed URL, returned as a `no-store` redirect
- `tests/authz.material.test.ts`

Bytes never pass through Next, which is what keeps a 25 MB upload working on
Vercel's ~4.5 MB request cap.

## Deployment

Live on Vercel with a Supabase cloud project and Resend for transactional email
over a verified domain. See [`deploy.md`](deploy.md) for the runbook and the
traps — the email template and redirect-allowlist steps in particular fail
silently rather than loudly.

---

## Built but unused

These exist in the schema with no code behind them. They are the seams for later
work, and CP6 will be the first thing to write to them.

| Table | Waiting on |
|---|---|
| `assignments`, `assignment_attachments` | CP6 |
| `submissions`, `submission_attachments` | CP6 |
| `feedback` | CP6 (`author_type` reserved for a future agent) |
| `topics`, `assignment_topics` | tutor tagging; the hook analytics would aggregate on |
| `attachments.extracted_text`, `extraction_status` | the AI layer; no extraction happens in v1 |

## Known gaps

Ordered by how much they matter.

1. **`enable_confirmations` is off** (NFR-12). Anyone can register an address
   they don't control and wait to be invited, weakening the email-binding the
   invitation model rests on. Needs a "check your email" state in both signup
   flows. **The most significant open security gap.**
2. **No database backups** on the cloud project. Student work is not recoverable.
3. **No Playwright E2E**, though CLAUDE.md specifies one happy path end to end.
   Coverage today is unit-level authorization tests plus manual verification.
4. **No storage garbage collection.** Soft-deleting a material deliberately
   leaves the object; nothing reclaims orphans.
5. **No profile editing UI** (US-T13).
6. **`/login` ignores `?next=`**, so a deep link that bounces through login
   doesn't return you afterwards.
7. **No email delivery monitoring.** A failed invitation is discovered by the
   student not turning up.
