# Dolphn — UI/UX Roadmap

v1's interface was built to prove the domain model and the authorization
boundaries, not to be pleasant. It is deliberately thin: shadcn primitives,
stacked cards, no shell. This is the list of what that cost, ordered by what
would hurt a real tutor first.

Nothing here changes behaviour or security — it is all presentation and
interaction. Anything that touches what a user is *allowed* to do belongs in
[`requirements.md`](requirements.md) instead.

---

## P1 — Would bite a real user on day one

### 1. Destructive actions have no confirmation — **done**
"Remove" on a material, "Delete" on a lesson, and "Revoke" on an invitation used
to fire on a single click with no confirm step and no undo. Soft-delete meant the
data survived, but the *user* had no idea of that and no way to reverse it from
the UI — the sharpest edge in the app, for an audience CLAUDE.md explicitly
describes as "tutors delete things by accident".

All three now go through `components/ui/confirm-button.tsx`, built on the
platform's `<dialog showModal()>`: focus trap, Esc-to-close and an inert
background for no dependency. Call sites keep their bound Server Action, so the
authorization path is byte-for-byte what it was.

- Still open: an **undo** affordance. The rows are recoverable, so a toast with
  "Undo" is strictly better than a modal — but it needs an un-delete action that
  does not exist yet.

### 2. No upload progress — **done**
`components/upload-material-form.tsx` now PUTs with `XMLHttpRequest` (the reason:
`fetch` reports no upload progress), renders a determinate bar with a percentage
while bytes are moving, and offers **Cancel upload** via `xhr.abort()`. A
cancelled upload leaves an orphan object and no rows — the same state as any
abandoned upload, since step 1 writes nothing.

- Still open: nothing reclaims those orphan objects (see #4 in Known gaps,
  `docs/status.md`).

### 3. No application shell — **done**
Breadcrumbs landed first (`components/breadcrumbs.tsx`); the shell followed.
`components/top-bar.tsx` is a persistent sticky header rendered by the three
signed-in route-group layouts (`(tutor)`, `(student)`, `sessions/`) — brand,
role-resolved "Classes" home link, sign-out and an avatar initial. Sign-out
lives only there now; every signed-in page can reach it. The `(auth)` pages and
`invite/accept` stay shell-less on purpose — they're signed out. Pages share
one container (`components/page.tsx`) so content aligns under the bar.

### 4. Actions succeed silently — **done, narrowly**
Deliberately not a toast system. Acknowledgement was added only where the UI does
not already show the result:

- **Lesson deleted** — `deleteSession` navigates you to the class page, so it
  redirects with `?notice=lesson-deleted` and the page renders
  `components/notice.tsx`. The param is a *key*, resolved through the fixed table
  in `lib/notices.ts`; rendering the raw value would let anyone with a link put
  words in the app's own chrome.
- **Lesson saved** — the edit panel stays open on save, so `SessionForm` shows a
  "Saved." line on `state.ok`, mirroring `invite-student-form.tsx`.

Everything else already announces itself: a created class, a created lesson and
an uploaded material appear as a new row; a revoked invitation and a removed
material vanish; the invite form already said "Invitation sent."

### 5. Nothing indicated work in flight — **done**
Not originally on this list, but the same complaint as #2 one level up: every
page `await`s a database read before its first paint and every submit button only
swapped its label. One primitive, `components/ui/spinner.tsx`, now covers both —
inside buttons on `pending`, and in a `loading.tsx` for each of the four
data-fetching routes.

---

## P2 — Would degrade quickly with real usage

### 6. Sessions are one flat, ascending list — **mostly done**
The tutor's class page now splits **Upcoming** (ascending) from **Past**
(collapsed behind a native `<details>`, reverse-chronological), grouped at
render time from `scheduledAt`.

- Still open: pagination/lazy-loading of past lessons — a term of lessons all
  render inside the collapsed section today.
- Still open: the student dashboard's inline lists (see #7) are still flat.

### 7. The student dashboard inlines everything
Every class renders all its lessons inline. Fine for one class, unusable at five.

- Give students a class page of their own, mirroring the tutor's

### 8. Empty states don't teach — **done**
A tutor with no classes now lands on `components/first-run.tsx`: the four-step
class → lesson → material → homework path with a create-class call to action.
The dashboard also gained the mockup's "Up next" cross-class lesson feed and
class cards (facepile, pending-invite pill, next-lesson line), fed by two new
read-only queries (`listUpcomingSessionsForTutor`, `listClassOverviewsForTutor`)
that keep the authorize-first pattern. Sidebar-pointing empty-state copy died
with the sidebars.

### 9. No branded error pages
404s fall through to Next's default. Given the app deliberately returns 404 for
*unauthorized* access, a stranger following a shared link sees a stock error with
no explanation.

- `not-found.tsx` and `error.tsx`, in the app's own voice

### 10. Materials give no type affordance — **mostly done**
Material rows carry `components/ui/ext-chip.tsx`: the extension block from the
mockup (PDF red, images sea-green, everything else neutral), derived from the
stored filename with the recorded MIME as fallback.

- Still open: image thumbnails.

---

## P3 — Polish

### 11. Accessibility
- Form errors are plain `<p>` with no `aria-live`, so screen readers miss them
- The edit panel toggles without moving focus
- The file input is unstyled and inconsistent with other controls
- Colour contrast on `text-muted-foreground` over card backgrounds is unverified

### 12. Mobile
Layouts use `max-w-*` and `md:` breakpoints but have not been tested on a real
handset. Tutors will absolutely use this on a phone between lessons — the
class page's two-column grid is the first thing to check.

### 13. No dark mode — **done**
The token layer now carries the full dark palette from the UI-direction mockup,
switched by `prefers-color-scheme` alone — no toggle, no dependency. One
deliberate deviation: dark `--primary-foreground` is dark ink rather than the
mockup's near-white, which failed contrast on the light sea-green.

### 14. Upload ergonomics
- No drag-and-drop
- One file at a time; a tutor scanning six worksheets does six round trips
- No client-side image compression for phone photos, which are large and common

### 15. Timezone display is correct but quiet
Times render in the viewer's zone and note the tutor's only when they differ.
That is the right behaviour, but there is no affordance explaining it — a student
abroad may not trust the time they see.

---

## Deliberately not doing

- **A design system.** shadcn primitives are enough until the product shape settles.
- **Animation.** Nothing here is improved by motion yet.
- **Marketing pages.** There is no signed-out landing page and v1 doesn't need one.
