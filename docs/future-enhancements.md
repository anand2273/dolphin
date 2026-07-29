# Dolphn - Future Enhancements

Everything here is **beyond v1**. v1 scope is fixed in [`../CLAUDE.md`](../CLAUDE.md)
and nothing below should be built until CP6 (assignments and submissions) closes
it out. For what exists today see [`status.md`](status.md).

The first section is the product direction in the owner's own words. The sections
after it are engineering annotations on that vision — what the current schema
already supports, and what would need new tables.

---

## Product direction

- Material Creation

- Knowledge Base, Data Moat, Agentic Layer
    - class based: each class is taught based on a specific education system syllabus. this could be test prep (SAT, ACT, BMAT) or H2 Math, Chemistry, Physics, etc. enable uploads for the subject syllabus/information, which populates the knowledge base for that particular class. feeds into the data moat/agentic layer for certain? purposes
    - session based: the content that was covered per lesson: uses uploaded notes, assigned homework, and submitted homework
    - student based: based on student performance in homework assignments, in-class assignments, and timed practice papers.
    - tutor-teaching approach: tutors can describe their teaching approach, their plan, timelines and goals for the lessons and how the lesson plans will evolve over time.
    - some of the above information can be captured from an onboarding survey of some sort, when each class is created.
    - Agent will leverage on the knowledge base to perform the following functions
        1. session-based recommendations
        2. student-based recommendations
        3. time-to-exam: provide a different kind of approach as exams near
        4. student-based weakness and strengths analytics and improvement metrics

- Homework and Supplementary Practice 
    1. Homework assignments can be accessed from a single location within the student portal
    2. submitted assignments can be accessed from a single location within the tutor's page to review/mark

### Decided direction — Jul 2026

Settled while iterating on the UI mockups; these are decisions, not options.
Vocabulary for the first two is reserved in CLAUDE.md's table.

1. **Syllabus** is an optional attribute of a class (e.g. "CIE IGCSE
   Mathematics 0580"). Tutor-owned, shared by many classes. A class without one
   loses nothing.
2. **Library is a separate top-level destination**, alongside classes — not a
   panel inside a class. It holds syllabus-scoped, reusable materials plus the
   question bank. A library material becomes student-visible only by being
   attached to a session, which keeps the student-facing session-centric rule
   intact (CLAUDE.md domain rules carry the matching note).
3. **Each class gets a whiteboard** (tldraw/excalidraw). The board is saved at
   the end of a lesson and viewable afterwards by the class's students — a
   per-lesson artifact of an ongoing class surface.
4. **Homework becomes question sets, not only files.** An agent drafts a set
   from the syllabus question bank; **the tutor approves or swaps questions
   before anything is issued**. Draft-then-approve is the contract — homework
   never reaches a student untouched by the tutor.

---

## What the current schema already supports

These were added in CP1 specifically so the above wouldn't require a schema
rewrite. The columns and tables exist; **no behaviour is built**.

| Direction above | Existing seam |
|---|---|
| Session-based knowledge (notes, homework, submissions per lesson) | The whole model is session-centric already — materials, assignments and submissions each reach exactly one session |
| Content extraction from uploaded files | `attachments.extracted_text` + `extraction_status` (`none` today; nothing extracts) |
| Agent-authored feedback alongside tutor feedback | `feedback.author_type ∈ ('tutor','agent')` with a nullable `author_user_id`. v1 only ever writes tutor rows |
| Weakness/strength analytics | `topics` + `assignment_topics`. **Without topic tags there is nothing for analytics to aggregate on** — CLAUDE.md calls this the single most valuable hook in the list |
| Student performance over time | `submissions` are append-only and versioned, so improvement across resubmissions is measurable rather than overwritten |
| Any behavioural or usage signal | `events` is append-only with `actor_id`, `verb`, `subject_type`, `subject_id`, `payload jsonb` |

The practical consequence: **CP6 should ship topic tagging with assignments**,
even though nothing consumes it yet. Retrofitting tags onto historical
assignments means asking a tutor to re-tag a term's work, which they won't do.

## What would need new schema

| Direction above | What's missing |
|---|---|
| Syllabus + Library | No `syllabuses` table, no `classes.syllabus_id`, and no way for a material to belong to a syllabus instead of a session. The domain decision this required has now been **made** (see "Decided direction"): library materials are tutor-only and syllabus-scoped; attaching one to a session is what publishes it to students. Likely shape: attachments stay as-is, materials gain a second, mutually exclusive parent |
| Whiteboard per class, saved per lesson | Nothing stores board documents. Needs a board-state store (tldraw/excalidraw JSON — a new kind of attachment, not a file upload) plus a per-session saved snapshot; also the first new dependency this list actually forces |
| Question bank + drafted homework sets | No `questions` table. Questions are syllabus-scoped and topic-tagged — the existing `topics` seam is the tagging half of this. An assignment needs to reference a set of questions, not only attached files; the draft-then-approve step needs a status on that set |
| Tutor teaching approach, plans, goals | Nothing models tutor intent; today's schema records what happened, not what was planned |
| Onboarding survey at class creation | No survey/response tables |
| Time-to-exam behaviour | No exam date on a class |
| Timed practice papers | Assignments have no notion of a time limit or of being sat under conditions |
| Homework in one place (student portal / tutor review) | No new schema needed — these are **views**, not entities. Both are queries across existing tables plus routes |

Note that the last row is the cheapest item on this page and probably the most
immediately useful to a working tutor.

## Explicitly still out of bounds

Per CLAUDE.md, none of these enter the codebase during v1, regardless of how
much the direction above implies them:

- LLM SDKs, vector stores, embedding columns
- Auto-marking of any kind
- Analytics dashboards
- Multi-tutor agencies or organisations

The rule is *leave seams, not scaffolding*. Adding an unused dependency is
scaffolding; adding a nullable column the AI layer will need is a seam.

## Near-term engineering work

Not product features, but the things that would need doing before or alongside
any of the above. The full list with detail is in
[`status.md`](status.md#known-gaps):

1. Turn on email confirmations — the largest open security gap
2. Database backups
3. The Playwright happy path CLAUDE.md specifies
4. Storage garbage collection for orphaned objects
5. Email delivery monitoring
