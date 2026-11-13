# Question bank per syllabus — design

**Status:** design approved in brainstorming 2026-11-11; spec awaiting review.
**Scope:** slices 1–3 below. Using questions as homework is CP6 and is not part
of this spec.

## Why

Tutors want a bank of practice questions for each syllabus, built by uploading
the PDFs they already use (past exam papers, worksheets) instead of typing
questions in. Questions end up as homework, so they have to be good enough to
show a student: maths as LaTeX, and diagrams as real images inside the question,
not "see page 4".

The open problem was how to get the syllabus's topics into the model's context.
The answer here is a **closed vocabulary**. The model is shown the syllabus's
topics and concepts as short per-job handles, and the response schema only
accepts those handles. It cannot invent a tag, so nothing downstream ever
fuzzy-matches a name.

## Scope change to CLAUDE.md

CLAUDE.md allows LLM calls for exactly one purpose: mining topics and concepts
from a syllabus document. This feature adds a **second** purpose: extracting
questions from a tutor-uploaded PDF and tagging them against that tutor's
syllabus. It was greenlit on 2026-11-11. The carve-out paragraph, the stack
section and the vocabulary table are amended in the slice 1 commit. Nothing else
is greenlit by this: no generating new questions, no auto-marking, no
embeddings.

## Decisions

| Question | Decision | Why |
|---|---|---|
| Source PDFs | Exam papers **and** worksheets | Sub-parts and marks are therefore optional everywhere |
| Diagrams | Images owned by the question. Gemini suggests a box; the tutor confirms or adjusts it on the rendered page; the browser crops and uploads | Exam diagrams are mostly vector line art, so pulling embedded images out of the PDF finds little. Unchecked automatic crops risk a clipped diagram reaching a student |
| Answers | Extracted only when they're in the same PDF (inline, or an answer key at the back) | Matching a separate mark scheme to question parts is its own problem; it's a later slice |
| Tagging | Exactly **one topic** (or none → tutor assigns), plus **0..n concepts** | Concepts are what later analytics aggregate on; one topic keeps browsing simple |
| Bank unit | A whole question (stem, figures, topic) with ordered **parts** | Parts never lose their shared stem or diagram; homework picks whole questions |
| Review | Everything lands as a **draft**; only the tutor approves | The same contract as concept merges and homework sets: the tool proposes, the tutor disposes |
| Dependencies | `pdfjs-dist` (browser only), `katex` | Both approved 2026-11-11 |

## Extraction pipeline

Same shape as syllabus extraction: the Next app produces, `worker/` consumes.

```
tutor uploads PDF ─► requestQuestionImportUpload  (authorize, mint signed upload URL)
                 ─► browser PUTs bytes straight to storage
                 ─► confirmQuestionImportUpload   (authorize, statObject, write
                                                   attachment + question_imports
                                                   row as pending, enqueue)
worker ─► processQuestionExtraction
          1. mark processing; load attachment, syllabus, live topics + concepts
          2. build handle table   T1..Tn, C1..Cm
          3. chunkPdfByPages (unchanged: 3 pages, 1 overlap)
          4. Promise.all: extractQuestions(chunk, handles)  ← Gemini
          5. mergeQuestionChunks (pure)
          6. one transaction: write questions, parts, concepts, figures as drafts
          7. mark done (or failed + error, rethrow for BullMQ retry)
```

**Only PDFs.** Worksheets and papers arrive as PDFs, and the figure workflow
needs pages to render. The upload accepts `application/pdf` only.

### Syllabus as context: the handle table

At step 2 the worker reads the syllabus's **live** topics in `order_index`
order, and their live concepts through `topic_concepts`. It assigns handles in
that order (`T1`, `T2`…, and `C1`, `C2`… across the whole syllabus, deduplicated
because one concept can sit under several topics). The prompt lists them:

```
TOPICS
T1: quadratic functions — discriminant (C1), completing the square (C2)
T2: vectors — scalar product (C3), …
```

The `responseSchema` makes the constraint structural:

- `topicRef`: STRING, `enum: ["T1", …, "Tn", "NONE"]`
- `conceptRefs`: ARRAY of STRING, `enum: ["C1", …, "Cm"]`. Any concept in the
  syllabus, not only the chosen topic's, because exam questions cross topics

Handles exist only inside one job and map back to ids in the same process, so
they are never stored or reused. A syllabus with **no topics** fails the import
with a clear error ("add topics to this syllabus first"). Extracting untagged
questions would make every question something the tutor has to file by hand.

If a topic or concept is deleted between step 1 and step 6, its question lands
untagged, or loses that concept. The write step re-checks liveness inside the
transaction.

