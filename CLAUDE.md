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

Auto-marking, analytics dashboards, note editing, payments or invoicing, calendar sync, scheduling, notifications beyond one transactional email, in-app messaging, mobile apps, multi-tutor agencies or orgs, admin panels.

**LLM calls are permitted for exactly two purposes**: (1) mining topics and concepts out of a tutor-uploaded syllabus document (see Syllabus below), and (2) *question extraction* — transcribing the questions in a tutor-uploaded PDF and tagging each against that tutor's own syllabus (see Question extraction below). *Decided 2026-08 for (1): the one deliberate exception to the original "no LLM calls of any kind" rule. Decided 2026-11-11 for (2): greenlit for the question bank.* Both transcribe or organise what the tutor uploaded; neither invents content. No other AI feature (generating or solving questions, auto-marking, analytics, retrieval over materials, embeddings) is in scope until each is separately greenlit.

*Embedding-based concept deduplication was greenlit on 2026-08-06 and then **withdrawn on measurement**, before any code was written.* Calibrated against the real 736-concept corpus, plain string normalisation (singularise, unify apostrophes, sort tokens) found 45 of the 58 merges embeddings found, with better precision and better recall on plurals — no API call, no pgvector, no threshold. The evidence, including which embedding models are dead and why descriptions make it worse, is in [`docs/superpowers/specs/2026-08-06-concept-dedup-design.md`](docs/superpowers/specs/2026-08-06-concept-dedup-design.md). **Read that before proposing embeddings here again.**

