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

### 1. Destructive actions have no confirmation
"Remove" on a material, "Delete" on a lesson, and "Revoke" on an invitation all
fire on a single click with no confirm step and no undo.

Soft-delete means the data survives, but the *user* has no idea of that and no
way to reverse it from the UI. For an audience CLAUDE.md explicitly describes as
"tutors delete things by accident", this is the sharpest edge in the app.

- Add a confirmation dialog for all three
- Longer term, an "undo" toast is better than a modal — the rows are recoverable,
  so the affordance should exist
- `components/edit-session-panel.tsx`, `app/sessions/[sessionId]/page.tsx`,
  `app/(tutor)/classes/[classId]/page.tsx`

### 2. No upload progress
The cap is 25 MB and the upload is a single `fetch` PUT with no progress
reporting. A tutor uploading a large scanned PDF sees "Uploading…" and no
movement, which reads as a hang.

- Switch to `XMLHttpRequest` or a stream reader to get progress events
- Show percentage and allow cancel
- `components/upload-material-form.tsx`

### 3. No application shell
Every page is standalone. There is no persistent header, no breadcrumb, no
consistent way back, and sign-out exists only on two pages. Navigation is
whatever `<Link>` happens to be on the current screen.

- A minimal shell: product name, current class/lesson context, sign-out
- Breadcrumbs for class → lesson

### 4. Actions succeed silently
Revoking an invitation, deleting a lesson and removing a material all just
re-render. Success is inferred from absence.

- A toast primitive, used consistently for every mutation

---

## P2 — Would degrade quickly with real usage

### 5. Sessions are one flat, ascending list
Every lesson for a class, oldest first, no grouping or pagination. After a term
of weekly lessons the next lesson is somewhere in the middle of a long scroll.

- Split **Upcoming** and **Past**, with past collapsed and reverse-chronological
- Paginate or lazily load past lessons
- `app/(tutor)/classes/[classId]/page.tsx`, `app/(student)/student/page.tsx`

### 6. The student dashboard inlines everything
Every class renders all its lessons inline. Fine for one class, unusable at five.

- Give students a class page of their own, mirroring the tutor's

### 7. Empty states don't teach
"No lessons yet. Add the first one on the right." is accurate and unhelpful to
someone who has never used the app. A new tutor lands on an empty dashboard with
no sense of the class → lesson → material → homework progression.

- First-run guidance on the dashboard that names the next action

### 8. No branded error pages
404s fall through to Next's default. Given the app deliberately returns 404 for
*unauthorized* access, a stranger following a shared link sees a stock error with
no explanation.

- `not-found.tsx` and `error.tsx`, in the app's own voice

### 9. Materials give no type affordance
Every material renders identically regardless of type — no icon, no thumbnail, no
distinction between a worksheet PDF and a photo of a whiteboard.

- File-type icons at minimum; image thumbnails would be better

---

## P3 — Polish

### 10. Accessibility
- Form errors are plain `<p>` with no `aria-live`, so screen readers miss them
- The edit panel toggles without moving focus
- The file input is unstyled and inconsistent with other controls
- Colour contrast on `text-muted-foreground` over card backgrounds is unverified

### 11. Mobile
Layouts use `max-w-*` and `md:` breakpoints but have not been tested on a real
handset. Tutors will absolutely use this on a phone between lessons — the
class page's two-column grid is the first thing to check.

### 12. No dark mode
Tailwind and the shadcn tokens are set up for it; nothing implements it.

### 13. Upload ergonomics
- No drag-and-drop
- One file at a time; a tutor scanning six worksheets does six round trips
- No client-side image compression for phone photos, which are large and common

### 14. Timezone display is correct but quiet
Times render in the viewer's zone and note the tutor's only when they differ.
That is the right behaviour, but there is no affordance explaining it — a student
abroad may not trust the time they see.

---

## Deliberately not doing

- **A design system.** shadcn primitives are enough until the product shape settles.
- **Animation.** Nothing here is improved by motion yet.
- **Marketing pages.** There is no signed-out landing page and v1 doesn't need one.
