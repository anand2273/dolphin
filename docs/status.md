# Dolphn — Implementation Status

**Check this before assuming a feature exists.** Several tables are in the schema
with no code behind them yet — that is deliberate (see the forward-compat hooks
in [`../CLAUDE.md`](../CLAUDE.md)), not an oversight.

Last updated: Syllabus creation — backend (post-UI-overhaul); extraction-worker
review findings recorded 2026-08-04.

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
| — | Password reset (forgot → email → set new) | Done |
| — | UX P1 — confirmations, upload progress, breadcrumbs, spinners | Done |
| — | Class deletion (type-to-confirm soft delete) | Done |
| — | UI overhaul — shell, mockup design language, dark mode | Done |
| — | Syllabus creation — backend (schema, upload, presets, async extraction) | Done |
| — | Syllabus creation — UI (Syllabi tab, editor) | **Not started** |
| CP6 | Assignments and submissions | **Not started** |
| CP7+ | Everything else in [`future-enhancements.md`](future-enhancements.md) | Not started |

**71 tests, all passing.** Every one is an authorization test; the suite is
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

## Password reset · US-A1 · FR-1.7–1.9

Both roles, reusing the invite flow's plumbing: one origin end to end, a
`{{ .RedirectTo }}` template, and `/auth/confirm` as the single verification hop.

- `app/(auth)/forgot-password/` — `resetPasswordForEmail`, `redirectTo` set to
  `/auth/confirm?next=/reset-password`. The reply is identical for a registered
  and an unregistered address; real failures (rate limit, SMTP) are still
  surfaced, because GoTrue returns success for an unknown address anyway and so
  an error discloses nothing.
- `lib/auth/recovery.ts` — **the reason this is more than a form.** A recovery
  link produces an ordinary session, so a session alone cannot be the authority
  to set a password; that would make `/reset-password` a change-password page
  with no old-password prompt, and any unattended signed-in browser an account
  takeover. `/auth/confirm` mints a short-lived, user-bound, httpOnly marker on
  `type=recovery`; `resetPassword` requires it and spends it.
- `app/(auth)/actions.ts` — on success, `signOut({ scope: "others" })`, so a
  reset prompted by suspicion actually evicts the other party.
- `lib/auth/origin.ts` — the Host-header origin helper, now shared with the
  invite action instead of duplicated.
- `supabase/templates/recovery.html` + `[auth.email.template.recovery]`.
  **A cloud project needs this pasted into the dashboard** (`deploy.md` §5); the
  stock template uses `{{ .ConfirmationURL }}` and fails in the fragment.
- `tests/authz.password-reset.test.ts` — 11 tests, mostly negative: no session,
  session without a marker, a marker belonging to someone else, and replay.

## UX P1 — presentation only

The four day-one problems in [`ux-roadmap.md`](ux-roadmap.md). No server action,
authorization check or query changed; the existing tests passed unaltered before
and after.

- `components/ui/confirm-button.tsx` — confirmation on the three destructive
  actions (remove material, delete lesson, revoke invitation), on the platform's
  `<dialog showModal()>`. No new dependency.
- `components/upload-material-form.tsx` — `XMLHttpRequest` in place of `fetch`,
  because only the former reports upload progress. Determinate bar plus cancel.
- `components/breadcrumbs.tsx` — replaces the ad-hoc back links. At the time
  this closed item #3 only *partially*; the UI overhaul later delivered the
  shell itself (see below).
- `lib/notices.ts` + `components/notice.tsx` — acknowledgement for the one action
  that navigates you away (`deleteSession`). The `?notice=` param is a key mapped
  through a fixed table, never rendered raw.
- `components/ui/spinner.tsx` — in pending buttons and in a `loading.tsx` for
  each of the four routes that read the database before first paint.

## Class deletion · US-T14 · FR-2.4

Soft delete behind a type-to-confirm dialog (`delete <class name>`) — the first
mutation with a typed-phrase gate. Catches the implementation up to row 8 of the
authz matrix, which promised tutor-only class soft-delete from day one.

- `app/(tutor)/classes/[classId]/actions.ts` — `deleteClass`: parse → owner
  check → server-side phrase re-check (the disabled button is UX, not a guard)
  → soft delete + `class.deleted` event in one transaction → redirect to
  `/dashboard?notice=class-deleted`.
- No child row is touched: every read of sessions/materials resolves class
  access first, and `resolveClassAccess` filters `deleted_at`, so everything
  inside the class becomes unreachable with it.
- `getInvitationByToken` now also requires a live class, so a pending invite
  link for a deleted class lands on `/link-expired`.
- `components/ui/type-to-confirm-button.tsx` — sibling of `ConfirmButton`
  (which has no form fields and no error surface); still the platform's
  `<dialog>`, no new dependency.