**Detection never merges anything on its own.** However duplicates are found, they are ranked as candidates and the tutor decides whether two concepts are one. This is the same draft-then-approve contract homework question sets carry — the tool proposes, the tutor disposes.

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
| **Topic** | A tutor-curated unit of a syllabus (e.g. "Algebra"). Populated by LLM extraction from an uploaded document, by hand, or cloned from a preset. Every topic belongs to exactly one syllabus. Assignment tagging (not yet built) will pick from the topics of the syllabus a class follows. |
| **Concept** | A tutor-owned piece of vocabulary a topic references (e.g. "Quadratic Formula"). Not tied to one topic or one syllabus — the same concept can stretch across both, within that tutor's own account. The thing later analytics aggregate on. |
| **Cluster** | A group of a tutor's live concepts whose names share a normalised key (see Concept deduplication below) and that the tutor has not fully dismissed as non-duplicates. Derived on every read, never stored — a cluster has no id and no stable identity across requests. |
| **Tombstone** | A concept row soft-deleted by a merge, with `merged_into_id` pointing at the survivor it was merged into. Exists so a name that was merged away can be recognised on a later syllabus upload instead of being recreated. |
| **Syllabus** | An optional curriculum, tutor-owned and independent of any class (e.g. "CIE IGCSE Mathematics 0580") — a class without one is fully functional. Populated by uploading a document (LLM-extracted into topics/concepts), by hand, or from a Preset. *`classes.syllabus_id` — attaching a syllabus to a class — is not yet built; this is currently a standalone resource.* |
| **Preset** | A backend-authored syllabus template for a commonly tutored curriculum (e.g. Singapore's PSLE Mathematics). Lives as a static code fixture, not a database row. Selecting one deep-copies it into a new, fully independent tutor-owned syllabus. |
| **Library** | *(future — no code yet)* The tutor's own separate destination holding syllabus-scoped, reusable materials and the question bank (which already exists, on the syllabus, with no Library UI yet). A library material reaches students only by being attached to a session. |
| **Question** | A bank item: a stem (Markdown + LaTeX), its figures, exactly one topic (or untagged) and any concepts, all from one syllabus. Tutor-private and syllabus-scoped. Extraction only ever writes `draft`; the tutor approves. Students never read a question directly. |
| **Question part** | An ordered sub-part of a question — `(a)(i)` — with its own text, marks and answer. Never a bank item on its own; it lives and dies with its question. |
| **Question import** | One tutor-uploaded PDF and its extraction status (`pending → processing → done/failed`). A syllabus has many. |
| **Figure** | A diagram owned by a question. Gemini suggests a box on a source page; the tutor confirms the crop, which becomes an attachment. A question cannot be approved while a figure is unconfirmed. |

Never introduce synonyms. If a new concept is genuinely needed, add it to this table in the same commit.

## Domain rules

- Every material, assignment and submission is reachable from **exactly one session**. There is no global file manager and no free-floating uploads. *Decided 2026-07: the future Library relaxes this for tutors only — a library material is syllabus-scoped and tutor-visible. The student-facing half of the rule survives it: students only ever see a material through a session it was attached to.*
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
- **`lib/storage/objects.ts` takes the bucket explicitly** — there is more than
  one private bucket now (`materials`, `syllabus-documents`,
  `question-documents`), each declared the
  same twice-over way in `supabase/config.toml` + `lib/storage/config.ts`.

## Syllabus extraction (background, in-app)

- Uploading a syllabus document writes `syllabuses` with `extraction_status:
  "pending"`, then `lib/extraction/start.ts` runs the extraction with
  `after()` from `next/server` — **inside the same Vercel function, after the
  response has gone back to the tutor**. It calls Gemini and writes
  `topics`/`concepts`/`topic_concepts`. There is no queue and no separate
  process. *Decided 2026-11-13, reversing the original BullMQ + standalone
  `worker/` design* after the Railway worker went down over billing and left a
  live upload spinning forever: Fluid Compute lets `after()` work run to the
  route's `maxDuration`, which is enough because chunks run concurrently. This
  removed Railway, Upstash, `bullmq` and `ioredis` outright.
- **`export const maxDuration = 300` on both syllabus pages is load-bearing.**
  A Server Action runs with its page's segment config, so that is the budget the
  `after()` work gets. It also needs **Fluid Compute enabled on the Vercel
  project** — without it Hobby caps functions at 60s. Vercel Pro can raise
  `maxDuration` to 800 if large documents start timing out.
- **A killed function leaves nothing behind to write `failed`.** So a row still
  `pending`/`processing` past `STALE_AFTER_MS` (10 min, `lib/extraction/stale.ts`)
  is *read* as failed — derived in `lib/db/queries/syllabuses.ts`, never written
  by a sweeper — and the existing failed UI (pill + Retry) applies.
  `retryQuestionImport` accepts the same stale case, re-checked in SQL.
- **Retries are per Gemini call, not per job** (`lib/extraction/retry.ts`, 3
  attempts, 2s/6s). BullMQ used to re-run a whole failed job; now one flaky
  chunk retries alone. A missing key or a blocked prompt is not retried.
- Extraction needs `GEMINI_API_KEY` and the Supabase service-role key in the
  **Vercel** env now. Both are server-only: `lib/extraction/` must never be
  imported from a `"use client"` module.
- `scripts/` runs extraction outside Next, so it does not get `.env.local` for
  free — `scripts/env.ts` (dotenv) must be the *first* import in any script,
  before anything that reads env at module-load time (`lib/db/client.ts`
  throws immediately if `DATABASE_URL` is missing).
- `syllabuses.extraction_status` (`none | pending | processing | done | failed`)
  is a distinct enum from `attachments.extraction_status` — the latter tracks
  OCR-style text extraction (still unused, still v1's AI hook); this one tracks
  a structured pipeline that writes rows, not text.
- Presets (`lib/syllabus-presets/`) are static code fixtures, not DB rows —
  "create from preset" deep-copies a fixture into a new tutor-owned syllabus;
  the fixture and any other tutor's data are never touched by that copy.
- **PDFs are chunked structurally before extraction, not sent whole.**
  Whole-document extraction was producing topics too vague/generic — with the
  full document in context, the model filled gaps with what a syllabus for
  the subject "usually" covers instead of only what the document said.
  `lib/extraction/pdf-chunk.ts` splits the PDF into fixed-size, page-based windows (3
  pages, 1-page overlap — structural, not an LLM deciding boundaries
  semantically); each chunk gets its own `extractTopicsAndConcepts` call with
  an addendum telling it the chunk is a partial excerpt and it must return an
  empty `topics` array rather than infer beyond that excerpt's literal text.
  Chunks run fully concurrently (`Promise.all` in
  `lib/extraction/process-syllabus-extraction.ts`) — deliberately uncapped since
  the Gemini key is paid-tier, and nothing caps concurrent *uploads* any more
  either (the old worker ran 2 at a time). 429s are retried per chunk; add a
  cap if they start exhausting the retries. It then merges the per-chunk results by case-insensitive
  topic/concept name (the 1-page overlap means the same topic can
  legitimately reappear in two consecutive chunks). **PDF only** —
  `.txt`/`.doc`/`.docx` still go through the original single whole-document
  call; there is no chunking story for those yet.
- **Verified working locally end-to-end** (2026-08): a real document uploaded,
  extracted by Gemini, and written as topics/concepts, via
  `scripts/test-syllabus-pipeline.ts` (below).

### Model gotchas — learned by breaking it, do not pick a model by guessing

- **We now use `gemini-flash-latest`, not the lite tier** — *reversed 2026-08-04,
  alongside the chunking work.* The original rule here was to pin
  `gemini-flash-lite-latest`. That was dropped because lite produced topics too
  vague to be usable even chunk-by-chunk; `gemini-flash-latest` is the tier the
  H2 Math extraction was actually validated against. Re-check output quality
  against a real syllabus before changing this again.
- **Dated model names are actively being sunset.** `gemini-2.5-flash` and
  `gemini-2.0-flash` both now 404 on `generateContent` ("no longer available"),
  despite still appearing in `ListModels`. Don't pin a dated version; the
  `-latest` alias family is the only thing confirmed to keep working, and even
  that needs the guards below.
- **The guards in `lib/extraction/gemini-extract.ts` are load-bearing, not
  boilerplate**: `maxOutputTokens` + a `finishReason !== "STOP"` check exist
  because this model was reproduced going into a degenerate repetition loop —
  one field ballooning to ~49k tokens of repeated filler while still producing
  syntactically valid JSON that would otherwise pass validation silently.
  A `STOP` finishReason alone does not guarantee sane content.
- **Size caps and the degeneracy guard are deliberately separate — do not
  collapse them** (*reworked 2026-08-05*). `MAX_TOPICS` / `MAX_CONCEPTS_PER_TOPIC`
  and the Zod `.max()` lengths are generous and merely *truncate*; `isDegenerate`
  is what actually rejects a repetition loop, by detecting duplication (mostly
  repeated names, or a long field made of a handful of distinct tokens) rather
  than by size. The earlier design used tight caps as the guard, which is wrong
  in both directions: a cap tight enough to catch degenerate output also
  permanently drops a legitimately dense chunk, and re-running at
  `temperature: 0` reproduces the same rejection. Degeneracy throws (retryable);
  oversize trims.
- **There is deliberately no `sourceText` / verbatim-quote field on topics**
  (*tried and removed 2026-08-05*). A quote is only worth its output tokens if
  something can check it against the document, and nothing here can:
  `pdf-chunk.ts` slices pages as binary via `pdf-lib`, which has no text
  extraction API, and of the accepted MIME types only `text/plain` yields usable
  text from `fileBytes`. Requiring an unverifiable quote spends `maxOutputTokens`
  budget and loses legitimate topics — worst on scanned PDFs, where the model
  reads rendered images and may not reproduce a line character-for-character.
  If hallucinated topics show up in real output, add a text-extraction pass
  (`pdfjs-dist` `getTextContent()`, `mammoth` for `.docx`) carried alongside the
  bytes through the chunk boundary *first*, then reintroduce the field.
- **Schema-level per-field `description`s and marking `concepts` required in
  the `responseSchema` are also load-bearing.** Without them, the model was
  observed flattening a topic's own concepts into sibling top-level topics,
  and omitting the `concepts` array outright most of the time. Both went away
  once the nesting was spelled out explicitly in the schema, not just prose.
- If this breaks again after a future Gemini deprecation: re-run
  `scripts/test-syllabus-pipeline.ts` against a real sample doc, inspect
  `result.response.candidates[0].finishReason` and `usageMetadata` for a
  leaked-thinking or repetition signature before assuming it's a prompt
  problem.

### Testing without a UI

There is no Syllabi tab yet, and Server Actions can't be invoked directly from
curl/Postman (Next's internal encoding, not plain REST). Use
`scripts/test-syllabus-pipeline.ts` instead — a permanent, checked-in dev tool
(not a UI substitute) that seeds a real upload against one fixed reusable test
tutor account (`syllabus-pipeline-test@test.local`):

```
pnpm test:syllabus-pipeline <file.txt|.pdf|.doc|.docx> ["title"]   # seed, extract in-process, print
pnpm test:syllabus-pipeline --status <syllabusId>                  # check result
pnpm test:syllabus-pipeline --cleanup                               # wipe test data, keep the account
```

It runs the extraction in-process and prints the result; no dev server needed.

## Question extraction (background, in-app)

The question bank is built the same way, started by `startQuestionExtraction`.
Design and rationale:
[`docs/superpowers/specs/2026-11-11-question-bank-design.md`](docs/superpowers/specs/2026-11-11-question-bank-design.md).

- **The syllabus is a closed vocabulary, not prose context.** At job start
  extraction gives each live topic and concept a per-job handle (`T1…`, `C1…`,
  `lib/extraction/question-handles.ts`), lists them in the prompt, and constrains
  `topicRef`/`conceptRefs` in the `responseSchema` to `enum`s of those handles
  plus `NONE`. The model can never invent a tag and nothing fuzzy-matches a
  name. A syllabus with no concepts omits `conceptRefs` entirely — Gemini
  rejects an empty enum. A syllabus with no topics is refused at upload and
  fails the job (`NO_TOPICS_MESSAGE`).
- **The job is `{ importId }` only.** Tutor, syllabus and document are
  re-read from the `question_imports` row, never trusted from the caller.
- **PDF-only**, chunked by the same `pdf-chunk.ts` (3 pages, 1 overlap).
  `lib/extraction/merge-questions.ts` dedupes an overlap duplicate only when the
  normalised `(section, label)` matches **and** page ranges intersect — the
  same number far apart is two sections restarting their numbering. Answer-key
  entries are paired after the merge, never inside a model call; inline answers
  win; unpaired ones are counted on `question_imports.note`.
- **Same guards as topic extraction, separately tuned**: `maxOutputTokens`
  16384 (verbatim LaTeX is verbose), `isDegenerateQuestions` with deliberately
  conservative long-field thresholds because LaTeX matrices repeat tokens.
- **`thinkingConfig.thinkingBudget: 1024` is load-bearing** (*measured
  2026-11-11*). `gemini-flash-latest` is a reasoning model and its hidden
  thinking is billed against `maxOutputTokens`. Uncapped, a real 5-page
  tutorial spent 15727 of 16384 tokens thinking and left 643 for the answer —
  `MAX_TOKENS` on every attempt. A non-STOP finish now puts the
  answer/thinking/prompt token split in the error; read it before raising any
  limit. *`lib/extraction/gemini-extract.ts` (topics, 8192 cap) hit exactly this on a
  real syllabus on 2026-11-13 — MAX_TOKENS on all 3 attempts — and now carries
  the same 1024 cap. MAX_TOKENS is no longer retried: it reproduces every time.*
- **Section headings carry forward across chunks.** A chunk that starts past
  a heading never sees it; without carry-forward the overlap copy of a
  question keyed differently and survived as a duplicate.
- **Validated 2026-11-11** on RI H2 Math Tutorial 7B (5 pp.): 12/12 questions,
  every printed answer paired, marks and parts correct, Fig. 1 boxed.
- **Everything lands as a draft.** Slice 1 (this) has no UI; review/approve is
  slice 2, figure-crop confirmation (`pdfjs-dist`) slice 3.

```
pnpm test:question-pipeline <file.pdf> --syllabus <syllabusId>   # upload + extract as that syllabus's tutor
pnpm test:question-pipeline --status <importId>                  # print the extracted drafts
pnpm test:question-pipeline --cleanup <importId>                 # hard-delete ONE import and its questions (local DB only)
```

### Local buckets

**Adding a new private bucket needs `pnpm exec supabase seed buckets --local`
(or a real `supabase stop && supabase start`), not just an edit to
`supabase/config.toml`.** A `supabase start` that resumes
from an existing DB backup does NOT re-run bucket provisioning — only a
from-scratch init does. Data survives the stop/start (backed up to a Docker
volume), so this is safe, just non-obvious. (Symptom if skipped: `Bucket not
found` on first upload attempt against a brand new bucket.)

## Concept deduplication

A tutor's concepts accumulate across every syllabus they upload, and the same
idea shows up under slightly different names (`alcohol` / `alcohols`,
`coulomb's law` with a curly vs. straight apostrophe, `Inverse Matrix` /
`Matrix Inverse`). `/concepts` surfaces these as clusters; the tutor decides
whether to merge them. Nothing here runs automatically.

- **Detection is plain string work, by *measurement* — not because embeddings
  weren't tried.** `lib/concepts/normalise.ts`'s `normalisedKey(name)` is the
  entire detection rule: lowercase, unify apostrophes, strip a short stopword
  list, crudely singularise, map `-our` → `-or`, then dedupe and sort the
  remaining tokens. Two concepts are candidate duplicates **iff their keys are
  equal** — `clusterConcepts()` in `lib/concepts/cluster.ts` groups by that
  key, which is why grouping is transitive with no connected-components pass
  needed. An embedding/pgvector design was built out on paper first and
  calibrated against the real 736-concept corpus; normalisation alone found 45
  of the 58 merges embeddings found, with better precision and better recall
  on plurals — no API call, no extension, no threshold. Read the "Evidence"
  section of
  [`docs/superpowers/specs/2026-08-06-concept-dedup-design.md`](docs/superpowers/specs/2026-08-06-concept-dedup-design.md)
  before proposing embeddings here again — it also records which Gemini
  embedding models are outright dead on `embedContent`. The normalised key is
  never shown to a tutor and never used as a display name: the singulariser
  mangles words (`analysis` → `analysi`) in a way that's harmless for
  comparison but wrong to render.
- **The write path deliberately keeps exact `lower(name)` matching —
  normalisation informs review only, and never performs a merge itself.**
  `createConceptResolver` in `lib/db/concept-resolution.ts` still looks up a
  live concept by plain case-insensitive name. If it matched on the
  normalised key instead, extraction would silently collapse `alcohol` into
  `alcohols` with no tutor in the loop — the one thing this feature must never
  do. Detection only ranks candidates; the tutor decides whether two concepts
  are one. Same draft-then-approve contract homework question sets carry — the
  tool proposes, the tutor disposes.
- **`concepts.merged_into_id` is a tombstone, and it exists because
  `concepts_tutor_name_live_uidx` is partial** — the unique index is on
  `(tutor_id, lower(name)) where deleted_at is null`. A plain soft-delete would
  leave the merged-away name with no live row, so the next syllabus upload
  that emits that name would create a fresh row and re-propose the identical
  merge forever. Name-to-id resolution checks a tombstone match after the live
  match and follows `merged_into_id` instead of recreating the row. It lives in
  **`lib/db/concept-resolution.ts` and has exactly one implementation on
  purpose**: both writers of `concepts` — syllabus extraction and
  `createSyllabusFromPreset`'s deep copy — call `createConceptResolver(tx,
  tutorId)`. The preset path used to carry its own case-sensitive copy that
  followed no tombstone, which quietly recreated merged-away names; `lib/` is
  the shared home because `lib/extraction/` may import from it and must never
  import from `app/`. Merging
  also repoints any tombstone that already pointed at a loser to the new
  survivor, so a chain is exactly one hop and resolution needs no loop guard —
  **but that holds because `mergeConcepts` serialises merges, not by
  construction.** It re-selects the whole cluster `FOR UPDATE` inside its
  transaction and re-checks liveness there; a second merge over an overlapping
  cluster blocks on those locks, sees the first one's tombstones on release,
  and returns "That cluster changed" instead of writing. Authorizing outside
  the transaction alone would let two merges each tombstone the other's
  survivor, leaving two dead rows pointing at each other — a cycle
  `conceptIdFor` would follow into a soft-deleted row forever, with no undo in
  v1 to get out of it.
- **Rejections in `concept_merge_rejections` are pairwise, not per-cluster,
  because a cluster has no stable identity.** Clusters are derived on every
  read from live concepts plus rejected pairs, never stored; a rejection
  recorded against "the group" would also suppress a concept that joins the
  group later — one the tutor never actually looked at. A cluster is shown
  while it still contains at least one pair the tutor has not rejected, so a
  new arrival re-surfaces the cluster instead of inheriting a decision made
  before it existed. `pairKey()`/the sorted pair in `rejectCluster` and the
  table's `CHECK (concept_a_id < concept_b_id)` all rely on plain string `<`
  agreeing on the same canonical order.
- `mergeConcepts` repoints **`question_concepts`** exactly as it repoints
  `topic_concepts`, in the same transaction. Without it a merge silently untags
  every question that carried the loser.
- No undo in v1. Clearing `merged_into_id` and `deleted_at` would restore a
  tombstoned concept, but its `topic_concepts`/`question_concepts` links were
  already repointed to the survivor at merge time and are not recoverable from
  the tombstone alone.

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

**Extraction-only additions** (2026-08 for syllabus extraction, reused 2026-11 for
question extraction; greenlit alongside the LLM carve-outs above — not part of the "boring and well-trodden" v1 stack, and not a
precedent for adding AI tooling elsewhere without asking again):

- `@google/generative-ai` (Gemini) — only ever imported from `lib/extraction/`,
  which only Server Actions reach (through `start.ts`). Never from a client
  component.
- **Approved 2026-11-11, not yet installed:** `katex` (render LaTeX in the
  question review UI, slice 2) and `pdfjs-dist` (client-side page rendering for
  figure-crop confirmation, slice 3).
- `pdf-lib` — only ever imported from `lib/extraction/pdf-chunk.ts`, used to slice an
  uploaded PDF into page-range sub-documents for structural chunking (see
  Syllabus extraction above)
- *Removed 2026-11-13:* BullMQ, `ioredis`, the Railway worker and Upstash
  Redis. Extraction runs in-app (see Syllabus extraction above). Don't
  reintroduce a queue for scale you don't have; if you ever need one, a jobs
  table in Postgres is the next step, not another hosted service.

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
pnpm test:syllabus-pipeline   # seed + extract + print a real extraction, no UI needed
pnpm test:question-pipeline   # same for question extraction (needs an existing syllabus with topics)
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
  (tutor)/              # tutor-only: dashboard, classes/[classId], syllabi/[syllabusId]
  (student)/            # student-only: student
  sessions/[sessionId]/ # session detail — ONE route, serves both roles
  invite/accept/        # invitation acceptance (NOT under (auth))
  auth/confirm/         # email-link verification (token_hash flow)
  api/                  # route handlers: materials download
lib/
  auth/                 # session, roles, guards, request origin, recovery gate, THE authz helper
  db/
    schema.ts           # all 23 tables
    queries/            # all reads — each authorizes before returning rows
    migrations/         # drizzle-owned; there is no supabase/migrations
  storage/              # private buckets (materials, syllabus-documents, question-documents), opaque keys, signed URLs
  extraction/           # syllabus + question extraction: Gemini calls, chunking, start (after()), retry, stale
  syllabus-presets/      # static preset fixtures, not DB rows
  validation/           # zod schemas
components/             # shell (top-bar, page, auth-card), forms, date rendering
  ui/                   # shadcn primitives + the app's own (panel/row, pill, ext-chip, form-dialog)
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

Do **not** add LLM SDKs, vector stores, or embedding columns in v1. The syllabus
stage carries the Gemini SDK under the carve-out above; that is the only
exception, and it does not extend to vectors. *Tested 2026-08-06 and left
standing* — pgvector was greenlit for concept deduplication, then measured
against the real corpus and found to lose to plain string normalisation. See the
design doc referenced at the top of this file.

## Testing

- Every authorization rule gets a test, and the suite must include **negative** cases: student A cannot read student B's submission; tutor A cannot read tutor B's class; a student cannot issue an assignment. 232 tests today, mostly authorization; the rest are pure unit tests (concept normalisation/clustering, extraction merge/retry/staleness, question handles/merge, identity headers).
- One Playwright happy path end to end: tutor creates class → invites student → creates session → uploads material → issues assignment; student accepts invite → downloads material → submits → tutor sees the submission. **Not built yet** — `pnpm test:e2e` has no config or specs behind it. Coverage today is unit-level authz plus manual verification.

## Working agreement

- Propose a plan before any large change. Propose a **schema diff** before running a migration.
- Work in vertical slices that are individually demoable. Do not build the whole app in one pass.
- Small commits, conventional commit messages.
- Ask before: adding a dependency, changing the schema, introducing a new architectural pattern, or touching auth.
- Keep this file current. When a decision here turns out wrong, update it in the same commit that changes the code.