### Per-chunk output (Zod-validated)

```ts
{
  questions: Array<{
    sectionLabel?: string        // "Exercise 2B", "Section A" — disambiguates repeated numbering
    label: string                // "3", "Q3"
    stem: string                 // Markdown + LaTeX ($…$, $$…$$); "[figure 1]" placeholders
    topicRef: "T1" | … | "NONE"
    conceptRefs: string[]
    startPage: number; endPage: number   // chunk-relative, 1-indexed
    figures: Array<{ page: number; box2d: [ymin, xmin, ymax, xmax] }>  // 0–1000 normalised
    parts: Array<{ label: string; body: string; marks?: number; answer?: string }>
    answer?: string              // for a question with no parts
  }>
  answers: Array<{ sectionLabel?: string; questionLabel: string; partLabel?: string; answer: string }>
}
```

`answers` carries answer-key entries found away from their question, for
example at the back of a worksheet. They're usually in a different chunk, so
they are paired during the merge, not inside the model call.

### Prompt rules (to be validated on real papers)

- Transcribe questions; never solve, rephrase or invent one. A chunk with no
  questions returns empty arrays.
- A question cut off at the end of the chunk is still emitted with what's
  visible; the merge keeps the more complete copy.
- Maths goes in LaTeX. Tables as Markdown tables.
- One `[figure n]` placeholder per figure, numbered in reading order within
  the question, matching the `figures` array order.
- Pick the single best topic, or `NONE` if no topic fits. Never force a fit.
- Exclude cover pages, instructions to candidates, formula sheets, and blank
  answer spaces.
- The chunk addendum carries over: a partial excerpt, pages X–Y of N.

### Merge (`worker/merge-questions.ts`, pure)

1. Convert chunk-relative pages and figure pages to absolute pages.
2. Key = normalised `(sectionLabel, label)`: lowercase, strip `Q`/`question`,
   whitespace and trailing punctuation. When two chunks emit the same key,
   keep the copy with more parts, tie-broken by longer stem. These are overlap
   duplicates.
3. Pair `answers[]` onto a question, or a part by normalised `partLabel`
   (`(a)(i)` ≈ `a(i)` ≈ `ai`). An answer already present inline wins. Unpaired
   answers are dropped, and their count is recorded on the import
   (`question_imports.note`).
4. Order by first appearance (absolute start page, then label).

### Guards

The same as `worker/gemini-extract.ts`, and for the same reasons: `blockReason`
check, `finishReason !== "STOP"` throws, Zod parse, `isDegenerate`, which is
adapted to flag mostly-duplicated labels or stems and a long field made of a few
distinct tokens. Model `gemini-flash-latest`, `temperature: 0`.
`maxOutputTokens` starts at 16384, because LaTeX transcription is verbose; it is
tuned on real papers in slice 1. Size caps truncate and degeneracy throws; the
two are kept separate.

## Data model

New enums: `question_import_status` (`pending | processing | done | failed`)
and `question_status` (`draft | approved`).

| Table | Columns | Notes |
|---|---|---|
| `question_imports` | id, syllabus_id, tutor_id, source_attachment_id, status, error, note, timestamps, deleted_at | One per uploaded PDF. A syllabus has many, so this status can't live on `syllabuses` the way topic extraction's does |
| `questions` | id, syllabus_id, tutor_id, import_id (null), topic_id (null), section_label (null), label, stem, status, source_page_start, source_page_end, order_index, timestamps, deleted_at | `tutor_id` denormalised like `topics`. `import_id` is null for questions typed by hand later. `topic_id` null means untagged |
| `question_parts` | id, question_id, label, body, marks (null int), answer (null), order_index | Cascades with its question. Questions are soft-deleted; parts are never independently user-deleted |
| `question_concepts` | question_id, concept_id (PK both) | Concept merges must repoint these too; see below |
| `question_figures` | id, question_id, page, suggested_box (jsonb `[ymin,xmin,ymax,xmax]`), attachment_id (null), order_index | `attachment_id` stays null until the tutor confirms the crop |

A question with no parts stores its answer on a single unlabeled part. That
keeps `answer` in one place.

**Approval invariant**, enforced in `approveQuestion` and not by the database:
topic set, every figure has an `attachment_id`, stem non-empty.

**Concept merge interaction.** `mergeConcepts` repoints `topic_concepts` from
losers to the survivor. It must do the same for `question_concepts`, in the
same transaction, with `ON CONFLICT DO NOTHING`. Otherwise a merge would
silently untag questions. This is part of slice 1.

