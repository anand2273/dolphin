# CLAUDE.md

## Project

**TutorOS** — an all-in-one student management app for freelance tutors.

v1 is a **session-centric file and homework system**. The AI layer (material generation, auto-marking, analytics) is deliberately deferred, but the v1 data model must make it possible later *without a schema rewrite*. Leave seams, not scaffolding.

## v1 scope — build exactly this

1. Auth with two roles: `tutor` and `student`
2. Tutor creates classes and sessions
3. Per-session material upload and download
4. Homework issuance and student submission, scoped to a session
5. Minimal tutor and student profiles

## Out of scope for v1 — do not build

LLM calls of any kind, auto-marking, analytics dashboards, note editing, payments or invoicing, calendar sync, scheduling, notifications beyond one transactional email, in-app messaging, mobile apps, multi-tutor agencies or orgs, admin panels.

If a task appears to require any of the above, **stop and ask** rather than building a partial version.

## Vocabulary — use these exact names in DB, code and UI

| Term | Meaning |
|---|---|
| **Tutor** | The paying user. Owns everything. Created by self-signup at `/signup`. |
| **Student** | Very low-privilege user. Self-registers an account at `/signup/student`, but can only **join a class by invitation** (email-bound). |
| **Class** | An ongoing engagement between one tutor and one or more students for one subject. Not "course", not "group", not "batch". |
| **Enrollment** | A student's membership in a class. |
| **Invitation** | A tutor's email-bound, single-use, expiring offer for a student to join a class. Pre-enrollment; distinct from Enrollment. |
| **Session** | A single dated lesson belonging to a class. **This is the organising unit of the entire app.** |
| **Material** | A file the tutor attaches to a session. |
| **Assignment** | Homework issued in a session. |
| **Submission** | A student's response to an assignment. |
| **Attachment** | A stored-file row. Materials and submissions both point at attachments. |

Never introduce synonyms. If a new concept is genuinely needed, add it to this table in the same commit.

## Domain rules

- Every material, assignment and submission is reachable from **exactly one session**. There is no global file manager and no free-floating uploads.
- A class has exactly one tutor. Model students as a **collection** from day one, even though the v1 UI may assume 1:1. Retrofitting group classes later is expensive.
- Assignments are issued in one session and usually reviewed in a **later** one. Model `issued_in_session_id` (required) and `review_session_id` (nullable).
- Assignment due dates are independent of session dates. Do not derive one from the other.
- Submissions are **append-only**. A resubmission creates a new version; it never overwrites. Same for corrections.
- A tutor can upload a submission **on behalf of** a student — this is extremely common, because students hand in paper. Store `uploaded_by_user_id` separately from `student_id`.
- Soft-delete anything user-visible (`deleted_at`). Tutors delete things by accident and student work is not recoverable.
- Sessions can exist in the future (planned) and the past (delivered). Materials can be attached before a session happens.

## Security invariants — non-negotiable

- **All authorization happens on the server.** Never trust a role, class id, session id or student id supplied by the client.
- Every data access passes through a single helper that resolves the current user's relationship to the resource. Two questions on every request: *is this user a member of this class*, and *does their role permit this action*.
- A student may: read materials and assignments for their own classes, create and read **their own** submissions. Nothing else. A student must never see another student's submission, including inside a group class.
- Files live in a **private** object store. No public URLs. Serve through short-lived signed URLs minted only *after* an authz check. Use opaque object keys — never guessable paths built from sequential ids or filenames.
- Service-role / admin keys are server-only. If one is about to be imported into a client component, stop and flag it.
- Uploads: validate MIME type and size **server-side**, enforce a size cap, and store the original filename as metadata only — never as part of a storage path.

## Auth & email links

Everything here was learned by breaking it. Do not "simplify" these rules.

- **An emailed auth link must stay on one origin end to end.** `verifyOtp`'s
  session cookie is host-scoped, so `localhost:3000` and `127.0.0.1:3000` are
  different accounts as far as the browser is concerned. `/auth/confirm`
  therefore redirects using the **Host header of the incoming request**, never
  `request.url`'s origin (Next does not guarantee those match).