- `tests/authz.class.test.ts` — six new tests: owner, enrolled student and the
  pending invite token all lose access after the soft delete.

## UI overhaul — presentation only

The approved UI-direction mockup applied to the real app: paper/sea design
tokens (light **and** dark via `prefers-color-scheme`), a persistent top-bar
shell rendered by route-group layouts (sign-out finally reachable everywhere),
panel/row lists with date chips in place of stacked cards, the dashboard's
"Up next" feed + class cards + guided first-run, an upcoming/past lesson split
on the class page, file-type chips on materials, and branded 404/error pages.
Sidebar forms moved into native-`<dialog>` FormDialogs.

No server action, authorization check or schema changed; the 62 tests passed
unaltered. The only server-side additions are two read-only queries
(`listUpcomingSessionsForTutor`, `listClassOverviewsForTutor`), both keyed to
the owning tutor before any row is read. Everything future-facing in the mockup
(Library, whiteboard, homework question sets, syllabus pills) was deliberately
left out — see the scope rules in CLAUDE.md.

## Syllabus creation — backend only

The first stage explicitly beyond v1 — see the "LLM calls" carve-out in
[`../CLAUDE.md`](../CLAUDE.md). Schema, storage, authorization, actions, presets
and the async extraction worker are built; **there is no Syllabi tab or editor
UI yet** — this checkpoint is backend-only, by request.

