# CLAUDE.md

## Project

**Dolphn** — an all-in-one student management app for freelance tutors.

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
| **Feedback** | A tutor's comment on a specific submission version. `author_type` reserves room for a future agent; v1 only ever writes tutor rows. |
| **Topic** | An optional, tutor-applied tag on an assignment. The thing later analytics aggregate on. |

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
- **Never mint an emailed link with `createSupabaseServerClient`.**
  `@supabase/ssr` defaults to the **PKCE** flow, which emails a
  `pkce_`-prefixed token that must be exchanged with a code verifier sitting in
  the requesting browser's cookies. `/auth/confirm` uses
  `verifyOtp({ token_hash })`, so a PKCE token can never verify there. Use a
  plain `@supabase/supabase-js` client with `flowType: "implicit"` — as
  `inviteStudent` and `requestPasswordReset` both do.
- **A rejected `redirectTo` does not raise an error.** GoTrue falls back to Site
  URL and sends the mail regardless, so an origin missing from the dashboard
  redirect allowlist shows up as a link on the *wrong host* with its path
  stripped — and, because our templates append `&token_hash=` to
  `{{ .RedirectTo }}`, as a mangled URL the browser refuses. Preview deploys
  need the Vercel wildcard; see deploy.md §4.
- **A recovery link is a sign-in.** `verifyOtp` returns an ordinary session, so
  "has a session" is not authority to set a new password — that would make
  `/reset-password` a change-password form with no old-password prompt, and any
  unattended signed-in browser an account takeover (`secure_password_change` is
  off, so GoTrue won't ask either). `/auth/confirm` mints a short-lived,
  user-bound, httpOnly marker on `type=recovery`; `resetPassword` requires it
  and spends it. Do not reduce that to a session check.
- **`/forgot-password` answers identically for a registered and an unregistered
  address.** This is the opposite of the signup gate below, on purpose: that
  disclosure buys a security property, this one would buy an enumeration oracle.
- **Never send an invitee to `/login` on failure.** They have no password yet, so
  a login form is a dead end that also leaves their address unusable. Failures go
  to `/link-expired`; an unauthenticated hit on the accept page explains itself.
  The same holds for a dead *recovery* link — someone resetting a password does
  not know it — so `/link-expired` offers a fresh reset link instead.
- **Self-signup is refused for any address that already has a GoTrue account**
  (`findAccountByEmail`). This is a security gate: `inviteUserByEmail` creates an
  auth row *before* email control is proved, and with confirmations disabled
  GoTrue hands a session for that row to whoever calls `signUp`.

> **Open decision — `auth.email.enable_confirmations` is `false`.** While it is
> off, anyone can self-signup as an address they don't control and sit waiting
> for a tutor to invite it, which defeats the email-binding the invite model
> rests on. The signup gate above closes the *invite-shell* case only. Turning
> confirmations on needs a "check your email" state in both signup flows.

## Files and object storage

- The `materials` bucket is **private** and must exist before uploads work. It is
  declared in `supabase/config.toml` (created on `supabase start`); a new cloud
  project needs it created once with the same limits.
- Size and MIME limits are declared **twice on purpose** — in
  `lib/storage/config.ts` and on the bucket itself — so Storage rejects a bad
  object even if a caller reaches it without passing our checks. Change both.
- Uploads go **browser → storage directly** via a signed upload URL. Bytes never
  pass through Next, because Vercel caps request bodies near 4.5MB and materials
  can be 25MB. The action mints the URL only after an authz check.
- **The client's claims about a file are never recorded.** `confirmMaterialUpload`
  re-reads the object's real size and MIME with `statObject` and writes those;
  a mismatch deletes the object and writes no rows. Validating only at mint time
  would let a caller request a URL for a small PDF and push something else.
- Only `app/api/materials/[id]/download` may serve a file, and it authorizes
  *before* minting. Signed URLs are short-lived and never rendered into a page.
- Deleting a material is a soft delete; the object stays in the bucket. Student
  work and tutor uploads are not recoverable once the bytes are gone.

## Documentation

`docs/` carries the detail this file deliberately doesn't. Start at
[`docs/README.md`](docs/README.md).

- **[`docs/status.md`](docs/status.md) — read before assuming a feature exists.**
  Several tables are in the schema with no code behind them; that is intentional.
- [`docs/requirements.md`](docs/requirements.md) — FR-\*/NFR-\* with build status
- [`docs/user-stories.md`](docs/user-stories.md) — US-\* with acceptance criteria
- [`docs/authz-matrix.md`](docs/authz-matrix.md) — the contract `lib/auth` must satisfy
- [`docs/erd.txt`](docs/erd.txt) · [`docs/checkpoint-1-decisions.md`](docs/checkpoint-1-decisions.md)
- [`docs/deploy.md`](docs/deploy.md) — cloud runbook and its silent-failure traps
- [`docs/future-enhancements.md`](docs/future-enhancements.md) · [`docs/ux-roadmap.md`](docs/ux-roadmap.md)

Keep `docs/status.md` current in the same commit that changes what's built.

## Stack

Settled and in production. No new dependencies without asking.

- Next.js (App Router) + TypeScript
- PostgreSQL + Drizzle ORM
- Supabase for auth and object storage
- Tailwind + shadcn/ui
- Zod for all input validation
- Vitest for unit tests, Playwright for E2E
- Deployed on Vercel; Supabase cloud for auth/storage/Postgres; Resend for email

Boring and well-trodden is the point.

## Commands

```
pnpm dev            # dev server
pnpm build          # production build — see warning below
pnpm lint
pnpm typecheck
pnpm test           # vitest
pnpm test:e2e       # playwright
pnpm db:generate    # generate migration from schema
pnpm db:migrate     # apply migrations
pnpm db:studio
pnpm sb:start       # local Supabase stack
pnpm sb:stop
```

Two ways to lose an afternoon here:

- **Never run `pnpm build` while a dev server is running.** They share `.next`,
  so the build clobbers the dev server's chunks and every route starts 500ing
  with `Cannot find module './NNN.js'`. Recovery is `rm -rf .next` plus a dev
  restart. Verify with `typecheck` + `test` instead.
- **Migrations are Drizzle's, in `lib/db/migrations/`.** `supabase/migrations/`
  does not exist, so `supabase db push` silently does nothing — and
  `supabase db reset --linked` would **wipe the cloud database and rebuild it
  from zero migrations**. Apply migrations with
  `DATABASE_URL="<direct connection>" pnpm db:migrate`. Use the direct or session
  pooler (5432) for DDL, never the transaction pooler (6543).

## Structure

```
app/
  (auth)/               # login, signup, signup/student, forgot/reset-password, link-expired
  (tutor)/              # tutor-only: dashboard, classes/[classId]
  (student)/            # student-only: student
  sessions/[sessionId]/ # session detail — ONE route, serves both roles
  invite/accept/        # invitation acceptance (NOT under (auth))
  auth/confirm/         # email-link verification (token_hash flow)
  api/                  # route handlers: materials download
lib/
  auth/                 # session, roles, guards, request origin, recovery gate, THE authz helper
  db/
    schema.ts           # all 15 tables
    queries/            # all reads — each authorizes before returning rows
    migrations/         # drizzle-owned; there is no supabase/migrations
  storage/              # private bucket, opaque keys, signed URLs
  validation/           # zod schemas
components/
  ui/                   # shadcn primitives
tests/                  # authz tests, negatives included
docs/                   # see the Documentation section above
```

## Conventions

- Server Components by default. A `"use client"` component needs a one-line comment saying why.
- All mutations are Server Actions colocated in `app/**/actions.ts`. Every action follows: **parse with Zod → authorize → mutate → revalidate.** Step 2 is never skipped, even for "obviously safe" actions.
- No business logic in components. Reads live in `lib/db/queries/`, writes in actions.
- **A resource both roles can read gets ONE route**, not a tutor copy and a student copy. Resolve the viewer's relationship once and hang role-specific controls off that result (see `app/sessions/[sessionId]/page.tsx`). Two routes means the same access rule written twice, and they stop agreeing after the first change nobody mirrors.
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

- Every authorization rule gets a test, and the suite must include **negative** cases: student A cannot read student B's submission; tutor A cannot read tutor B's class; a student cannot issue an assignment. 56 tests today, all authorization-focused.
- One Playwright happy path end to end: tutor creates class → invites student → creates session → uploads material → issues assignment; student accepts invite → downloads material → submits → tutor sees the submission. **Not built yet** — `pnpm test:e2e` has no config or specs behind it. Coverage today is unit-level authz plus manual verification.

## Working agreement

- Propose a plan before any large change. Propose a **schema diff** before running a migration.
- Work in vertical slices that are individually demoable. Do not build the whole app in one pass.
- Small commits, conventional commit messages.
- Ask before: adding a dependency, changing the schema, introducing a new architectural pattern, or touching auth.
- Keep this file current. When a decision here turns out wrong, update it in the same commit that changes the code.