- Email templates build their href from `{{ .RedirectTo }}`, **not**
  `{{ .SiteURL }}` — the invite action mints a `/auth/confirm?next=<path>` URL on
  the origin the tutor is actually using, so the whole chain inherits it. `next`
  is always a path, never an absolute URL.
- Template comments must not contain `{{ }}` actions — Go's `html/template`
  refuses to parse them and GoTrue then 500s on every send.
- **Editing `supabase/templates/*.html` needs `docker restart
  supabase_kong_dolphin supabase_auth_dolphin`.** Kong serves those files with
  the byte length it captured at container start, so an edited template arrives
  truncated and GoTrue fails with "ends in a non-text context".
- **Never send an invitee to `/login` on failure.** They have no password yet, so
  a login form is a dead end that also leaves their address unusable. Failures go
  to `/link-expired`; an unauthenticated hit on the accept page explains itself.

## Stack

> Confirm this section with the project owner before the first commit; everything below assumes it.

- Next.js (App Router) + TypeScript
- PostgreSQL + Drizzle ORM
- Supabase for auth and object storage
- Tailwind + shadcn/ui
- Zod for all input validation
- Vitest for unit tests, Playwright for E2E

Boring and well-trodden is the point. No new dependencies without asking.

## Commands

```
pnpm dev            # dev server
pnpm build          # production build
pnpm lint
pnpm typecheck
pnpm test           # vitest
pnpm test:e2e       # playwright
pnpm db:generate    # generate migration from schema
pnpm db:migrate     # apply migrations
pnpm db:studio
```

## Structure

```
app/
  (auth)/           # login, invite acceptance
  (tutor)/          # tutor-only routes
  (student)/        # student-only routes
  api/
lib/
  auth/             # session, role resolution, authz helpers
  db/
    schema.ts
    queries/        # all reads
  storage/          # signed URL minting, upload validation
  validation/       # zod schemas
components/
  ui/               # shadcn primitives
```

## Conventions

- Server Components by default. A `"use client"` component needs a one-line comment saying why.
- All mutations are Server Actions colocated in `app/**/actions.ts`. Every action follows: **parse with Zod → authorize → mutate → revalidate.** Step 2 is never skipped, even for "obviously safe" actions.
- No business logic in components. Reads live in `lib/db/queries/`, writes in actions.
- Actions return typed result objects (`{ ok: true, data }` / `{ ok: false, error }`). Do not throw strings; do not swallow errors.
- Timestamps stored as UTC `timestamptz`. A session additionally stores the tutor's IANA timezone. Render in the viewer's local timezone.
- File size and MIME allowlists live in one config module, not sprinkled at call sites.

## Forward-compat hooks for the AI layer

Cheap to add now, expensive to add later. Add the columns/tables; **do not** build the behaviour.

- `attachments.extracted_text` (nullable) and `attachments.extraction_status`. No extraction in v1.
- A `feedback` table keyed to a submission with `author_type` in `('tutor','agent')` and a nullable `author_user_id`. v1 only ever writes tutor rows.
- A `topics` table plus an `assignment_topics` join, tutor-tagged and optional. Without topic tags there is nothing for later analytics to aggregate on — this is the single most valuable hook in this list.
- An append-only `events` table (`actor_id`, `verb`, `subject_type`, `subject_id`, `occurred_at`, `payload jsonb`) written on upload, issue, submit and grade.

Do **not** add LLM SDKs, vector stores, or embedding columns in v1.

## Testing

- Every authorization rule gets a test, and the suite must include **negative** cases: student A cannot read student B's submission; tutor A cannot read tutor B's class; a student cannot issue an assignment.
- One Playwright happy path end to end: tutor creates class → invites student → creates session → uploads material → issues assignment; student accepts invite → downloads material → submits → tutor sees the submission.

## Working agreement

- Propose a plan before any large change. Propose a **schema diff** before running a migration.
- Work in vertical slices that are individually demoable. Do not build the whole app in one pass.
- Small commits, conventional commit messages.
- Ask before: adding a dependency, changing the schema, introducing a new architectural pattern, or touching auth.
- Keep this file current. When a decision here turns out wrong, update it in the same commit that changes the code.