**Storage.** A new private bucket `question-documents` holds source PDFs and
figure crops. It allows `application/pdf` and `image/png`, with a 25 MiB cap.
It is declared twice as usual (`supabase/config.toml` and
`lib/storage/config.ts`) and needs a real `supabase stop && supabase start`
locally, plus one-time creation on the cloud project (deploy.md). Object keys
are opaque.

**Bank visibility.** It is private to the tutor and scoped to the syllabus.
There is no cross-tutor sharing and there are no question presets. Students
never read questions directly; in CP6 they will only see a question through an
assignment.

## Review UI (slice 2)

`app/(tutor)/syllabi/[syllabusId]/questions/` is one page. It shows the import
list (status, failure reason, retry), then questions grouped by topic, with
**untagged first**, drafts badged. Each question can be edited (stem, parts,
marks, answer, topic, concepts), approved, or deleted (soft delete). Approve is
disabled with a reason while a figure is unconfirmed or the topic is unset.
LaTeX renders through KaTeX. Reads go in `lib/db/queries/questions.ts`, and each
authorizes before returning rows. Destructive actions sit in the quiet footer
row, per the existing UI rule.

## Figure confirmation (slice 3)

A client component, which needs a canvas and pointer drag, renders the source
page with `pdfjs-dist` from a short-lived signed URL. It overlays Gemini's
suggested box and lets the tutor drag or resize it. On save, the browser crops
the rendered canvas to PNG, `requestFigureUpload` mints a signed upload URL
after an authz check, the browser uploads, and `confirmFigureUpload` re-reads
size and MIME with `statObject`, writes the `attachments` row and sets
`question_figures.attachment_id`. A mismatch deletes the object and writes
nothing, the same rule as materials. A suggested box is clamped to the page.
"No figure here" deletes the figure row and its placeholder.

## Authorization

Every action is tutor-only, and ownership resolves through
`syllabuses.tutor_id`. Each follows parse → authorize → mutate → revalidate.
The enqueue action authorizes before minting the job, because the worker trusts
the ids in the payload (CLAUDE.md, Upstash note). The worker re-derives
`tutor_id` from the syllabus row and never from the payload. The signed URL for
the source PDF in slice 3 is minted only after ownership of the question is
checked.

## Testing

- **Authz (negatives included):** tutor B cannot list, read, edit, approve,
  delete, upload to, retry an import on, or confirm a figure on tutor A's bank.
  A student can do none of these. Approve refuses while a figure is unconfirmed
  or the topic is null.
- **Unit (pure):** handle table build and reverse mapping (dedup of shared
  concepts, `NONE`, unknown handle rejected by Zod); label normalisation;
  overlap merge (keeps more complete copy); page offsetting; answer pairing
  (inline wins, part-label variants, unpaired counted); `isDegenerate` for
  questions; concept merge repointing `question_concepts`.
- **Pipeline (manual):** `pnpm test:question-pipeline <file.pdf> --syllabus
  <id>` / `--status <importId>` / `--cleanup` against a real H2 Math paper and a
  worksheet with an answer key. Check topic choices, LaTeX fidelity,
  part/marks structure, answer pairing, and whether the boxes are plausible.

## Slices

1. **Extraction to drafts.** Schema and migration (diff shown before
   migrating), bucket, upload/confirm/retry actions, `lib/queue/question-extraction.ts`
   (producer, fail-fast connection like the syllabus queue),
   `worker/gemini-extract-questions.ts`, `worker/merge-questions.ts`,
   `worker/process-question-extraction.ts`, a second `Worker` in
   `worker/index.ts`, `question_concepts` repointing in `mergeConcepts`, the
   pipeline script, and CLAUDE.md and status.md updates. Demo: script output
   from a real paper.
2. **Review UI.** `katex`. Demo: upload in the UI, edit, tag, approve.
3. **Figure confirmation.** `pdfjs-dist`. Demo: confirm a crop, approve a
   question with a figure.

## Out of scope

Separate mark schemes; generating or paraphrasing questions; difficulty
ratings (a nullable column can be added when there's a real source for it);
non-PDF inputs; using questions in homework (CP6); a Library destination; any
student-facing view.

## Risks

- **Box accuracy** is unknown until slice 1 runs on real papers. The tutor
  confirm step absorbs it either way.
- **Boundary errors** (a question split across chunks with neither copy
  complete). If real papers show this, move to two-pass segmentation (segment,
  then one call per question). That changes the worker only, not the schema.
- **Large syllabi** make large enums. A ~150-concept syllabus is fine; revisit
  if a syllabus passes several hundred concepts.
- **Copyright.** Past papers belong to exam boards. Banks are private to one
  tutor's account and never shared, which matches how tutors already use these
  papers.
