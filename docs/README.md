# Dolphn — documentation index

Start here if you're new to this codebase.

**Dolphn** is an all-in-one student management app for freelance tutors. v1 is a
session-centric file and homework system. The AI layer is deliberately deferred,
but the data model is built so it can arrive without a schema rewrite.

## Sixty-second orientation

- **The organising unit is the Session** — one dated lesson belonging to one
  class. Every material, assignment and submission hangs off exactly one session.
  There is no global file manager.
- **Two global roles.** A `tutor` is the paying account (self-signup). A
  `student` is low-privilege, can self-register, but can only **join a class by
  invitation**. The role is fixed at account creation.
- **All authorization is server-side**, through one helper (`lib/auth/authz.ts`).
  Two questions on every request: is this user a member of this class, and does
  their role permit this action.
- **Nothing is hard-deleted.** Tutors delete things by accident and student work
  is not recoverable.

## The documents

| Document | What it's for |
|---|---|
| [`../CLAUDE.md`](../CLAUDE.md) | **The rules.** Scope, vocabulary, domain rules, security invariants, conventions. Read first; it overrides everything else. |
| [`requirements.md`](requirements.md) | Functional (FR-*) and non-functional (NFR-*) requirements. |
| [`user-stories.md`](user-stories.md) | User stories (US-*) with acceptance criteria, by actor. |
| [`status.md`](status.md) | What is actually built, checkpoint by checkpoint, mapped to the stories it fulfils. **Check here before assuming a feature exists.** |
| [`authz-matrix.md`](authz-matrix.md) | The 38-row authorization contract. The spec `lib/auth` must satisfy. |
| [`erd.txt`](erd.txt) | Plain-text entity-relationship diagram of all 15 tables. |
| [`checkpoint-1-decisions.md`](checkpoint-1-decisions.md) | The schema decisions least certain to be right, each with its reversal cost. |
| [`future-enhancements.md`](future-enhancements.md) | Product direction beyond v1, including the agentic layer. |
| [`ux-roadmap.md`](ux-roadmap.md) | Known UI/UX debt and planned interface work. |

## Where things live

```
app/
  (auth)/          login, signup, signup/student, link-expired
  (tutor)/         dashboard, classes/[classId]
  (student)/       student
  sessions/[id]/   session detail — ONE route, serves both roles
  invite/accept/   invitation acceptance
  api/             route handlers (materials download)
  auth/confirm/    email-link verification
lib/
  auth/            session, roles, guards, THE authz helper
  db/
    schema.ts      all 15 tables
    queries/       every read — each one authorizes first
    migrations/    drizzle-owned; NOT supabase/migrations
  storage/         private bucket, opaque keys, signed URLs
  validation/      zod schemas
components/        ui/ holds shadcn primitives
tests/             authz tests, negatives included
```

## Working rules that bite if ignored

1. **Reads live in `lib/db/queries/`, writes in `app/**/actions.ts`.** No
   business logic in components. Every action: parse → authorize → mutate →
   revalidate.
2. **Migrations are Drizzle's** (`pnpm db:generate` / `db:migrate`), in
   `lib/db/migrations/`. `supabase db push` does nothing here, and
   `supabase db reset --linked` would wipe the cloud database and rebuild it from
   zero migrations.
3. **Server Components by default.** A `"use client"` component carries a
   one-line comment saying why.
4. **Don't run `pnpm build` while a dev server is running** — they share `.next`
   and the dev server starts 500ing with `Cannot find module './NNN.js'`.
5. **Email templates and auth URLs are environment-specific.** Do not
   `supabase config push`; it would send localhost values into production.

## Verify

```
pnpm typecheck && pnpm lint && pnpm test
```

45 tests, all authorization-focused. Adding a feature that touches access
control without adding a negative test is not finished work.