- `lib/db/schema.ts` — three new tables (`syllabuses`, `concepts`,
  `topic_concepts`), plus `topics` reshaped to be syllabus-scoped (was an
  unused hook with zero rows and zero code touching it — see CP1's "built but
  unused" note below, now retired). `assignment_topics` is untouched.
- `lib/auth/authz.ts` — `assertSyllabusOwner`: ownership only, no class
  membership — a syllabus is tutor-owned and independent of any class.
- `lib/db/queries/syllabuses.ts` — `listSyllabiForTutor`, `getSyllabusForOwner`,
  `listTopicsForSyllabus` (with each topic's concepts), `listConceptsForTutor`.
- `app/(tutor)/syllabi/actions.ts`, `app/(tutor)/syllabi/[syllabusId]/actions.ts`
  — manual creation, preset-clone, the three-step document upload
  (mint → browser PUT → confirm, same shape as materials), topic/concept CRUD.
- `lib/storage/config.ts` — new `syllabus-documents` private bucket, narrower
  MIME allowlist than materials (documents, not photos). `lib/storage/objects.ts`
  now takes the bucket explicitly instead of assuming `materials`.
- `lib/syllabus-presets/` — static code fixtures (PSLE Mathematics, Cambridge
  IGCSE Mathematics 0580 today), not DB rows. "Create from preset" deep-copies
  one into a new, fully independent tutor-owned syllabus.
- `lib/queue/syllabus-extraction.ts` + `worker/` — BullMQ + Redis. The Next app
  only enqueues; a standalone worker process (outside Vercel, which can't host
  one) consumes the queue, calls Gemini, and writes `topics`/`concepts`/
  `topic_concepts`. See the "Syllabus extraction" section of `../CLAUDE.md` —
  including the model gotchas (deprecated/thinking-model traps and the
  finishReason/token-cap/schema-description guards that fix them).
- `worker/pdf-chunk.ts` — PDFs are split into structural (fixed-size, page-based,
  not semantic) chunks before extraction, one Gemini call per chunk, results
  merged by case-insensitive topic/concept name. Added because whole-document
  extraction was producing topics too vague/generic for the granularity wanted;
  each chunk's prompt is only allowed to name a topic/concept that is
  literally, explicitly present in that chunk. Non-PDF formats (`.txt`/`.doc`/
  `.docx`) still go through the original single whole-document call — no
  chunking story for them yet.
- `tests/authz.syllabus.test.ts` — 9 tests: rival tutor and student both
  denied at every layer (assert, query, list), soft-delete hides the syllabus
  from its own tutor too.
- `scripts/test-syllabus-pipeline.ts` — the way to exercise upload → enqueue →
  worker → Gemini → DB without a UI (seed/`--status`/`--cleanup` modes).

**Verified working end-to-end locally** (2026-08): a real document uploaded
through the full flow, extracted by Gemini, and landed as correctly-nested
topics/concepts. Local Redis runs via `pnpm redis:start` (Docker); local
`.env.local` has a working `GEMINI_API_KEY`.

**Not built**: the Syllabi tab itself, `classes.syllabus_id` (attaching a
syllabus to a class), and assignment tagging from a syllabus's topics (still
waiting on CP6). Nothing is deployed anywhere yet — worker and Redis both run
locally only (see known gaps below).

### Extraction worker — open findings (review, 2026-08-04)

A code review of `worker/` found the following. Ordered by severity. Findings
1 and 2 are now fixed; 3–9 are open. (Two related issues found the same day
were fixed before the review: the concept lookup in `conceptIdFor` is now
case-insensitive to match `concepts_tutor_name_live_uidx`, and the syllabus
page no longer renders the raw `extraction_error` DB text to tutors.)

1. ~~**Model string contradicts its own comment and CLAUDE.md.**~~ **Resolved
   2026-08-04 by keeping `gemini-flash-latest` and correcting the docs**, not
   by reverting to the lite tier. `git log` showed the switch away from
   `gemini-flash-lite-latest` was deliberate (commit `fd20abb`), made while
   fighting vague topics, and `gemini-flash-latest` is what the H2 Math
   extraction was validated against — reverting would have traded away that
   quality win. CLAUDE.md's model-gotchas section records the reversal.
2. ~~**Re-running extraction duplicates every topic.**~~ **Fixed 2026-08-04 —
   and the original diagnosis was wrong.** It never duplicated: `topics` has a
   live-rows-only unique index on `(syllabus_id, lower(name))`
   (`topics_syllabus_name_live_uidx`), so the second insert violated that
   index, rolled the transaction back and failed the job. So the real symptom
   was a *retry that always fails* once a syllabus already has topics, not
   data corruption. The worker now looks each topic up case-insensitively and
   updates in place, inserting only when absent. Deliberately non-destructive:
   nothing is deleted, so topics a tutor created by hand survive a
   re-extraction rather than being wiped by a clear-and-rewrite. (This also
   makes `retrySyllabusExtraction` safe from any status, so it needs no
   status guard of its own.)
3. **Concept-creation race between concurrent jobs.** The worker runs
   `concurrency: 2`; two jobs for the same tutor can both miss the
   select-then-insert in `conceptIdFor` and collide on
   `concepts_tutor_name_live_uidx` (23505), failing a whole job. Needs
   `onConflictDoNothing().returning()` + re-select to be idempotent.
4. **Prompt concatenation typo** in `worker/gemini-extract.ts`'s `basePrompt`:
   `"...Chain rule is a concept" + "Do not promote..."` — no space/period, so
   the model receives `a conceptDo not promote`.
5. **One failed chunk wastes all the others.** `Promise.all` fails fast, so a
   single chunk failure discards every successful chunk result and the BullMQ
   retry re-pays for all the Gemini calls. `Promise.allSettled` + per-chunk
   retry would bound the cost.
6. **No graceful shutdown** in `worker/index.ts` — no SIGTERM/SIGINT handler
   calling `worker.close()`. Safe today (transaction aborts, BullMQ recovers
   the stalled job) but a drain-then-exit is cheap and standard for Railway.
7. **Concept descriptions are silently dropped.** Gemini returns and Zod
   validates a `description` per concept, but the insert writes only `name`,
   despite `concepts.description` existing. Related: in the chunk merge, the
   first-seen topic description wins, discarding a later chunk's fuller one.
8. **Per-chunk caps but no post-merge cap.** Zod bounds each chunk (60 topics /
   30 concepts) but the merged total is unbounded — a long document can write
   arbitrarily many topic rows.
9. **Latent infinite loop in `worker/pdf-chunk.ts`** if anyone sets
   `PAGE_OVERLAP >= PAGES_PER_CHUNK` (stride becomes 0). Needs a one-line
   guard.

Minor: topic/concept inserts are sequential N+1 awaits inside the transaction
(batchable).

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
| `assignment_topics` | CP6 — tagging an assignment with a syllabus's topics |
| `attachments.extracted_text`, `extraction_status` | the AI layer; no OCR-style extraction happens in v1 |

`topics` is no longer in this table — the syllabus-creation backend gave it a
real shape and real writers (manual creation, preset-clone, the extraction
worker). It just has no UI yet, same as everything else in this checkpoint.

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
8. **The syllabus-extraction worker isn't deployed anywhere.** Verified
   working end-to-end locally (`pnpm worker:dev` + `pnpm redis:start` +
   a real `GEMINI_API_KEY` in `.env.local`), but there's no Railway (or
   equivalent) service, no production Redis, and no `GEMINI_API_KEY` in any
   deployed environment yet. The runbook for doing it is written up as
   [`deploy.md`](deploy.md) §9 (one Railway project holding both Redis and the
   worker), including the `REDIS_URL` the Next app needs as the queue's
   producer — which is Railway's *public* proxy URL, not the private one the
   worker uses.
9. **No Syllabi tab UI.** The backend (schema, actions, worker) is done and
   tested via `scripts/test-syllabus-pipeline.ts`; a tutor cannot reach any of
   it without that script or a direct Server Action call today.
