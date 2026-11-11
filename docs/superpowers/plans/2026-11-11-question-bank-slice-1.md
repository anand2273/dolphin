# Question Bank — Slice 1 (Extraction to Drafts) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A tutor-uploaded PDF (an exam paper or a worksheet) is turned by the worker into **draft** questions in the database: parts, marks, same-PDF answers, one topic and some concepts tagged from the syllabus's own closed vocabulary, and suggested figure boxes. Slice 1 has no UI; it is exercised by a pipeline script.

**Architecture:** This mirrors syllabus extraction. A Server Action authorizes, has the browser upload straight to a private bucket, re-stats the object, writes a `question_imports` row, and enqueues `{ importId }` on a new BullMQ queue. The standalone `worker/` loads the syllabus's live topics and concepts and gives each a short per-job handle (`T1…`, `C1…`). It sends each 3-page PDF chunk to Gemini with a `responseSchema` whose tag fields are enums of those handles, then merges the chunks with pure functions. It writes questions, parts, concepts and figures in one transaction.

**Tech Stack:** Next.js Server Actions, Drizzle/Postgres, Supabase Storage, BullMQ + ioredis, `@google/generative-ai` (worker only), `pdf-lib` (existing `worker/pdf-chunk.ts`), Zod, Vitest.

**Spec:** `docs/superpowers/specs/2026-11-11-question-bank-design.md`. Read it first; this plan builds on it.

## Global Constraints

- **No new dependencies in this slice.** `katex` and `pdfjs-dist` belong to slices 2 and 3.
- `@google/generative-ai` is imported **only** from `worker/`. `worker/` may import from `lib/`, never from `app/`. `app/` and `lib/` never import from `worker/`.
- Every Server Action: **parse with Zod → authorize → mutate → revalidate.** Actions return typed results and never throw on expected failures.
- The client's claims about a file are never recorded: the confirm step re-reads size and MIME with `statObject`, and on a mismatch it deletes the object and writes no rows.
- Object keys come from `generateObjectKey()`. The original filename is metadata only.
- Soft delete (`deleted_at`) on user-visible rows (`question_imports`, `questions`).
- Gemini: `gemini-flash-latest`, `temperature: 0`. Keep the `blockReason` and `finishReason !== "STOP"` checks, Zod validation and the degeneracy guard. Size caps truncate; degeneracy throws. Don't merge the two.
- Producer Redis connection fails fast (`maxRetriesPerRequest: 3`, `enableOfflineQueue: false`). The worker's connection uses `maxRetriesPerRequest: null`. **Do not make them symmetric.**
- **Show the user the generated migration SQL and wait for approval before running `pnpm db:migrate`.**
- Never run `pnpm build` (it clobbers the dev server's `.next`). Never start `pnpm dev`; the user manages it. Verify with `pnpm typecheck` and `pnpm test`.
- Commits: conventional messages, small, **no `Co-Authored-By` trailer** (user preference).
- Vocabulary: the names **Question**, **Question part**, **Question import** and **Figure** are used exactly as written in DB, code and docs. No synonyms ("item", "problem", "exercise").

## Review Focus

The five inputs most likely to bite a real tutor that the spec implies but doesn't spell out. Each has a pinned test in the task named.

1. **The same question number appears twice, far apart, with no section label** (e.g. Section A Q1–10 and Section B Q1–10, where the model omitted `sectionLabel`). These must stay two questions; overlap dedup only fires when page ranges intersect. *Pinned in Task 4.*
2. **Gemini returns a nonsense figure box**: inverted, out of 0–1000, the wrong length, or null. The figure row survives with a `null` box (the tutor draws it in slice 3) and nothing crashes. *Pinned in Task 4.*
3. **Answer-key labels formatted differently from question labels** (`Q3(a)(ii)` vs `3`, `a ii`). These still pair. An entry repeated by the chunk overlap is counted once, and inline answers win. *Pinned in Task 4.*
4. **The syllabus has no live topics** at upload time or by the time the job runs. Upload is refused with a readable message; the job fails with the same message before any Gemini call. *Pinned in Tasks 7 and 8.*
5. **A job delivered again after it already committed** (a BullMQ retry after a crash post-commit, or a duplicate enqueue). No duplicate questions; the import stays `done`. *Pinned in Task 7.*

---

## File Structure

| File | Responsibility |
|---|---|
| `lib/db/schema.ts` (modify) | 2 enums + 5 tables |
| `lib/db/migrations/0004_*.sql` (generated) | migration |
| `lib/storage/config.ts`, `supabase/config.toml` (modify) | `question-documents` bucket, declared twice |
| `lib/auth/authz.ts` (modify) | `assertQuestionImportOwner` |
| `lib/validation/question.ts` (create) | Zod input schemas + `NO_TOPICS_MESSAGE` |
| `lib/queue/connection.ts` (create) | shared fail-fast **producer** connection |
| `lib/queue/syllabus-extraction.ts` (modify) | use the shared connection |
| `lib/queue/question-extraction.ts` (create) | queue name, job type, `enqueueQuestionExtraction` |
| `worker/question-handles.ts` (create, pure) | vocabulary → handles, prompt block, handle → id |
| `worker/question-schema.ts` (create, pure) | per-job Zod + Gemini `responseSchema`, `isDegenerateQuestions`, `truncateQuestions` |
| `worker/merge-questions.ts` (create, pure) | label normalisation, page offsetting, box clamping, overlap merge, answer pairing |
| `worker/gemini-extract-questions.ts` (create) | prompt + the one Gemini call, guards |
| `worker/process-question-extraction.ts` (create) | consumer: load, chunk, extract, merge, write |
| `worker/index.ts` (modify) | register a second `Worker` |
| `app/(tutor)/syllabi/[syllabusId]/questions/actions.ts` (create) | request/confirm upload, retry |
| `app/(tutor)/concepts/actions.ts` (modify) | merge repoints `question_concepts` |
| `scripts/test-question-pipeline.ts` (create), `package.json` (modify) | dev harness |
| `tests/questions.handles.test.ts`, `tests/questions.merge.test.ts`, `tests/authz.question.test.ts`, `tests/questions.worker.test.ts`, `tests/concepts.merge-questions.test.ts` (create) | tests |
| `CLAUDE.md`, `docs/status.md`, `docs/deploy.md` (modify) | docs |

---

### Task 1: Schema, migration, bucket config

**Files:**
- Modify: `lib/db/schema.ts` (add after `conceptMergeRejections`, before `events`; enums next to `syllabusExtractionStatus` at ~line 107)
- Generate: `lib/db/migrations/0004_*.sql`
- Modify: `lib/storage/config.ts` (after the syllabus-documents block, ~line 76)
- Modify: `supabase/config.toml` (after `[storage.buckets.syllabus-documents]`, ~line 147)

**Interfaces:**
- Produces: tables `questionImports`, `questions`, `questionParts`, `questionConcepts`, `questionFigures`; enums `questionImportStatus`, `questionStatus`; `QUESTION_DOCUMENTS_BUCKET`, `QUESTION_IMPORT_MIME_TYPES`, `isAllowedQuestionImportMimeType`, `QUESTION_IMPORT_ACCEPT_ATTRIBUTE`, type `Box2d`.

- [ ] **Step 1: Add the enums** next to `syllabusExtractionStatus`:

```ts
/**
 * Progress of one uploaded question document through the async worker. Lives
 * on `question_imports`, not on `syllabuses`: a syllabus collects many papers,
 * each with its own outcome.
 */
export const questionImportStatus = pgEnum("question_import_status", [
  "pending",
  "processing",
  "done",
  "failed",
]);

/** Draft-then-approve: extraction only ever writes drafts; the tutor approves. */
export const questionStatus = pgEnum("question_status", ["draft", "approved"]);
```

- [ ] **Step 2: Add the tables** after `conceptMergeRejections`:

```ts
/* -------------------------------------------------------------------------- */
/* Question bank — syllabus-scoped, tutor-private. See                         */
/* docs/superpowers/specs/2026-11-11-question-bank-design.md.                  */
/* -------------------------------------------------------------------------- */

/** [ymin, xmin, ymax, xmax], each 0–1000, normalised to the page. Gemini's convention. */
export type Box2d = [number, number, number, number];

export const questionImports = pgTable(
  "question_imports",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    syllabusId: uuid("syllabus_id")
      .notNull()
      .references(() => syllabuses.id, { onDelete: "cascade" }),
    tutorId: uuid("tutor_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    sourceAttachmentId: uuid("source_attachment_id")
      .notNull()
      .references(() => attachments.id, { onDelete: "restrict" }),
    status: questionImportStatus("status").notNull().default("pending"),
    error: text("error"),
    // Non-fatal outcome worth showing the tutor, e.g. unmatched answer-key entries.
    note: text("note"),
    ...timestamps,
    ...softDelete,
  },
  (t) => [index("question_imports_syllabus_id_idx").on(t.syllabusId)],
);

export const questions = pgTable(
  "questions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    syllabusId: uuid("syllabus_id")
      .notNull()
      .references(() => syllabuses.id, { onDelete: "cascade" }),
    // Denormalised from the syllabus so ownership checks don't need a join (as topics).
    tutorId: uuid("tutor_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    // Null for a question typed in by hand (later slice).
    importId: uuid("import_id").references(() => questionImports.id, {
      onDelete: "set null",
    }),
    // Null = untagged; the tutor assigns one before approving. A topic is
    // soft-deleted in practice, so readers must treat a dead topic as untagged.
    topicId: uuid("topic_id").references(() => topics.id, { onDelete: "set null" }),
    sectionLabel: text("section_label"),
    label: text("label").notNull(),
    // Markdown + LaTeX, with "[figure n]" placeholders matching question_figures.order_index + 1.
    stem: text("stem").notNull(),
    status: questionStatus("status").notNull().default("draft"),
    sourcePageStart: integer("source_page_start"),
    sourcePageEnd: integer("source_page_end"),
    orderIndex: integer("order_index"),
    ...timestamps,
    ...softDelete,
  },
  (t) => [
    index("questions_syllabus_id_idx").on(t.syllabusId),
    index("questions_topic_id_idx").on(t.topicId),
  ],
);

/**
 * Parts are never independently user-deleted: they live and die with their
 * question (which is soft-deleted), so no deleted_at here. A question with no
 * parts but an answer stores it on one part with an empty label and body, so
 * `answer` has exactly one home.
 */
export const questionParts = pgTable(
  "question_parts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    questionId: uuid("question_id")
      .notNull()
      .references(() => questions.id, { onDelete: "cascade" }),
    label: text("label").notNull().default(""),
    body: text("body").notNull().default(""),
    marks: integer("marks"),
    answer: text("answer"),
    orderIndex: integer("order_index").notNull(),
    ...timestamps,
  },
  (t) => [
    index("question_parts_question_id_idx").on(t.questionId),
    check("question_parts_marks_nonneg", sql`${t.marks} is null or ${t.marks} >= 0`),
  ],
);

/** Concept merges repoint these too — see mergeConcepts in app/(tutor)/concepts/actions.ts. */
export const questionConcepts = pgTable(
  "question_concepts",
  {
    questionId: uuid("question_id")
      .notNull()
      .references(() => questions.id, { onDelete: "cascade" }),
    conceptId: uuid("concept_id")
      .notNull()
      .references(() => concepts.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.questionId, t.conceptId] })],
);

/**
 * A diagram belonging to a question. `suggestedBox` is Gemini's guess (null if
 * it gave nothing usable); `attachmentId` stays null until the tutor confirms a
 * crop (slice 3). Approval requires every figure to have an attachment.
 */
export const questionFigures = pgTable(
  "question_figures",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    questionId: uuid("question_id")
      .notNull()
      .references(() => questions.id, { onDelete: "cascade" }),
    page: integer("page").notNull(), // absolute, 1-indexed, in the import's source PDF
    suggestedBox: jsonb("suggested_box").$type<Box2d>(),
    attachmentId: uuid("attachment_id").references(() => attachments.id, {
      onDelete: "restrict",
    }),
    orderIndex: integer("order_index").notNull(),
    ...timestamps,
  },
  (t) => [index("question_figures_question_id_idx").on(t.questionId)],
);
```

- [ ] **Step 3: Declare the bucket in `lib/storage/config.ts`** after `SYLLABUS_DOCUMENT_ACCEPT_ATTRIBUTE`:

```ts
/**
 * Private bucket for the question bank: uploaded source PDFs, and (slice 3)
 * tutor-confirmed figure crops. Declared again on the bucket itself in
 * supabase/config.toml; change both.
 */
export const QUESTION_DOCUMENTS_BUCKET = "question-documents";

/** Imports are PDF-only: figure confirmation needs real pages to render. */
export const QUESTION_IMPORT_MIME_TYPES = ["application/pdf"] as const;

export type QuestionImportMimeType = (typeof QUESTION_IMPORT_MIME_TYPES)[number];

export function isAllowedQuestionImportMimeType(
  value: string,
): value is QuestionImportMimeType {
  return (QUESTION_IMPORT_MIME_TYPES as readonly string[]).includes(value);
}

export const QUESTION_IMPORT_ACCEPT_ATTRIBUTE = QUESTION_IMPORT_MIME_TYPES.join(",");
```

- [ ] **Step 4: Declare the bucket in `supabase/config.toml`** after the `syllabus-documents` block:

```toml
[storage.buckets.question-documents]
public = false
file_size_limit = "25MiB"
# PDFs are question imports; PNGs are tutor-confirmed figure crops (slice 3).
allowed_mime_types = [
  "application/pdf",
  "image/png",
]
```

- [ ] **Step 5: Generate the migration**

Run: `pnpm db:generate`
Expected: a new `lib/db/migrations/0004_<name>.sql` that creates 2 enums and 5 tables, their FKs, the 4 indexes and the CHECK, and touches nothing else.

- [ ] **Step 6: STOP — show the user the generated SQL** (`cat lib/db/migrations/0004_*.sql`) and wait for explicit approval. Do not migrate before that.

- [ ] **Step 7: Apply locally and typecheck**

Run: `pnpm db:migrate && pnpm typecheck && pnpm test`
Expected: the migration applies; typecheck is clean; the existing 136 tests pass.

- [ ] **Step 8: Commit**

```bash
git add lib/db/schema.ts lib/db/migrations lib/storage/config.ts supabase/config.toml
git commit -m "feat(db): question bank tables and question-documents bucket"
```

---

### Task 2: Ownership helper + validation schemas

**Files:**
- Modify: `lib/auth/authz.ts` (after `assertConceptsOwned`)
- Create: `lib/validation/question.ts`
- Modify: `tests/helpers/seed.ts` (shared `insertImport`, `teardownTutor`)
- Test: `tests/authz.question.test.ts`

**Interfaces:**
- Consumes: `questionImports`, `syllabuses` (Task 1)
- Produces: `assertQuestionImportOwner(userId: string, importId: string): Promise<QuestionImport>`, `type QuestionImport`; `requestQuestionImportUploadSchema`, `confirmQuestionImportUploadSchema`, `retryQuestionImportSchema`, `NO_TOPICS_MESSAGE`

- [ ] **Step 1: Add shared seed helpers** to `tests/helpers/seed.ts`. Tasks 7, 8 and 9 reuse them; never import helpers from another `*.test.ts` file, because that also registers its `describe` blocks. Add `attachments, questionImports` to its schema import, plus `import { generateObjectKey } from "@/lib/storage/objects";` and `import { QUESTION_DOCUMENTS_BUCKET } from "@/lib/storage/config";`, then append:

```ts
/** Insert an attachment + question import for a tutor's syllabus. No storage object is created. */
export async function insertImport(
  tutorId: string,
  syllabusId: string,
  status: "pending" | "processing" | "done" | "failed" = "pending",
): Promise<{ importId: string; attachmentId: string }> {
  const [attachment] = await db
    .insert(attachments)
    .values({
      bucket: QUESTION_DOCUMENTS_BUCKET,
      objectKey: generateObjectKey(),
      originalFilename: "paper.pdf",
      mimeType: "application/pdf",
      sizeBytes: 1000,
      uploadedByUserId: tutorId,
    })
    .returning({ id: attachments.id });
  const [row] = await db
    .insert(questionImports)
    .values({ syllabusId, tutorId, sourceAttachmentId: attachment.id, status })
    .returning({ id: questionImports.id });
  return { importId: row.id, attachmentId: attachment.id };
}

/** Syllabus first (cascades imports/questions), then attachments (restrict on profiles), then the user. */
export async function teardownTutor(user: TestUser) {
  await db.delete(syllabuses).where(eq(syllabuses.tutorId, user.id));
  await db.delete(attachments).where(eq(attachments.uploadedByUserId, user.id));
  await deleteTestUser(user);
}
```

- [ ] **Step 2: Write the failing test** at `tests/authz.question.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { questionImports, syllabuses } from "@/lib/db/schema";
import { assertQuestionImportOwner, AuthzError } from "@/lib/auth/authz";
import {
  createTestSyllabus,
  createTestUser,
  insertImport,
  teardownTutor,
  type TestUser,
} from "./helpers/seed";

/**
 * The question bank is tutor-private and syllabus-scoped. The negatives here
 * are the point: a rival tutor or a student must never resolve another tutor's
 * import, and a soft-deleted import or syllabus must look missing.
 */
describe("question import ownership", () => {
  let tutorA: TestUser;
  let tutorB: TestUser;
  let student: TestUser;
  let syllabusA: string;
  let importA: string;

  beforeAll(async () => {
    tutorA = await createTestUser("qi-tutor-a", "tutor");
    tutorB = await createTestUser("qi-tutor-b", "tutor");
    student = await createTestUser("qi-student", "student");
    syllabusA = await createTestSyllabus(tutorA.id, "H2 Math");
    ({ importId: importA } = await insertImport(tutorA.id, syllabusA));
  });

  afterAll(async () => {
    for (const u of [tutorA, tutorB, student]) await teardownTutor(u);
  });

  it("resolves for the owning tutor", async () => {
    const imp = await assertQuestionImportOwner(tutorA.id, importA);
    expect(imp.id).toBe(importA);
  });

  it("DENIES a rival tutor", async () => {
    await expect(assertQuestionImportOwner(tutorB.id, importA)).rejects.toThrow(AuthzError);
  });

  it("DENIES a student", async () => {
    await expect(assertQuestionImportOwner(student.id, importA)).rejects.toThrow(AuthzError);
  });

  it("DENIES a soft-deleted import", async () => {
    const { importId } = await insertImport(tutorA.id, syllabusA);
    await db
      .update(questionImports)
      .set({ deletedAt: new Date() })
      .where(eq(questionImports.id, importId));
    await expect(assertQuestionImportOwner(tutorA.id, importId)).rejects.toThrow(AuthzError);
  });

  it("DENIES an import whose syllabus was soft-deleted", async () => {
    const other = await createTestSyllabus(tutorA.id, "Doomed");
    const { importId } = await insertImport(tutorA.id, other);
    await db.update(syllabuses).set({ deletedAt: new Date() }).where(eq(syllabuses.id, other));
    await expect(assertQuestionImportOwner(tutorA.id, importId)).rejects.toThrow(AuthzError);
  });
});
```

- [ ] **Step 3: Run it and confirm it fails**

Run: `pnpm test tests/authz.question.test.ts`
Expected: FAIL. `assertQuestionImportOwner` is not exported.

- [ ] **Step 4: Implement the helper** in `lib/auth/authz.ts`. Add `questionImports` to the schema import, and add `inArray` etc. only if they aren't already imported:

```ts
export type QuestionImport = InferSelectModel<typeof questionImports>;

/**
 * Same shape as assertSyllabusOwner: the question bank is tutor-private and
 * students have no relationship to it at all. A soft-deleted import, or one
 * whose syllabus was soft-deleted, is indistinguishable from "not yours".
 */
export async function assertQuestionImportOwner(
  userId: string,
  importId: string,
): Promise<QuestionImport> {
  const [row] = await db
    .select({ imp: questionImports })
    .from(questionImports)
    .innerJoin(syllabuses, eq(syllabuses.id, questionImports.syllabusId))
    .where(
      and(
        eq(questionImports.id, importId),
        isNull(questionImports.deletedAt),
        isNull(syllabuses.deletedAt),
      ),
    )
    .limit(1);

  if (!row || row.imp.tutorId !== userId) throw new AuthzError();
  return row.imp;
}
```

- [ ] **Step 5: Create `lib/validation/question.ts`**

```ts
import { z } from "zod";
import {
  MAX_FILE_BYTES,
  QUESTION_IMPORT_MIME_TYPES,
  formatBytes,
} from "@/lib/storage/config";

/**
 * Shown both by the upload action (refused up front) and by the worker (a job
 * whose syllabus lost its topics before it ran). One string, so the tutor sees
 * the same words either way. Lives in lib/ because app/ must not import worker/.
 */
export const NO_TOPICS_MESSAGE =
  "This syllabus has no topics yet. Add topics before importing questions.";

// Lowercased for the same reason as lib/validation/concept.ts: downstream
// equality checks are exact-value.
const uuidField = (message: string) => z.string().uuid(message).toLowerCase();

/** generateObjectKey() is `<uuid>/<uuid>`; anything else was not minted by us. */
const objectKey = z
  .string()
  .regex(/^[0-9a-f-]{36}\/[0-9a-f-]{36}$/i, "Invalid upload");

export const requestQuestionImportUploadSchema = z.object({
  syllabusId: uuidField("Invalid syllabus"),
  filename: z.string().trim().min(1, "Filename is required").max(255, "Filename is too long"),
  mimeType: z.enum(QUESTION_IMPORT_MIME_TYPES, {
    errorMap: () => ({ message: "Only PDF files can be imported" }),
  }),
  sizeBytes: z
    .number()
    .int()
    .positive("File is empty")
    .max(MAX_FILE_BYTES, `Files must be under ${formatBytes(MAX_FILE_BYTES)}`),
});

export const confirmQuestionImportUploadSchema = z.object({
  syllabusId: uuidField("Invalid syllabus"),
  objectKey,
  filename: z.string().trim().min(1).max(255),
});

export const retryQuestionImportSchema = uuidField("Invalid import");
```

- [ ] **Step 6: Run the test and confirm it passes**

Run: `pnpm test tests/authz.question.test.ts && pnpm typecheck`
Expected: 5 passing; typecheck clean.

- [ ] **Step 7: Commit**

```bash
git add lib/auth/authz.ts lib/validation/question.ts tests/authz.question.test.ts tests/helpers/seed.ts
git commit -m "feat(auth): question import ownership gate and input schemas"
```

---

### Task 3: Handles, per-job schema, degeneracy guard (pure)

**Files:**
- Create: `worker/question-handles.ts`
- Create: `worker/question-schema.ts`
- Test: `tests/questions.handles.test.ts`

**Interfaces:**
- Produces (`worker/question-handles.ts`):
  - `type SyllabusVocabulary = { topics: { id: string; name: string; concepts: { id: string; name: string }[] }[] }`
  - `type QuestionHandles = { topicHandles: string[]; conceptHandles: string[]; topicIdByHandle: ReadonlyMap<string,string>; conceptIdByHandle: ReadonlyMap<string,string>; promptBlock: string }`
  - `const NO_TOPIC = "NONE"`
  - `buildQuestionHandles(vocab): QuestionHandles`
  - `resolveTopicRef(h, ref: string): string | null`
  - `resolveConceptRefs(h, refs: string[]): string[]`
- Produces (`worker/question-schema.ts`):
  - `makeQuestionChunkSchema(h)` (a Zod schema), `type QuestionChunkResult = z.infer<ReturnType<typeof makeQuestionChunkSchema>>`
  - `buildQuestionResponseSchema(h)` (the Gemini `responseSchema` object)
  - `isDegenerateQuestions(r: QuestionChunkResult): boolean`, `truncateQuestions(r): QuestionChunkResult`
  - `MAX_QUESTIONS_PER_CHUNK = 60`, `MAX_PARTS_PER_QUESTION = 30`, `MAX_FIGURES_PER_QUESTION = 10`

- [ ] **Step 1: Write the failing tests** at `tests/questions.handles.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  NO_TOPIC,
  buildQuestionHandles,
  resolveConceptRefs,
  resolveTopicRef,
  type SyllabusVocabulary,
} from "@/worker/question-handles";
import {
  MAX_PARTS_PER_QUESTION,
  buildQuestionResponseSchema,
  isDegenerateQuestions,
  makeQuestionChunkSchema,
  truncateQuestions,
  type QuestionChunkResult,
} from "@/worker/question-schema";

const vocab: SyllabusVocabulary = {
  topics: [
    {
      id: "topic-quad",
      name: "quadratic functions",
      concepts: [
        { id: "c-disc", name: "discriminant" },
        { id: "c-cts", name: "completing the square" },
      ],
    },
    {
      id: "topic-graphs",
      name: "graphs\nand transformations",
      // Shared with the first topic: one concept, one handle.
      concepts: [{ id: "c-cts", name: "completing the square" }],
    },
    { id: "topic-vec", name: "vectors", concepts: [] },
  ],
};

describe("buildQuestionHandles", () => {
  const h = buildQuestionHandles(vocab);

  it("numbers topics in syllabus order", () => {
    expect(h.topicHandles).toEqual(["T1", "T2", "T3"]);
    expect(h.topicIdByHandle.get("T2")).toBe("topic-graphs");
  });

  it("gives a concept shared by two topics exactly one handle", () => {
    expect(h.conceptHandles).toEqual(["C1", "C2"]);
    expect(h.conceptIdByHandle.get("C2")).toBe("c-cts");
  });

  it("renders a prompt block listing each topic with its concepts' handles", () => {
    expect(h.promptBlock).toBe(
      "TOPICS\n" +
        "T1: quadratic functions — discriminant (C1), completing the square (C2)\n" +
        "T2: graphs and transformations — completing the square (C2)\n" +
        "T3: vectors",
    );
  });

  it("maps NONE and unknown topic handles to null", () => {
    expect(resolveTopicRef(h, "T1")).toBe("topic-quad");
    expect(resolveTopicRef(h, NO_TOPIC)).toBeNull();
    expect(resolveTopicRef(h, "T99")).toBeNull();
  });

  it("maps concept handles to ids, deduped, dropping unknowns", () => {
    expect(resolveConceptRefs(h, ["C2", "C1", "C2", "C9"])).toEqual(["c-cts", "c-disc"]);
  });
});

const question = (over: Partial<QuestionChunkResult["questions"][number]> = {}) => ({
  label: "1",
  stem: "Solve $x^2 = 4$.",
  topicRef: "T1",
  conceptRefs: [],
  startPage: 1,
  endPage: 1,
  figures: [],
  parts: [],
  ...over,
});

describe("makeQuestionChunkSchema", () => {
  const schema = makeQuestionChunkSchema(buildQuestionHandles(vocab));

  it("accepts a well-formed chunk and defaults missing arrays", () => {
    const parsed = schema.parse({ questions: [{ ...question(), figures: undefined }] });
    expect(parsed.questions[0].figures).toEqual([]);
    expect(parsed.answers).toEqual([]);
  });

  it("accepts null for optional strings (Gemini emits nulls)", () => {
    expect(() =>
      schema.parse({ questions: [question({ sectionLabel: null, answer: null })], answers: [] }),
    ).not.toThrow();
  });

  it("rejects a topic handle that is not in this syllabus", () => {
    expect(schema.safeParse({ questions: [question({ topicRef: "T42" })] }).success).toBe(false);
  });

  it("rejects a concept handle that is not in this syllabus", () => {
    expect(schema.safeParse({ questions: [question({ conceptRefs: ["C7"] })] }).success).toBe(false);
  });
});

describe("buildQuestionResponseSchema", () => {
  type Props = Record<string, { enum?: string[]; items?: { enum?: string[] } }>;
  const props = (h: ReturnType<typeof buildQuestionHandles>) =>
    (buildQuestionResponseSchema(h) as unknown as {
      properties: { questions: { items: { properties: Props; required: string[] } } };
    }).properties.questions.items;

  it("constrains topicRef to this syllabus's handles plus NONE", () => {
    expect(props(buildQuestionHandles(vocab)).properties.topicRef.enum).toEqual([
      "T1",
      "T2",
      "T3",
      NO_TOPIC,
    ]);
  });

  it("constrains conceptRefs items to this syllabus's concept handles", () => {
    expect(props(buildQuestionHandles(vocab)).properties.conceptRefs.items?.enum).toEqual([
      "C1",
      "C2",
    ]);
  });

  it("omits conceptRefs entirely when the syllabus has no concepts (an empty enum is invalid)", () => {
    const h = buildQuestionHandles({ topics: [{ id: "t", name: "vectors", concepts: [] }] });
    expect(props(h).properties.conceptRefs).toBeUndefined();
    expect(props(h).required).not.toContain("conceptRefs");
  });
});

describe("isDegenerateQuestions", () => {
  const result = (qs: ReturnType<typeof question>[]): QuestionChunkResult =>
    ({ questions: qs, answers: [] }) as unknown as QuestionChunkResult;

  it("passes ordinary output", () => {
    expect(
      isDegenerateQuestions(result([question({ label: "1" }), question({ label: "2" })])),
    ).toBe(false);
  });

  it("flags many questions mostly sharing the same label", () => {
    expect(
      isDegenerateQuestions(result(Array.from({ length: 10 }, () => question({ label: "3" })))),
    ).toBe(true);
  });

  it("does NOT flag repeated numbering under different section labels", () => {
    const qs = ["A", "B"].flatMap((s) =>
      Array.from({ length: 5 }, (_, i) => question({ sectionLabel: s, label: String(i + 1) })),
    );
    expect(isDegenerateQuestions(result(qs))).toBe(false);
  });

  it("flags a long field made of a handful of repeated tokens", () => {
    expect(
      isDegenerateQuestions(result([question({ stem: "the value the value ".repeat(200) })])),
    ).toBe(true);
  });

  it("does NOT flag a long but varied LaTeX stem", () => {
    const stem = Array.from({ length: 300 }, (_, i) => `$x_{${i}} = ${i * 3}$`).join(" ");
    expect(isDegenerateQuestions(result([question({ stem })]))).toBe(false);
  });
});

describe("truncateQuestions", () => {
  it("trims parts beyond the cap instead of rejecting", () => {
    const parts = Array.from({ length: MAX_PARTS_PER_QUESTION + 5 }, (_, i) => ({
      label: `(${i})`,
      body: "x",
    }));
    const out = truncateQuestions({
      questions: [question({ parts })],
      answers: [],
    } as unknown as QuestionChunkResult);
    expect(out.questions[0].parts).toHaveLength(MAX_PARTS_PER_QUESTION);
  });
});
```

- [ ] **Step 2: Run them and confirm they fail**

Run: `pnpm test tests/questions.handles.test.ts`
Expected: FAIL. The modules don't exist.

- [ ] **Step 3: Implement `worker/question-handles.ts`**

```ts
/**
 * The syllabus as a CLOSED vocabulary. The model never writes a topic or
 * concept name; it picks a short handle from a list built here, and the
 * responseSchema (question-schema.ts) makes any other value structurally
 * impossible. Nothing downstream ever fuzzy-matches a name.
 *
 * Handles exist for one job only: built from the live rows when the job
 * starts, mapped back to ids in the same process, never stored.
 */

export type SyllabusVocabulary = {
  topics: { id: string; name: string; concepts: { id: string; name: string }[] }[];
};

export type QuestionHandles = {
  topicHandles: string[];
  conceptHandles: string[];
  topicIdByHandle: ReadonlyMap<string, string>;
  conceptIdByHandle: ReadonlyMap<string, string>;
  promptBlock: string;
};

/** The model's way to say "no topic fits"; the tutor assigns one in review. */
export const NO_TOPIC = "NONE";

const oneLine = (s: string) => s.replace(/\s+/g, " ").trim();

export function buildQuestionHandles(vocab: SyllabusVocabulary): QuestionHandles {
  const topicIdByHandle = new Map<string, string>();
  const conceptIdByHandle = new Map<string, string>();
  const handleByConceptId = new Map<string, string>();
  const lines: string[] = [];

  vocab.topics.forEach((topic, index) => {
    const topicHandle = `T${index + 1}`;
    topicIdByHandle.set(topicHandle, topic.id);

    // A concept can sit under several topics; it gets ONE handle, so the model
    // can't tag the same concept twice under different names.
    const conceptLabels = topic.concepts.map((concept) => {
      let handle = handleByConceptId.get(concept.id);
      if (!handle) {
        handle = `C${handleByConceptId.size + 1}`;
        handleByConceptId.set(concept.id, handle);
        conceptIdByHandle.set(handle, concept.id);
      }
      return `${oneLine(concept.name)} (${handle})`;
    });

    lines.push(
      `${topicHandle}: ${oneLine(topic.name)}` +
        (conceptLabels.length ? ` — ${conceptLabels.join(", ")}` : ""),
    );
  });

  return {
    topicHandles: [...topicIdByHandle.keys()],
    conceptHandles: [...conceptIdByHandle.keys()],
    topicIdByHandle,
    conceptIdByHandle,
    promptBlock: `TOPICS\n${lines.join("\n")}`,
  };
}

export function resolveTopicRef(h: QuestionHandles, ref: string): string | null {
  if (ref === NO_TOPIC) return null;
  return h.topicIdByHandle.get(ref) ?? null;
}

export function resolveConceptRefs(h: QuestionHandles, refs: string[]): string[] {
  const ids: string[] = [];
  for (const ref of refs) {
    const id = h.conceptIdByHandle.get(ref);
    if (id && !ids.includes(id)) ids.push(id);
  }
  return ids;
}
```

- [ ] **Step 4: Implement `worker/question-schema.ts`**

```ts
import { SchemaType } from "@google/generative-ai";
import { z } from "zod";
import { NO_TOPIC, type QuestionHandles } from "./question-handles";

/**
 * Two instruction channels reach the model, the responseSchema descriptions
 * and the prompt, and they must agree (worker/gemini-extract.ts learned this:
 * where they disagree, the schema wins). Caps here are generous and TRUNCATE;
 * isDegenerateQuestions is what rejects a repetition loop. Same split as the
 * topic extractor, for the same reason.
 */
export const MAX_QUESTIONS_PER_CHUNK = 60;
export const MAX_PARTS_PER_QUESTION = 30;
export const MAX_FIGURES_PER_QUESTION = 10;

// Gemini emits null for optional fields it has nothing for; accept both.
const optionalText = (max: number) => z.string().max(max).nullish();

/** Per job, because the allowed handles ARE the syllabus. */
export function makeQuestionChunkSchema(h: QuestionHandles) {
  const topicRef = z.enum([NO_TOPIC, ...h.topicHandles] as [string, ...string[]]);
  const conceptRef = h.conceptHandles.length
    ? z.enum(h.conceptHandles as [string, ...string[]])
    : z.never();

  return z.object({
    questions: z
      .array(
        z.object({
          sectionLabel: optionalText(200),
          label: z.string().min(1).max(50),
          stem: z.string().max(20_000),
          topicRef,
          conceptRefs: z.array(conceptRef).default([]),
          startPage: z.number().int(),
          endPage: z.number().int(),
          figures: z
            .array(
              z.object({
                page: z.number().int(),
                // Shape-checked loosely here; merge-questions.ts clamps or discards.
                box2d: z.array(z.number()).nullish(),
              }),
            )
            .default([]),
          parts: z
            .array(
              z.object({
                label: z.string().max(50),
                body: z.string().max(10_000),
                marks: z.number().int().min(0).max(1000).nullish(),
                answer: optionalText(10_000),
              }),
            )
            .default([]),
          answer: optionalText(10_000),
        }),
      )
      .default([]),
    answers: z
      .array(
        z.object({
          sectionLabel: optionalText(200),
          questionLabel: z.string().min(1).max(50),
          partLabel: optionalText(50),
          page: z.number().int(),
          answer: z.string().min(1).max(10_000),
        }),
      )
      .default([]),
  });
}

export type QuestionChunkResult = z.infer<ReturnType<typeof makeQuestionChunkSchema>>;

const S = SchemaType;

export function buildQuestionResponseSchema(h: QuestionHandles) {
  const questionProperties: Record<string, unknown> = {
    sectionLabel: {
      type: S.STRING,
      nullable: true,
      description:
        "The heading of the section this question sits under when the document " +
        "restarts numbering per section (e.g. 'Section B', 'Exercise 2A'). Null otherwise.",
    },
    label: {
      type: S.STRING,
      description: "The question's own number as printed, e.g. '3' or '12'. Never a part label.",
    },
    stem: {
      type: S.STRING,
      description:
        "The question text shared by all its parts (or the whole question when it " +
        "has no parts), transcribed verbatim. Maths in LaTeX delimited by $...$ or " +
        "$$...$$. Tables as Markdown tables. Put '[figure 1]', '[figure 2]'... where " +
        "each diagram appears, matching the figures array order.",
    },
    topicRef: {
      type: S.STRING,
      format: "enum",
      enum: [...h.topicHandles, NO_TOPIC],
      description:
        "The ONE topic handle from the TOPICS list this question mainly assesses, or " +
        `'${NO_TOPIC}' if no listed topic fits. Never force a fit.`,
    },
    startPage: { type: S.INTEGER, description: "Page of this excerpt where the question starts (1 = first page of the excerpt)." },
    endPage: { type: S.INTEGER, description: "Page of this excerpt where the question ends." },
    figures: {
      type: S.ARRAY,
      description:
        "Every diagram, graph, or picture the question needs, in the order of its " +
        "[figure n] placeholders. Not tables (those go in the text). Empty if none.",
      items: {
        type: S.OBJECT,
        properties: {
          page: { type: S.INTEGER, description: "Excerpt page the figure is on (1 = first page of the excerpt)." },
          box2d: {
            type: S.ARRAY,
            nullable: true,
            items: { type: S.INTEGER },
            description:
              "Bounding box [ymin, xmin, ymax, xmax] on that page, each 0-1000, " +
              "covering the whole figure including its labels and axes.",
          },
        },
        required: ["page"],
      },
    },
    parts: {
      type: S.ARRAY,
      description:
        "The question's sub-parts in order, e.g. (a), (a)(i), (b). These are NOT " +
        "separate questions; they nest here. Empty if the question has no parts.",
      items: {
        type: S.OBJECT,
        properties: {
          label: { type: S.STRING, description: "As printed, e.g. '(a)(i)'." },
          body: { type: S.STRING, description: "The part's own text, verbatim, maths in LaTeX." },
          marks: { type: S.INTEGER, nullable: true, description: "Marks printed for this part, else null." },
          answer: {
            type: S.STRING,
            nullable: true,
            description: "The answer ONLY if printed in this excerpt next to the part. Never solve it yourself.",
          },
        },
        required: ["label", "body"],
      },
    },
    answer: {
      type: S.STRING,
      nullable: true,
      description:
        "For a question with no parts: its answer ONLY if printed next to it. Never solve it yourself.",
    },
  };
  const required = ["label", "stem", "topicRef", "startPage", "endPage", "figures", "parts"];

  // Gemini rejects an empty enum, so a syllabus with no concepts gets no field at all.
  if (h.conceptHandles.length) {
    questionProperties.conceptRefs = {
      type: S.ARRAY,
      description:
        "Handles of the concepts from the TOPICS list this question exercises, from " +
        "any topic. Empty if none apply.",
      items: { type: S.STRING, format: "enum", enum: h.conceptHandles },
    };
    required.push("conceptRefs");
  }

  return {
    type: S.OBJECT,
    properties: {
      questions: {
        type: S.ARRAY,
        description:
          "Every question that starts or continues in this excerpt, in reading order. " +
          "Empty if the excerpt holds no questions.",
        items: { type: S.OBJECT, properties: questionProperties, required },
      },
      answers: {
        type: S.ARRAY,
        description:
          "Answer-key entries printed AWAY from their question (e.g. an answers " +
          "section at the back). Empty if none.",
        items: {
          type: S.OBJECT,
          properties: {
            sectionLabel: { type: S.STRING, nullable: true },
            questionLabel: { type: S.STRING, description: "The question number only, e.g. '3'." },
            partLabel: { type: S.STRING, nullable: true, description: "The part only, e.g. '(a)(ii)'. Null for a whole-question answer." },
            page: { type: S.INTEGER, description: "Excerpt page the answer is on." },
            answer: { type: S.STRING, description: "The answer as printed, maths in LaTeX." },
          },
          required: ["questionLabel", "page", "answer"],
        },
      },
    },
    required: ["questions", "answers"],
  };
}

/**
 * The repetition-loop signature, separated from merely-large output. Thresholds
 * are guesses; test against a saved degenerate response if one ever turns up.
 * The long-field check is deliberately conservative (1500+ chars, ≤1/8 distinct
 * tokens) because LaTeX matrices legitimately repeat tokens like '&' and '0'.
 */
export function isDegenerateQuestions(result: QuestionChunkResult): boolean {
  const keys = result.questions.map(
    (q) => `${(q.sectionLabel ?? "").trim().toLowerCase()}|${q.label.trim().toLowerCase()}`,
  );
  if (keys.length >= 8 && new Set(keys).size <= keys.length / 2) return true;

  const repetitive = (text: string | null | undefined) => {
    if (!text || text.length < 1500) return false;
    const tokens = text.split(/\s+/);
    return tokens.length >= 200 && new Set(tokens).size <= tokens.length / 8;
  };

  for (const q of result.questions) {
    if (repetitive(q.stem) || repetitive(q.answer)) return true;
    for (const p of q.parts) if (repetitive(p.body) || repetitive(p.answer)) return true;
  }
  return false;
}

export function truncateQuestions(result: QuestionChunkResult): QuestionChunkResult {
  return {
    questions: result.questions.slice(0, MAX_QUESTIONS_PER_CHUNK).map((q) => ({
      ...q,
      parts: q.parts.slice(0, MAX_PARTS_PER_QUESTION),
      figures: q.figures.slice(0, MAX_FIGURES_PER_QUESTION),
    })),
    answers: result.answers,
  };
}
```

- [ ] **Step 5: Run the tests and confirm they pass**

Run: `pnpm test tests/questions.handles.test.ts && pnpm typecheck`
Expected: all pass. If `format: "enum"` fails typecheck against the SDK's `Schema` type, that's fine: the object isn't annotated, and Task 5 passes it through the same untyped route `worker/gemini-extract.ts` uses.

- [ ] **Step 6: Commit**

```bash
git add worker/question-handles.ts worker/question-schema.ts tests/questions.handles.test.ts
git commit -m "feat(worker): closed-vocabulary handles and question response schema"
```

---

### Task 4: Merge chunks and pair answers (pure)

**Files:**
- Create: `worker/merge-questions.ts`
- Test: `tests/questions.merge.test.ts`

**Interfaces:**
- Consumes: `QuestionChunkResult` (Task 3), `Box2d` (Task 1, `@/lib/db/schema`; type-only import)
- Produces:
  - `normaliseQuestionLabel(s: string): string`, `normalisePartLabel(s: string): string`, `normaliseSection(s: string | null | undefined): string`
  - `clampBox(raw: number[] | null | undefined): Box2d | null`
  - `type MergedPart = { label: string; body: string; marks: number | null; answer: string | null }`
  - `type MergedQuestion = { sectionLabel: string | null; label: string; stem: string; topicRef: string; conceptRefs: string[]; startPage: number; endPage: number; figures: { page: number; box: Box2d | null }[]; parts: MergedPart[]; answer: string | null }`
  - `type ChunkInput = { startPage: number; endPage: number; result: QuestionChunkResult }`
  - `mergeQuestionChunks(chunks: ChunkInput[]): { questions: MergedQuestion[]; unpairedAnswers: number }`

- [ ] **Step 1: Write the failing tests** at `tests/questions.merge.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  clampBox,
  mergeQuestionChunks,
  normalisePartLabel,
  normaliseQuestionLabel,
  normaliseSection,
  type ChunkInput,
} from "@/worker/merge-questions";
import type { QuestionChunkResult } from "@/worker/question-schema";

type Q = QuestionChunkResult["questions"][number];
type A = QuestionChunkResult["answers"][number];

const q = (over: Partial<Q> = {}): Q => ({
  sectionLabel: null,
  label: "1",
  stem: "stem",
  topicRef: "T1",
  conceptRefs: [],
  startPage: 1,
  endPage: 1,
  figures: [],
  parts: [],
  answer: null,
  ...over,
});

const chunk = (startPage: number, endPage: number, questions: Q[], answers: A[] = []): ChunkInput => ({
  startPage,
  endPage,
  result: { questions, answers },
});

describe("label normalisation", () => {
  it.each([
    ["Q3", "3"],
    ["Question 12", "12"],
    ["3.", "3"],
    ["(3)", "3"],
    [" q 7: ", "7"],
  ])("question label %s -> %s", (raw, out) => {
    expect(normaliseQuestionLabel(raw)).toBe(out);
  });

  it.each([
    ["(a)(i)", "ai"],
    ["a(i)", "ai"],
    ["a) i)", "ai"],
    ["(ii)", "ii"],
    ["(B)", "b"],
  ])("part label %s -> %s", (raw, out) => {
    expect(normalisePartLabel(raw)).toBe(out);
  });

  it("normalises section labels and treats null as empty", () => {
    expect(normaliseSection("  Section   B: ")).toBe("section b");
    expect(normaliseSection(null)).toBe("");
  });
});

describe("clampBox", () => {
  it("keeps a valid box", () => {
    expect(clampBox([100, 200, 300, 400])).toEqual([100, 200, 300, 400]);
  });
  it("clamps out-of-range coordinates", () => {
    expect(clampBox([-5, 10, 1200, 900])).toEqual([0, 10, 1000, 900]);
  });
  it.each([[null], [undefined], [[1, 2, 3]], [[300, 0, 100, 500]], [[0, 500, 100, 500]]])(
    "discards an unusable box %j",
    (raw) => {
      expect(clampBox(raw as number[] | null | undefined)).toBeNull();
    },
  );
});

describe("mergeQuestionChunks", () => {
  it("converts chunk-relative pages to absolute pages", () => {
    const { questions } = mergeQuestionChunks([
      chunk(3, 5, [q({ startPage: 2, endPage: 3, figures: [{ page: 2, box2d: [1, 1, 2, 2] }] })]),
    ]);
    expect(questions[0].startPage).toBe(4);
    expect(questions[0].endPage).toBe(5);
    expect(questions[0].figures[0].page).toBe(4);
  });

  it("clamps a page outside the chunk back into it", () => {
    const { questions } = mergeQuestionChunks([chunk(3, 5, [q({ startPage: 9, endPage: 9 })])]);
    expect(questions[0].startPage).toBe(5);
  });

  it("keeps a figure whose box is nonsense, with a null box", () => {
    const { questions } = mergeQuestionChunks([
      chunk(1, 3, [q({ figures: [{ page: 1, box2d: [500, 0, 100, 10] }] })]),
    ]);
    expect(questions[0].figures).toEqual([{ page: 1, box: null }]);
  });

  /** The 1-page overlap makes this the common case. */
  it("dedupes a question seen in two overlapping chunks, keeping the more complete copy", () => {
    const partial = q({ label: "5", startPage: 3, endPage: 3, parts: [{ label: "(a)", body: "a" }] });
    const full = q({
      label: "Q5",
      startPage: 1,
      endPage: 2,
      parts: [
        { label: "(a)", body: "a" },
        { label: "(b)", body: "b" },
      ],
    });
    const { questions } = mergeQuestionChunks([chunk(1, 3, [partial]), chunk(3, 5, [full])]);
    expect(questions).toHaveLength(1);
    expect(questions[0].parts).toHaveLength(2);
    expect(questions[0].startPage).toBe(3);
    expect(questions[0].endPage).toBe(4);
  });

  it("does NOT merge the same number far apart with no section label (two sections restarting at 1)", () => {
    const { questions } = mergeQuestionChunks([
      chunk(1, 3, [q({ label: "1", stem: "first", startPage: 1, endPage: 1 })]),
      chunk(7, 9, [q({ label: "1", stem: "second", startPage: 1, endPage: 1 })]),
    ]);
    expect(questions.map((x) => x.stem)).toEqual(["first", "second"]);
  });

  it("does NOT merge the same number under different section labels on the same page", () => {
    const { questions } = mergeQuestionChunks([
      chunk(1, 3, [q({ sectionLabel: "A", label: "1" }), q({ sectionLabel: "B", label: "1" })]),
    ]);
    expect(questions).toHaveLength(2);
  });

  it("orders questions by first appearance", () => {
    const { questions } = mergeQuestionChunks([
      chunk(1, 3, [q({ label: "2", startPage: 3, endPage: 3 }), q({ label: "1", startPage: 1, endPage: 1 })]),
    ]);
    expect(questions.map((x) => x.label)).toEqual(["1", "2"]);
  });

  describe("answer pairing", () => {
    const paper = chunk(1, 3, [
      q({
        label: "3",
        startPage: 1,
        endPage: 1,
        parts: [
          { label: "(a)(i)", body: "x" },
          { label: "(a)(ii)", body: "y", answer: "inline" },
        ],
      }),
      q({ label: "4", startPage: 2, endPage: 2 }),
    ]);

    it("pairs answer-key entries despite label formatting differences", () => {
      const { questions, unpairedAnswers } = mergeQuestionChunks([
        paper,
        chunk(7, 9, [], [
          { sectionLabel: null, questionLabel: "Q3", partLabel: "a i", page: 1, answer: "42" },
          { sectionLabel: null, questionLabel: "4.", partLabel: null, page: 1, answer: "x = 2" },
        ]),
      ]);
      expect(questions[0].parts[0].answer).toBe("42");
      expect(questions[1].answer).toBe("x = 2");
      expect(unpairedAnswers).toBe(0);
    });

    it("keeps an inline answer over an answer-key entry", () => {
      const { questions } = mergeQuestionChunks([
        paper,
        chunk(7, 9, [], [{ sectionLabel: null, questionLabel: "3", partLabel: "(a)(ii)", page: 1, answer: "key" }]),
      ]);
      expect(questions[0].parts[1].answer).toBe("inline");
    });

    it("counts entries it cannot place, once each even when the overlap repeats them", () => {
      const orphan: A = { sectionLabel: null, questionLabel: "99", partLabel: null, page: 3, answer: "?" };
      const { unpairedAnswers } = mergeQuestionChunks([
        paper,
        chunk(7, 9, [], [{ ...orphan, page: 3 }]),
        chunk(9, 11, [], [{ ...orphan, page: 1 }]), // same physical page 9
      ]);
      expect(unpairedAnswers).toBe(1);
    });

    it("counts a part-less answer to a multi-part question as unpaired", () => {
      const { unpairedAnswers } = mergeQuestionChunks([
        paper,
        chunk(7, 9, [], [{ sectionLabel: null, questionLabel: "3", partLabel: null, page: 1, answer: "?" }]),
      ]);
      expect(unpairedAnswers).toBe(1);
    });

    it("pairs to the nearest preceding question when a number repeats across sections", () => {
      const { questions } = mergeQuestionChunks([
        chunk(1, 3, [q({ label: "1", stem: "early", startPage: 1, endPage: 1 })]),
        chunk(7, 9, [
          q({ label: "1", stem: "late", startPage: 1, endPage: 1 }),
        ], [{ sectionLabel: null, questionLabel: "1", partLabel: null, page: 3, answer: "late-ans" }]),
      ]);
      expect(questions.find((x) => x.stem === "late")?.answer).toBe("late-ans");
      expect(questions.find((x) => x.stem === "early")?.answer).toBeNull();
    });
  });
});
```

- [ ] **Step 2: Run them and confirm they fail**

Run: `pnpm test tests/questions.merge.test.ts`
Expected: FAIL. The module doesn't exist.

- [ ] **Step 3: Implement `worker/merge-questions.ts`**

```ts
import type { Box2d } from "@/lib/db/schema";
import type { QuestionChunkResult } from "./question-schema";

/**
 * Pure merge of per-chunk extraction output. Chunks overlap by one page
 * (pdf-chunk.ts), so the same question can legitimately arrive twice; answer
 * keys usually sit in a different chunk from their questions, so pairing
 * happens here, after every chunk is in, never inside a model call.
 */

export type MergedPart = { label: string; body: string; marks: number | null; answer: string | null };

export type MergedQuestion = {
  sectionLabel: string | null;
  label: string;
  stem: string;
  topicRef: string;
  conceptRefs: string[];
  startPage: number;
  endPage: number;
  figures: { page: number; box: Box2d | null }[];
  parts: MergedPart[];
  answer: string | null;
};

export type ChunkInput = { startPage: number; endPage: number; result: QuestionChunkResult };

export function normaliseQuestionLabel(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/^(question|qn|q)\s*\.?\s*/, "")
    .replace(/[\s().:\-]/g, "");
}

export function normalisePartLabel(s: string): string {
  return s.toLowerCase().replace(/[\s().:\-,]/g, "");
}

export function normaliseSection(s: string | null | undefined): string {
  return (s ?? "").toLowerCase().replace(/\s+/g, " ").trim().replace(/[.:]+$/, "").trim();
}

export function clampBox(raw: number[] | null | undefined): Box2d | null {
  if (!raw || raw.length !== 4 || raw.some((n) => !Number.isFinite(n))) return null;
  const [ymin, xmin, ymax, xmax] = raw.map((n) => Math.min(1000, Math.max(0, Math.round(n))));
  if (ymin >= ymax || xmin >= xmax) return null;
  return [ymin, xmin, ymax, xmax];
}

const toAbsolute = (chunk: ChunkInput, relativePage: number) =>
  Math.min(chunk.endPage, Math.max(chunk.startPage, chunk.startPage + relativePage - 1));

const keyOf = (section: string | null | undefined, label: string) =>
  `${normaliseSection(section)}|${normaliseQuestionLabel(label)}`;

const text = (s: string | null | undefined) => {
  const t = (s ?? "").trim();
  return t === "" ? null : t;
};

function toMerged(chunk: ChunkInput, q: QuestionChunkResult["questions"][number]): MergedQuestion {
  const startPage = toAbsolute(chunk, q.startPage);
  return {
    sectionLabel: text(q.sectionLabel),
    label: q.label.trim(),
    stem: q.stem.trim(),
    topicRef: q.topicRef,
    conceptRefs: [...q.conceptRefs],
    startPage,
    endPage: Math.max(startPage, toAbsolute(chunk, q.endPage)),
    figures: q.figures.map((f) => ({ page: toAbsolute(chunk, f.page), box: clampBox(f.box2d) })),
    parts: q.parts.map((p) => ({
      label: p.label.trim(),
      body: p.body.trim(),
      marks: p.marks ?? null,
      answer: text(p.answer),
    })),
    answer: text(q.answer),
  };
}

const moreComplete = (a: MergedQuestion, b: MergedQuestion) =>
  a.parts.length !== b.parts.length ? a.parts.length > b.parts.length : a.stem.length > b.stem.length;

export function mergeQuestionChunks(chunks: ChunkInput[]): {
  questions: MergedQuestion[];
  unpairedAnswers: number;
} {
  type Slot = { q: MergedQuestion; key: string; seq: number };
  const slots: Slot[] = [];

  for (const chunk of chunks) {
    for (const raw of chunk.result.questions) {
      const q = toMerged(chunk, raw);
      const key = keyOf(q.sectionLabel, q.label);
      // Only an overlap duplicate merges: same key AND intersecting pages. The
      // same number far apart is two sections restarting their numbering.
      const dup = slots.find(
        (s) => s.key === key && s.q.startPage <= q.endPage && q.startPage <= s.q.endPage,
      );
      if (!dup) {
        slots.push({ q, key, seq: slots.length });
        continue;
      }
      const winner = moreComplete(q, dup.q) ? q : dup.q;
      dup.q = {
        ...winner,
        startPage: Math.min(q.startPage, dup.q.startPage),
        endPage: Math.max(q.endPage, dup.q.endPage),
      };
    }
  }

  // Dedupe answer-key entries first: the overlap page repeats them.
  const seenAnswers = new Set<string>();
  let unpairedAnswers = 0;

  for (const chunk of chunks) {
    for (const a of chunk.result.answers) {
      const page = toAbsolute(chunk, a.page);
      const partKey = a.partLabel ? normalisePartLabel(a.partLabel) : "";
      const qKey = normaliseQuestionLabel(a.questionLabel);
      const answerId = `${normaliseSection(a.sectionLabel)}|${qKey}|${partKey}|${page}`;
      if (seenAnswers.has(answerId)) continue;
      seenAnswers.add(answerId);

      let candidates = slots.filter((s) => s.key === keyOf(a.sectionLabel, a.questionLabel));
      if (!candidates.length) {
        // Answer keys often omit the section heading the questions carried.
        candidates = slots.filter((s) => normaliseQuestionLabel(s.q.label) === qKey);
      }
      const preceding = candidates.filter((s) => s.q.startPage <= page);
      const target = preceding.length
        ? preceding.reduce((best, s) => (s.q.startPage >= best.q.startPage ? s : best))
        : candidates.length === 1
          ? candidates[0]
          : undefined;
      if (!target) {
        unpairedAnswers++;
        continue;
      }

      const answer = a.answer.trim();
      if (partKey) {
        const part = target.q.parts.find((p) => normalisePartLabel(p.label) === partKey);
        if (!part) unpairedAnswers++;
        else if (part.answer === null) part.answer = answer; // inline wins
      } else if (target.q.parts.length === 0) {
        if (target.q.answer === null) target.q.answer = answer;
      } else {
        unpairedAnswers++; // a whole-question answer has no single home on a multi-part question
      }
    }
  }

  const questions = slots
    .sort((a, b) => a.q.startPage - b.q.startPage || a.seq - b.seq)
    .map((s) => s.q);
  return { questions, unpairedAnswers };
}
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `pnpm test tests/questions.merge.test.ts && pnpm typecheck`
Expected: all pass. Note on the "first appearance" test: both questions are in one chunk, so the sort by `startPage` is what reorders them.

- [ ] **Step 5: Commit**

```bash
git add worker/merge-questions.ts tests/questions.merge.test.ts
git commit -m "feat(worker): merge question chunks and pair answer keys"
```

---

### Task 5: The Gemini call

**Files:**
- Create: `worker/gemini-extract-questions.ts`

**Interfaces:**
- Consumes: `QuestionHandles` (Task 3), `makeQuestionChunkSchema`, `buildQuestionResponseSchema`, `isDegenerateQuestions`, `truncateQuestions`, `QuestionChunkResult`
- Produces: `extractQuestions(input: { fileBytes: ArrayBuffer; pageRange: { startPage: number; endPage: number; totalPages: number }; handles: QuestionHandles }): Promise<QuestionChunkResult>`

There's no unit test: this is the network edge, and the guards around it are tested in Task 3. It is exercised for real in Task 10.

- [ ] **Step 1: Implement**

```ts
import { GoogleGenerativeAI } from "@google/generative-ai";
import type { QuestionHandles } from "./question-handles";
import {
  buildQuestionResponseSchema,
  isDegenerateQuestions,
  makeQuestionChunkSchema,
  truncateQuestions,
  type QuestionChunkResult,
} from "./question-schema";

/**
 * The second (and only other) Gemini purpose in this codebase: transcribe the
 * questions in a tutor-uploaded PDF and tag each against that tutor's syllabus.
 * Never generates, solves or paraphrases. Guards mirror worker/gemini-extract.ts
 * for the same reasons; read its comments before changing any of them.
 *
 * Same model as topic extraction; see gemini-extract.ts on why a floating
 * -latest alias rather than a dated pin.
 */
const MODEL_ID = "gemini-flash-latest";

/**
 * Higher than topic extraction's 8192: verbatim LaTeX transcription of three
 * dense exam pages is far more output than a topic list. Tune against real
 * papers (Task 10); a MAX_TOKENS finish still throws rather than truncating.
 */
const MAX_OUTPUT_TOKENS = 16_384;

const BASE_PROMPT =
  "You transcribe exam and practice questions from a document excerpt into structured data, " +
  "and tag each question against a syllabus.\n\n" +
  "TRANSCRIPTION\n" +
  "- Transcribe question text verbatim. Never solve, paraphrase, summarise, correct, or invent " +
  "a question, a part, or an answer.\n" +
  "- Write all mathematics in LaTeX: inline $...$, display $$...$$. Write tables as Markdown tables.\n" +
  "- A question's shared text is its stem; its (a), (b)(i)... sub-parts go in parts, never as " +
  "separate questions.\n" +
  "- Where the question shows a diagram, graph or picture, write [figure 1], [figure 2]... in the " +
  "text at that point and add a matching entry to figures with its page and bounding box.\n" +
  "- Record marks only when printed (e.g. '[3]', '(3 marks)'). Never estimate marks.\n" +
  "- Record an answer only when it is printed in the document. Answers next to their question go " +
  "on that question or part; answers listed elsewhere (an answer key) go in the answers array.\n\n" +
  "EXCLUSIONS\n" +
  "Never emit a question for: cover pages, instructions to candidates, formula sheets or lists of " +
  "formulae, blank answer lines or working space, page headers/footers, copyright notices.\n\n" +
  "PAGES\n" +
  "Page numbers in your output count from 1 = the first page of THIS excerpt. Ignore page numbers " +
  "printed on the pages themselves.\n\n" +
  "TAGGING\n" +
  "The syllabus is listed below as topics with handles (T1, T2...) and their concepts with " +
  "handles (C1, C2...). For each question choose the ONE topic it mainly assesses and every " +
  "concept it exercises, using handles only. If no topic genuinely fits, use NONE. Never force a fit.\n\n";

const chunkAddendum = (r: { startPage: number; endPage: number; totalPages: number }) =>
  "\n\nEXCERPT SCOPE\n" +
  `This is NOT the full document. It is pages ${r.startPage}-${r.endPage} of ${r.totalPages}.\n` +
  "Transcribe every question that starts or continues on these pages, even if it is cut off at " +
  "the start or end of the excerpt; include whatever of it is visible. An excerpt with no " +
  "questions and no answer key is normal: return empty arrays.";

export async function extractQuestions(input: {
  fileBytes: ArrayBuffer;
  pageRange: { startPage: number; endPage: number; totalPages: number };
  handles: QuestionHandles;
}): Promise<QuestionChunkResult> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is not set");

  const model = new GoogleGenerativeAI(apiKey).getGenerativeModel({
    model: MODEL_ID,
    generationConfig: {
      responseMimeType: "application/json",
      // Built per job: the allowed handles ARE this syllabus. Cast for the same
      // reason gemini-extract.ts passes a plain object: the SDK's Schema union
      // is stricter than the wire format it accepts.
      responseSchema: buildQuestionResponseSchema(input.handles) as never,
      maxOutputTokens: MAX_OUTPUT_TOKENS,
      // 0: overlapping chunks are merged by label, so the same question seen
      // twice must come back the same way.
      temperature: 0,
    },
  });

  const result = await model.generateContent([
    { inlineData: { data: Buffer.from(input.fileBytes).toString("base64"), mimeType: "application/pdf" } },
    { text: BASE_PROMPT + input.handles.promptBlock + chunkAddendum(input.pageRange) },
  ]);

  const blockReason = result.response.promptFeedback?.blockReason;
  if (blockReason) throw new Error(`Gemini blocked the request (${blockReason})`);

  const candidate = result.response.candidates?.[0];
  if (!candidate) throw new Error("Gemini returned no candidates");
  if (candidate.finishReason && candidate.finishReason !== "STOP") {
    throw new Error(`Gemini did not finish cleanly (${candidate.finishReason})`);
  }

  let raw: unknown;
  try {
    raw = JSON.parse(result.response.text());
  } catch {
    throw new Error("Gemini did not return valid JSON");
  }

  const parsed = makeQuestionChunkSchema(input.handles).safeParse(raw);
  if (!parsed.success) {
    throw new Error(`Gemini returned an unexpected shape: ${parsed.error.message}`);
  }
  if (isDegenerateQuestions(parsed.data)) {
    throw new Error("Gemini returned degenerate repeated output");
  }
  return truncateQuestions(parsed.data);
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: clean. If `responseSchema: ... as never` is rejected, match exactly how `worker/gemini-extract.ts` passes its `responseSchema` (a plain object literal) and cast to the SDK's `ResponseSchema` type instead.

- [ ] **Step 3: Commit**

```bash
git add worker/gemini-extract-questions.ts
git commit -m "feat(worker): Gemini question transcription call with closed-vocabulary tags"
```

---

### Task 6: Queue producer

**Files:**
- Create: `lib/queue/connection.ts`
- Modify: `lib/queue/syllabus-extraction.ts`
- Create: `lib/queue/question-extraction.ts`

**Interfaces:**
- Produces: `getProducerConnection(): IORedis`; `QUESTION_EXTRACTION_QUEUE = "question-extraction"`; `type QuestionExtractionJob = { importId: string }`; `enqueueQuestionExtraction(job): Promise<void>`

- [ ] **Step 1: Create `lib/queue/connection.ts`**. Move the comment block from `syllabus-extraction.ts` here verbatim, then:

```ts
import IORedis from "ioredis";

// <the existing comment block from syllabus-extraction.ts about why the
//  producer fails fast and must NOT copy the worker's maxRetriesPerRequest:
//  null, moved here unchanged>
let connection: IORedis | null = null;

/** One fail-fast connection shared by every producer queue in the Next app. */
export function getProducerConnection(): IORedis {
  if (connection) return connection;
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) {
    throw new Error("REDIS_URL is not set — required to enqueue background jobs.");
  }
  connection = new IORedis(redisUrl, {
    maxRetriesPerRequest: 3,
    enableOfflineQueue: false,
    connectTimeout: 5_000,
  });
  return connection;
}
```

- [ ] **Step 2: Point `lib/queue/syllabus-extraction.ts` at it.** Remove its `connection` variable, `IORedis` import, `REDIS_URL` check and comment block; `getQueue()` becomes:

```ts
function getQueue(): Queue<SyllabusExtractionJob> {
  if (queue) return queue;
  // Fail-fast producer options live in ./connection.ts; see the comment there.
  queue = new Queue<SyllabusExtractionJob>(SYLLABUS_EXTRACTION_QUEUE, {
    connection: getProducerConnection(),
  });
  return queue;
}
```

- [ ] **Step 3: Create `lib/queue/question-extraction.ts`**

```ts
import { Queue } from "bullmq";
import { getProducerConnection } from "./connection";

/**
 * Producer side of question extraction. Next only enqueues; worker/ consumes.
 * The payload is ONLY the import id: the worker re-reads syllabus, tutor and
 * attachment from that row, so a forged payload can at most name an import,
 * never assert who owns it (the queue is an authz boundary; see CLAUDE.md).
 */
export const QUESTION_EXTRACTION_QUEUE = "question-extraction";

export type QuestionExtractionJob = { importId: string };

let queue: Queue<QuestionExtractionJob> | null = null;

function getQueue(): Queue<QuestionExtractionJob> {
  if (queue) return queue;
  queue = new Queue<QuestionExtractionJob>(QUESTION_EXTRACTION_QUEUE, {
    connection: getProducerConnection(),
  });
  return queue;
}

export async function enqueueQuestionExtraction(job: QuestionExtractionJob): Promise<void> {
  await getQueue().add("extract", job, {
    attempts: 3,
    backoff: { type: "exponential", delay: 5_000 },
    removeOnComplete: true,
    removeOnFail: false,
  });
}
```

- [ ] **Step 4: Verify nothing regressed**

Run: `pnpm typecheck && pnpm test`
Expected: clean; all tests pass.

- [ ] **Step 5: Commit**

```bash
git add lib/queue
git commit -m "feat(queue): question-extraction producer on a shared fail-fast connection"
```

---

### Task 7: Worker processor + registration

**Files:**
- Create: `worker/process-question-extraction.ts`
- Modify: `worker/index.ts`
- Test: `tests/questions.worker.test.ts`

**Interfaces:**
- Consumes: Tasks 1, 3, 4, 5 and 6; `NO_TOPICS_MESSAGE` (Task 2); `chunkPdfByPages` (`worker/pdf-chunk.ts`); `createSignedDownloadUrl` (`lib/storage/objects.ts`)
- Produces: `loadSyllabusVocabulary(syllabusId: string): Promise<SyllabusVocabulary>`, `processQuestionExtraction(job: QuestionExtractionJob): Promise<void>`

- [ ] **Step 1: Write the failing tests** at `tests/questions.worker.test.ts`:

```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  concepts,
  questionConcepts,
  questionFigures,
  questionImports,
  questionParts,
  questions,
  topicConcepts,
  topics,
} from "@/lib/db/schema";
import { NO_TOPICS_MESSAGE } from "@/lib/validation/question";
import {
  createTestSyllabus,
  createTestUser,
  insertImport,
  teardownTutor,
  type TestUser,
} from "./helpers/seed";

// The network edges are mocked; everything between them (vocabulary load,
// handle mapping, merge, the write transaction) runs for real against the DB.
// vi.hoisted: vi.mock factories are hoisted above ordinary declarations.
const { extractQuestions } = vi.hoisted(() => ({ extractQuestions: vi.fn() }));
vi.mock("@/worker/gemini-extract-questions", () => ({ extractQuestions }));
vi.mock("@/worker/pdf-chunk", () => ({
  chunkPdfByPages: async () => [
    { fileBytes: new ArrayBuffer(1), startPage: 1, endPage: 3, totalPages: 3 },
  ],
}));
vi.mock("@/lib/storage/objects", async (orig) => ({
  ...(await orig<typeof import("@/lib/storage/objects")>()),
  createSignedDownloadUrl: async () => "http://storage.test/object",
}));
// Only the storage download is faked. Everything else passes through: the
// Supabase admin client behind createTestUser/deleteTestUser also uses fetch.
const realFetch = globalThis.fetch;
vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) =>
  String(input) === "http://storage.test/object"
    ? Promise.resolve(new Response(new ArrayBuffer(1), { status: 200 }))
    : realFetch(input, init),
);

const { processQuestionExtraction } = await import("@/worker/process-question-extraction");

describe("processQuestionExtraction", () => {
  let tutor: TestUser;
  let syllabusWithTopics: string;
  let emptySyllabus: string;
  let topicId: string;
  let conceptId: string;

  beforeAll(async () => {
    tutor = await createTestUser("qw-tutor", "tutor");
    syllabusWithTopics = await createTestSyllabus(tutor.id, "H2 Math");
    emptySyllabus = await createTestSyllabus(tutor.id, "No topics yet");
    const [t] = await db
      .insert(topics)
      .values({ syllabusId: syllabusWithTopics, tutorId: tutor.id, name: "quadratics", orderIndex: 0 })
      .returning({ id: topics.id });
    topicId = t.id;
    const [c] = await db
      .insert(concepts)
      .values({ tutorId: tutor.id, name: "discriminant" })
      .returning({ id: concepts.id });
    conceptId = c.id;
    await db.insert(topicConcepts).values({ topicId, conceptId });
  });

  afterAll(async () => {
    await db.delete(concepts).where(eq(concepts.tutorId, tutor.id));
    await teardownTutor(tutor);
  });

  beforeEach(() => extractQuestions.mockReset());

  it("writes drafts with parts, mapped tags, figures and paired answers", async () => {
    extractQuestions.mockResolvedValue({
      questions: [
        {
          sectionLabel: null,
          label: "1",
          stem: "Given [figure 1], find $k$.",
          topicRef: "T1",
          conceptRefs: ["C1"],
          startPage: 1,
          endPage: 1,
          figures: [{ page: 1, box2d: [100, 100, 400, 600] }],
          parts: [
            { label: "(a)", body: "Find $k$.", marks: 2, answer: null },
            { label: "(b)", body: "Hence solve.", marks: 3, answer: null },
          ],
          answer: null,
        },
      ],
      answers: [{ sectionLabel: null, questionLabel: "1", partLabel: "(a)", page: 3, answer: "k = 4" }],
    });
    const { importId } = await insertImport(tutor.id, syllabusWithTopics);

    await processQuestionExtraction({ importId });

    const [imp] = await db.select().from(questionImports).where(eq(questionImports.id, importId));
    expect(imp.status).toBe("done");
    const [question] = await db.select().from(questions).where(eq(questions.importId, importId));
    expect(question).toMatchObject({ status: "draft", topicId, label: "1", sourcePageStart: 1 });
    const parts = await db.select().from(questionParts).where(eq(questionParts.questionId, question.id));
    expect(parts.map((p) => [p.label, p.marks, p.answer])).toEqual([
      ["(a)", 2, "k = 4"],
      ["(b)", 3, null],
    ]);
    const qc = await db.select().from(questionConcepts).where(eq(questionConcepts.questionId, question.id));
    expect(qc.map((r) => r.conceptId)).toEqual([conceptId]);
    const figs = await db.select().from(questionFigures).where(eq(questionFigures.questionId, question.id));
    expect(figs).toMatchObject([{ page: 1, suggestedBox: [100, 100, 400, 600], attachmentId: null }]);
  });

  it("stores a part-less question's answer on one unlabeled part", async () => {
    extractQuestions.mockResolvedValue({
      questions: [
        {
          sectionLabel: null, label: "2", stem: "Solve $x^2=9$.", topicRef: "NONE", conceptRefs: [],
          startPage: 2, endPage: 2, figures: [], parts: [], answer: "x = ±3",
        },
      ],
      answers: [],
    });
    const { importId } = await insertImport(tutor.id, syllabusWithTopics);
    await processQuestionExtraction({ importId });
    const [question] = await db.select().from(questions).where(eq(questions.importId, importId));
    expect(question.topicId).toBeNull(); // NONE -> untagged
    const parts = await db.select().from(questionParts).where(eq(questionParts.questionId, question.id));
    expect(parts).toMatchObject([{ label: "", body: "", answer: "x = ±3" }]);
  });

  it("is a no-op for an import that is already done (redelivered job)", async () => {
    const { importId } = await insertImport(tutor.id, syllabusWithTopics, "done");
    await processQuestionExtraction({ importId });
    expect(extractQuestions).not.toHaveBeenCalled();
    expect(await db.select().from(questions).where(eq(questions.importId, importId))).toEqual([]);
  });

  it("fails readably before any Gemini call when the syllabus has no topics", async () => {
    const { importId } = await insertImport(tutor.id, emptySyllabus);
    await expect(processQuestionExtraction({ importId })).rejects.toThrow(NO_TOPICS_MESSAGE);
    expect(extractQuestions).not.toHaveBeenCalled();
    const [imp] = await db.select().from(questionImports).where(eq(questionImports.id, importId));
    expect(imp).toMatchObject({ status: "failed", error: NO_TOPICS_MESSAGE });
  });

  it("marks the import failed and writes nothing when extraction throws", async () => {
    extractQuestions.mockRejectedValue(new Error("Gemini did not finish cleanly (MAX_TOKENS)"));
    const { importId } = await insertImport(tutor.id, syllabusWithTopics);
    await expect(processQuestionExtraction({ importId })).rejects.toThrow("MAX_TOKENS");
    const [imp] = await db.select().from(questionImports).where(eq(questionImports.id, importId));
    expect(imp.status).toBe("failed");
    expect(await db.select().from(questions).where(eq(questions.importId, importId))).toEqual([]);
  });
});
```

- [ ] **Step 2: Run them and confirm they fail**

Run: `pnpm test tests/questions.worker.test.ts`
Expected: FAIL. `@/worker/process-question-extraction` doesn't exist.

- [ ] **Step 3: Implement `worker/process-question-extraction.ts`**

```ts
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  attachments,
  concepts,
  questionConcepts,
  questionFigures,
  questionImports,
  questionParts,
  questions,
  syllabuses,
  topicConcepts,
  topics,
} from "@/lib/db/schema";
import { QUESTION_DOCUMENTS_BUCKET } from "@/lib/storage/config";
import { createSignedDownloadUrl } from "@/lib/storage/objects";
import { NO_TOPICS_MESSAGE } from "@/lib/validation/question";
import type { QuestionExtractionJob } from "@/lib/queue/question-extraction";
import { chunkPdfByPages } from "./pdf-chunk";
import { extractQuestions } from "./gemini-extract-questions";
import {
  buildQuestionHandles,
  resolveConceptRefs,
  resolveTopicRef,
  type SyllabusVocabulary,
} from "./question-handles";
import { mergeQuestionChunks } from "./merge-questions";

/** Live topics in syllabus order, each with its live concepts. */
export async function loadSyllabusVocabulary(syllabusId: string): Promise<SyllabusVocabulary> {
  const topicRows = await db
    .select({ id: topics.id, name: topics.name })
    .from(topics)
    .where(and(eq(topics.syllabusId, syllabusId), isNull(topics.deletedAt)))
    .orderBy(asc(topics.orderIndex), asc(topics.createdAt));
  if (!topicRows.length) return { topics: [] };

  const links = await db
    .select({ topicId: topicConcepts.topicId, id: concepts.id, name: concepts.name })
    .from(topicConcepts)
    .innerJoin(concepts, eq(concepts.id, topicConcepts.conceptId))
    .where(
      and(
        inArray(topicConcepts.topicId, topicRows.map((t) => t.id)),
        isNull(concepts.deletedAt),
      ),
    )
    .orderBy(asc(concepts.name));

  return {
    topics: topicRows.map((t) => ({
      ...t,
      concepts: links.filter((l) => l.topicId === t.id).map(({ id, name }) => ({ id, name })),
    })),
  };
}

/**
 * Consumer side. Trusts only the import id from the payload; tutor, syllabus
 * and document are all re-read from that row. Everything lands as a DRAFT:
 * the tutor approves (slice 2), never this worker.
 */
export async function processQuestionExtraction(job: QuestionExtractionJob): Promise<void> {
  const { importId } = job;

  const [imp] = await db
    .select()
    .from(questionImports)
    .where(and(eq(questionImports.id, importId), isNull(questionImports.deletedAt)))
    .limit(1);
  if (!imp) return; // deleted since enqueue: nothing to do, nothing worth retrying
  if (imp.status === "done") return; // redelivered after commit

  await db
    .update(questionImports)
    .set({ status: "processing", error: null, updatedAt: new Date() })
    .where(eq(questionImports.id, importId));

  try {
    const [syllabus] = await db
      .select({ id: syllabuses.id })
      .from(syllabuses)
      .where(and(eq(syllabuses.id, imp.syllabusId), isNull(syllabuses.deletedAt)))
      .limit(1);
    if (!syllabus) throw new Error("Syllabus was deleted");

    // Checked before any download or model call: cheap, and the commonest
    // fixable mistake a tutor can make here.
    const vocab = await loadSyllabusVocabulary(imp.syllabusId);
    if (!vocab.topics.length) throw new Error(NO_TOPICS_MESSAGE);
    const handles = buildQuestionHandles(vocab);

    const [attachment] = await db
      .select()
      .from(attachments)
      .where(and(eq(attachments.id, imp.sourceAttachmentId), isNull(attachments.deletedAt)))
      .limit(1);
    if (!attachment) throw new Error("Source document is missing or was deleted");
    if (attachment.mimeType !== "application/pdf") {
      throw new Error("Only PDF documents can be imported as questions");
    }

    const response = await fetch(
      await createSignedDownloadUrl(QUESTION_DOCUMENTS_BUCKET, attachment.objectKey),
    );
    if (!response.ok) throw new Error(`Could not fetch the source document (${response.status})`);
    const chunks = await chunkPdfByPages(await response.arrayBuffer());

    // Uncapped concurrency, as topic extraction: paid-tier key. Revisit on 429s.
    const results = await Promise.all(
      chunks.map((c) =>
        extractQuestions({
          fileBytes: c.fileBytes,
          pageRange: { startPage: c.startPage, endPage: c.endPage, totalPages: c.totalPages },
          handles,
        }),
      ),
    );
    const { questions: merged, unpairedAnswers } = mergeQuestionChunks(
      chunks.map((c, i) => ({ startPage: c.startPage, endPage: c.endPage, result: results[i] })),
    );

    await db.transaction(async (tx) => {
      // Serialise against a concurrent delivery of the same job.
      const [locked] = await tx
        .select({ status: questionImports.status })
        .from(questionImports)
        .where(eq(questionImports.id, importId))
        .for("update");
      if (locked?.status === "done") return;

      // Tags were chosen against a snapshot; drop any that died since.
      const liveTopicIds = new Set(
        (
          await tx
            .select({ id: topics.id })
            .from(topics)
            .where(and(eq(topics.syllabusId, imp.syllabusId), isNull(topics.deletedAt)))
        ).map((r) => r.id),
      );
      const handleConceptIds = [...handles.conceptIdByHandle.values()];
      const liveConceptIds = new Set(
        handleConceptIds.length
          ? (
              await tx
                .select({ id: concepts.id })
                .from(concepts)
                .where(
                  and(
                    inArray(concepts.id, handleConceptIds),
                    eq(concepts.tutorId, imp.tutorId),
                    isNull(concepts.deletedAt),
                  ),
                )
            ).map((r) => r.id)
          : [],
      );

      for (const [index, q] of merged.entries()) {
        const topicId = resolveTopicRef(handles, q.topicRef);
        const [row] = await tx
          .insert(questions)
          .values({
            syllabusId: imp.syllabusId,
            tutorId: imp.tutorId,
            importId,
            topicId: topicId && liveTopicIds.has(topicId) ? topicId : null,
            sectionLabel: q.sectionLabel,
            label: q.label,
            stem: q.stem,
            status: "draft",
            sourcePageStart: q.startPage,
            sourcePageEnd: q.endPage,
            orderIndex: index,
          })
          .returning({ id: questions.id });

        const parts = q.parts.length
          ? q.parts
          : q.answer !== null
            ? [{ label: "", body: "", marks: null, answer: q.answer }]
            : [];
        if (parts.length) {
          await tx.insert(questionParts).values(
            parts.map((p, i) => ({
              questionId: row.id,
              label: p.label,
              body: p.body,
              marks: p.marks,
              answer: p.answer,
              orderIndex: i,
            })),
          );
        }

        const conceptIds = resolveConceptRefs(handles, q.conceptRefs).filter((id) =>
          liveConceptIds.has(id),
        );
        if (conceptIds.length) {
          await tx
            .insert(questionConcepts)
            .values(conceptIds.map((conceptId) => ({ questionId: row.id, conceptId })))
            .onConflictDoNothing();
        }

        if (q.figures.length) {
          await tx.insert(questionFigures).values(
            q.figures.map((f, i) => ({
              questionId: row.id,
              page: f.page,
              suggestedBox: f.box,
              orderIndex: i,
            })),
          );
        }
      }

      await tx
        .update(questionImports)
        .set({
          status: "done",
          error: null,
          note: unpairedAnswers
            ? `${unpairedAnswers} answer(s) in the document could not be matched to a question.`
            : null,
          updatedAt: new Date(),
        })
        .where(eq(questionImports.id, importId));
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown extraction error";
    await db
      .update(questionImports)
      .set({ status: "failed", error: message, updatedAt: new Date() })
      .where(eq(questionImports.id, importId));
    throw error; // BullMQ's retry/backoff decides what happens next
  }
}
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `pnpm test tests/questions.worker.test.ts && pnpm typecheck`
Expected: 5 passing.

- [ ] **Step 5: Register the consumer in `worker/index.ts`.** Add imports, then append after the syllabus worker's handlers, keeping the existing `connection` comment intact:

```ts
import {
  QUESTION_EXTRACTION_QUEUE,
  type QuestionExtractionJob,
} from "@/lib/queue/question-extraction";
import { processQuestionExtraction } from "./process-question-extraction";

// Its own blocking connection, same options as above and for the same reason.
const questionConnection = new IORedis(redisUrl, { maxRetriesPerRequest: null });

const questionWorker = new Worker<QuestionExtractionJob>(
  QUESTION_EXTRACTION_QUEUE,
  async (job) => {
    await processQuestionExtraction(job.data);
  },
  { connection: questionConnection, concurrency: 2 },
);

questionWorker.on("completed", (job) => {
  console.log(`[question-extraction] done — import ${job.data.importId}`);
});
questionWorker.on("failed", (job, err) => {
  console.error(`[question-extraction] failed — import ${job?.data.importId ?? "unknown"}`, err);
});

console.log("[question-extraction] worker started, waiting for jobs");
```

Also update the file's header comment: it now consumes two queues.

- [ ] **Step 6: Verify and commit**

Run: `pnpm typecheck && pnpm test`

```bash
git add worker/process-question-extraction.ts worker/index.ts tests/questions.worker.test.ts
git commit -m "feat(worker): process question imports into draft questions"
```

---

### Task 8: Upload, confirm and retry actions

**Files:**
- Create: `app/(tutor)/syllabi/[syllabusId]/questions/actions.ts`
- Test: `tests/questions.actions.test.ts` (a separate file because its module mocks must not leak into the helper tests)

**Interfaces:**
- Consumes: Tasks 1, 2 and 6; `UploadTicket` type from `app/(tutor)/syllabi/actions.ts`
- Produces: `requestQuestionImportUpload(input: { syllabusId: string; filename: string; mimeType: string; sizeBytes: number }): Promise<UploadTicket>`; `confirmQuestionImportUpload(input: { syllabusId: string; objectKey: string; filename: string }): Promise<FormState>`; `retryQuestionImport(importId: string): Promise<void>`

- [ ] **Step 1: Write the failing tests** at `tests/questions.actions.test.ts`:

```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { attachments, questionImports, topics } from "@/lib/db/schema";
import {
  IDENTITY_HEADER_USER_EMAIL,
  IDENTITY_HEADER_USER_ID,
} from "@/lib/auth/identity-headers";
import { NO_TOPICS_MESSAGE } from "@/lib/validation/question";
import {
  createTestSyllabus,
  createTestUser,
  insertImport,
  teardownTutor,
  type TestUser,
} from "./helpers/seed";

// Same identity mock as tests/concepts.actions.test.ts: requireAuthUser reads
// middleware-forwarded headers, so the real authorize path runs.
let viewer: TestUser | null = null;
vi.mock("next/headers", () => ({
  headers: async () => ({
    get: (name: string) =>
      name === IDENTITY_HEADER_USER_ID ? viewer?.id ?? null
      : name === IDENTITY_HEADER_USER_EMAIL ? viewer?.email ?? null
      : null,
  }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

// Storage and queue are the side effects whose ABSENCE the negatives prove.
// vi.hoisted: vi.mock factories are hoisted above ordinary declarations.
const { createSignedUploadUrl, statObject, removeObject, enqueueQuestionExtraction } = vi.hoisted(
  () => ({
    createSignedUploadUrl: vi.fn(async () => ({ signedUrl: "http://u", token: "t", expiresInSeconds: 120 })),
    statObject: vi.fn(),
    removeObject: vi.fn(async () => {}),
    enqueueQuestionExtraction: vi.fn(async () => {}),
  }),
);
vi.mock("@/lib/storage/objects", async (orig) => ({
  ...(await orig<typeof import("@/lib/storage/objects")>()),
  createSignedUploadUrl,
  statObject,
  removeObject,
}));
vi.mock("@/lib/queue/question-extraction", () => ({ enqueueQuestionExtraction }));

const { requestQuestionImportUpload, confirmQuestionImportUpload, retryQuestionImport } =
  await import("@/app/(tutor)/syllabi/[syllabusId]/questions/actions");

const KEY = "11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222";
const pdf = { filename: "paper.pdf", mimeType: "application/pdf", sizeBytes: 1000 };

describe("question import actions", () => {
  let tutorA: TestUser;
  let tutorB: TestUser;
  let student: TestUser;
  let syllabusA: string;
  let emptySyllabusA: string;

  beforeAll(async () => {
    tutorA = await createTestUser("qa-tutor-a", "tutor");
    tutorB = await createTestUser("qa-tutor-b", "tutor");
    student = await createTestUser("qa-student", "student");
    syllabusA = await createTestSyllabus(tutorA.id, "H2 Math");
    emptySyllabusA = await createTestSyllabus(tutorA.id, "Empty");
    await db.insert(topics).values({ syllabusId: syllabusA, tutorId: tutorA.id, name: "vectors", orderIndex: 0 });
  });

  afterAll(async () => {
    for (const u of [tutorA, tutorB, student]) await teardownTutor(u);
  });

  beforeEach(() => {
    vi.clearAllMocks();
    viewer = null;
  });

  describe("requestQuestionImportUpload", () => {
    it("mints an upload URL for the owning tutor", async () => {
      viewer = tutorA;
      const r = await requestQuestionImportUpload({ syllabusId: syllabusA, ...pdf });
      expect(r.ok).toBe(true);
      expect(createSignedUploadUrl).toHaveBeenCalledOnce();
    });

    it.each([["rival tutor", () => tutorB], ["student", () => student]])(
      "REFUSES a %s without minting anything",
      async (_label, who) => {
        viewer = who();
        const r = await requestQuestionImportUpload({ syllabusId: syllabusA, ...pdf });
        expect(r).toEqual({ ok: false, error: "Not authorized" });
        expect(createSignedUploadUrl).not.toHaveBeenCalled();
      },
    );

    it("refuses a syllabus with no topics, with the shared message", async () => {
      viewer = tutorA;
      const r = await requestQuestionImportUpload({ syllabusId: emptySyllabusA, ...pdf });
      expect(r).toEqual({ ok: false, error: NO_TOPICS_MESSAGE });
      expect(createSignedUploadUrl).not.toHaveBeenCalled();
    });

    it("refuses a non-PDF claim", async () => {
      viewer = tutorA;
      const r = await requestQuestionImportUpload({ syllabusId: syllabusA, ...pdf, mimeType: "image/png" });
      expect(r.ok).toBe(false);
    });
  });

  describe("confirmQuestionImportUpload", () => {
    it("records what actually landed and enqueues only the import id", async () => {
      viewer = tutorA;
      statObject.mockResolvedValue({ sizeBytes: 4321, mimeType: "application/pdf" });
      const r = await confirmQuestionImportUpload({ syllabusId: syllabusA, objectKey: KEY, filename: "p.pdf" });
      expect(r).toEqual({ ok: true });
      const [imp] = await db.select().from(questionImports).where(eq(questionImports.syllabusId, syllabusA));
      expect(imp.status).toBe("pending");
      const [att] = await db.select().from(attachments).where(eq(attachments.id, imp.sourceAttachmentId));
      expect(att.sizeBytes).toBe(4321); // stat, not the client's claim
      expect(enqueueQuestionExtraction).toHaveBeenCalledWith({ importId: imp.id });
    });

    it("REFUSES a rival tutor before touching storage", async () => {
      viewer = tutorB;
      const r = await confirmQuestionImportUpload({ syllabusId: syllabusA, objectKey: KEY, filename: "p.pdf" });
      expect(r).toEqual({ error: "Not authorized" });
      expect(statObject).not.toHaveBeenCalled();
      expect(enqueueQuestionExtraction).not.toHaveBeenCalled();
    });

    it("deletes an object that is not really a PDF and writes no rows", async () => {
      viewer = tutorA;
      statObject.mockResolvedValue({ sizeBytes: 10, mimeType: "image/png" });
      const before = await db.select().from(questionImports).where(eq(questionImports.syllabusId, emptySyllabusA));
      const r = await confirmQuestionImportUpload({ syllabusId: emptySyllabusA, objectKey: KEY, filename: "p.pdf" });
      expect(r.error).toBeTruthy();
      expect(removeObject).toHaveBeenCalledOnce();
      const after = await db.select().from(questionImports).where(eq(questionImports.syllabusId, emptySyllabusA));
      expect(after).toHaveLength(before.length);
    });

    it("lands a queue outage on the import as a readable failure instead of throwing", async () => {
      viewer = tutorA;
      statObject.mockResolvedValue({ sizeBytes: 10, mimeType: "application/pdf" });
      enqueueQuestionExtraction.mockRejectedValueOnce(new Error("connect ECONNREFUSED"));
      const key2 = KEY.replace(/^1/, "3");
      const r = await confirmQuestionImportUpload({ syllabusId: syllabusA, objectKey: key2, filename: "p.pdf" });
      expect(r).toEqual({ ok: true });
      const rows = await db.select().from(questionImports).where(eq(questionImports.syllabusId, syllabusA));
      expect(rows.some((x) => x.status === "failed" && x.error?.includes("Could not queue"))).toBe(true);
    });
  });

  describe("retryQuestionImport", () => {
    it("re-enqueues a failed import for its owner", async () => {
      viewer = tutorA;
      const { importId } = await insertImport(tutorA.id, syllabusA, "failed");
      await retryQuestionImport(importId);
      expect(enqueueQuestionExtraction).toHaveBeenCalledWith({ importId });
      const [imp] = await db.select().from(questionImports).where(eq(questionImports.id, importId));
      expect(imp.status).toBe("pending");
    });

    it("does nothing for a rival tutor", async () => {
      const { importId } = await insertImport(tutorA.id, syllabusA, "failed");
      viewer = tutorB;
      await retryQuestionImport(importId);
      expect(enqueueQuestionExtraction).not.toHaveBeenCalled();
      const [imp] = await db.select().from(questionImports).where(eq(questionImports.id, importId));
      expect(imp.status).toBe("failed");
    });

    it("does not re-run an import that is not failed (no duplicate questions)", async () => {
      viewer = tutorA;
      const { importId } = await insertImport(tutorA.id, syllabusA, "done");
      await retryQuestionImport(importId);
      expect(enqueueQuestionExtraction).not.toHaveBeenCalled();
    });
  });
});
```

- [ ] **Step 2: Run them and confirm they fail**

Run: `pnpm test tests/questions.actions.test.ts`
Expected: FAIL. The actions module doesn't exist.

- [ ] **Step 3: Implement `app/(tutor)/syllabi/[syllabusId]/questions/actions.ts`**

```ts
"use server";

import { revalidatePath } from "next/cache";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { attachments, questionImports, topics } from "@/lib/db/schema";
import { requireAuthUser } from "@/lib/auth/session";
import { assertQuestionImportOwner, assertSyllabusOwner, AuthzError } from "@/lib/auth/authz";
import { recordEvent } from "@/lib/db/events";
import {
  NO_TOPICS_MESSAGE,
  confirmQuestionImportUploadSchema,
  requestQuestionImportUploadSchema,
  retryQuestionImportSchema,
} from "@/lib/validation/question";
import {
  MAX_FILE_BYTES,
  QUESTION_DOCUMENTS_BUCKET,
  isAllowedQuestionImportMimeType,
} from "@/lib/storage/config";
import {
  createSignedUploadUrl,
  generateObjectKey,
  removeObject,
  statObject,
} from "@/lib/storage/objects";
import { enqueueQuestionExtraction } from "@/lib/queue/question-extraction";
import type { UploadTicket } from "@/app/(tutor)/syllabi/actions";
import type { FormState } from "@/lib/types";

/**
 * Question import: request (authorize, mint URL) -> browser PUTs bytes ->
 * confirm (authorize, re-stat, write rows, enqueue). Same three-step shape as
 * syllabus documents and materials. Ownership of the SYLLABUS is the gate at
 * every step; the bank is tutor-private.
 */

async function ownsSyllabus(syllabusId: string) {
  const user = await requireAuthUser();
  await assertSyllabusOwner(user.id, syllabusId); // throws AuthzError
  return user;
}

export async function requestQuestionImportUpload(input: {
  syllabusId: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
}): Promise<UploadTicket> {
  const parsed = requestQuestionImportUploadSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid file" };
  }

  try {
    await ownsSyllabus(parsed.data.syllabusId);
  } catch (e) {
    if (e instanceof AuthzError) return { ok: false, error: "Not authorized" };
    throw e;
  }

  // Refused up front so the tutor doesn't upload 25 MB to learn this from a
  // failed job. The worker re-checks: topics can be deleted in between.
  const [anyTopic] = await db
    .select({ id: topics.id })
    .from(topics)
    .where(and(eq(topics.syllabusId, parsed.data.syllabusId), isNull(topics.deletedAt)))
    .limit(1);
  if (!anyTopic) return { ok: false, error: NO_TOPICS_MESSAGE };

  const objectKey = generateObjectKey();
  try {
    const { signedUrl, token } = await createSignedUploadUrl(QUESTION_DOCUMENTS_BUCKET, objectKey);
    return { ok: true, objectKey, signedUrl, token };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not prepare the upload" };
  }
}

export async function confirmQuestionImportUpload(input: {
  syllabusId: string;
  objectKey: string;
  filename: string;
}): Promise<FormState> {
  const parsed = confirmQuestionImportUploadSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const { syllabusId, objectKey, filename } = parsed.data;

  let user;
  try {
    user = await ownsSyllabus(syllabusId);
  } catch (e) {
    if (e instanceof AuthzError) return { error: "Not authorized" };
    throw e;
  }

  // The client's claims are never recorded: re-read what actually landed.
  const stat = await statObject(QUESTION_DOCUMENTS_BUCKET, objectKey);
  if (!stat) return { error: "The upload didn't complete. Please try again." };
  if (stat.sizeBytes > MAX_FILE_BYTES || !isAllowedQuestionImportMimeType(stat.mimeType)) {
    await removeObject(QUESTION_DOCUMENTS_BUCKET, objectKey);
    return { error: "That file isn't allowed. Only PDFs can be imported." };
  }

  let importId: string;
  try {
    importId = await db.transaction(async (tx) => {
      const [attachment] = await tx
        .insert(attachments)
        .values({
          bucket: QUESTION_DOCUMENTS_BUCKET,
          objectKey,
          originalFilename: filename,
          mimeType: stat.mimeType,
          sizeBytes: stat.sizeBytes,
          uploadedByUserId: user.id,
        })
        .returning({ id: attachments.id });

      const [imp] = await tx
        .insert(questionImports)
        .values({ syllabusId, tutorId: user.id, sourceAttachmentId: attachment.id, status: "pending" })
        .returning({ id: questionImports.id });

      await recordEvent(
        {
          actorId: user.id,
          verb: "question_import.uploaded",
          subjectType: "question_import",
          subjectId: imp.id,
          payload: { syllabusId, attachmentId: attachment.id, sizeBytes: stat.sizeBytes },
        },
        tx,
      );
      return imp.id;
    });
  } catch (e) {
    // e.g. the same objectKey confirmed twice (unique index). Never throw out of an action.
    console.error("confirmQuestionImportUpload failed", e);
    return { error: "Could not save that upload. Please try again." };
  }

  // After commit, and never thrown, for the reasons in confirmSyllabusDocumentUpload.
  try {
    await enqueueQuestionExtraction({ importId });
  } catch (e) {
    await db
      .update(questionImports)
      .set({
        status: "failed",
        error: `Could not queue extraction: ${e instanceof Error ? e.message : "unknown error"}`,
        updatedAt: new Date(),
      })
      .where(eq(questionImports.id, importId));
  }

  revalidatePath(`/syllabi/${syllabusId}`);
  return { ok: true };
}

/** Only a FAILED import re-runs: a done one would duplicate its questions. */
export async function retryQuestionImport(importId: string): Promise<void> {
  const parsed = retryQuestionImportSchema.safeParse(importId);
  if (!parsed.success) return;

  const user = await requireAuthUser();
  let imp;
  try {
    imp = await assertQuestionImportOwner(user.id, parsed.data);
  } catch (e) {
    if (e instanceof AuthzError) return;
    throw e;
  }
  if (imp.status !== "failed") return;

  await db
    .update(questionImports)
    .set({ status: "pending", error: null, updatedAt: new Date() })
    .where(eq(questionImports.id, imp.id));

  try {
    await enqueueQuestionExtraction({ importId: imp.id });
  } catch (e) {
    await db
      .update(questionImports)
      .set({
        status: "failed",
        error: `Could not queue extraction: ${e instanceof Error ? e.message : "unknown error"}`,
        updatedAt: new Date(),
      })
      .where(eq(questionImports.id, imp.id));
  }

  revalidatePath(`/syllabi/${imp.syllabusId}`);
}
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `pnpm test tests/questions.actions.test.ts && pnpm typecheck && pnpm test`
Expected: all pass, including the earlier suites.

- [ ] **Step 5: Commit**

```bash
git add "app/(tutor)/syllabi/[syllabusId]/questions/actions.ts" tests/questions.actions.test.ts
git commit -m "feat(questions): upload, confirm and retry question imports"
```

---

### Task 9: Concept merges repoint question tags

**Files:**
- Modify: `app/(tutor)/concepts/actions.ts` (inside the `for (const loserId of loserIds)` loop, right after the `topicConcepts` repoint)
- Test: `tests/concepts.merge-questions.test.ts`

**Interfaces:**
- Consumes: `questionConcepts`, `questions` (Task 1); `mergeConcepts(_prev: FormState, formData: FormData)`

- [ ] **Step 1: Write the failing test** at `tests/concepts.merge-questions.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { concepts, questionConcepts, questions } from "@/lib/db/schema";
import { IDENTITY_HEADER_USER_EMAIL, IDENTITY_HEADER_USER_ID } from "@/lib/auth/identity-headers";
import { createTestSyllabus, createTestUser, teardownTutor, type TestUser } from "./helpers/seed";

let viewer: TestUser | null = null;
vi.mock("next/headers", () => ({
  headers: async () => ({
    get: (name: string) =>
      name === IDENTITY_HEADER_USER_ID ? viewer?.id ?? null
      : name === IDENTITY_HEADER_USER_EMAIL ? viewer?.email ?? null
      : null,
  }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const { mergeConcepts } = await import("@/app/(tutor)/concepts/actions");

/** Without the repoint, merging two concepts silently untags every question on the loser. */
describe("mergeConcepts and question tags", () => {
  let tutor: TestUser;
  let survivor: string;
  let loser: string;
  let qOnlyLoser: string;
  let qBoth: string;

  beforeAll(async () => {
    tutor = await createTestUser("cmq-tutor", "tutor");
    viewer = tutor;
    const syllabusId = await createTestSyllabus(tutor.id, "S");
    [{ id: survivor }, { id: loser }] = await db
      .insert(concepts)
      .values([
        { tutorId: tutor.id, name: "alcohol" },
        { tutorId: tutor.id, name: "alcohols" },
      ])
      .returning({ id: concepts.id });
    [{ id: qOnlyLoser }, { id: qBoth }] = await db
      .insert(questions)
      .values([
        { syllabusId, tutorId: tutor.id, label: "1", stem: "a" },
        { syllabusId, tutorId: tutor.id, label: "2", stem: "b" },
      ])
      .returning({ id: questions.id });
    await db.insert(questionConcepts).values([
      { questionId: qOnlyLoser, conceptId: loser },
      { questionId: qBoth, conceptId: loser },
      { questionId: qBoth, conceptId: survivor },
    ]);
  });

  afterAll(async () => {
    await db.delete(concepts).where(eq(concepts.tutorId, tutor.id));
    await teardownTutor(tutor);
  });

  it("moves loser tags onto the survivor, without duplicating an existing pair", async () => {
    const fd = new FormData();
    fd.set("survivorId", survivor);
    fd.append("loserIds", loser);
    expect(await mergeConcepts({}, fd)).toEqual({ ok: true });

    const rows = await db.select().from(questionConcepts);
    const mine = rows.filter((r) => [qOnlyLoser, qBoth].includes(r.questionId));
    expect(mine.every((r) => r.conceptId === survivor)).toBe(true);
    expect(mine.map((r) => r.questionId).sort()).toEqual([qOnlyLoser, qBoth].sort());
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `pnpm test tests/concepts.merge-questions.test.ts`
Expected: FAIL on `every(... === survivor)`. A merge soft-deletes (tombstones) the loser rather than hard-deleting it, so nothing cascades, and the loser's `question_concepts` rows survive pointing at a dead concept.

- [ ] **Step 3: Implement.** In `app/(tutor)/concepts/actions.ts`, add `questionConcepts` to the schema import, and directly after `await tx.delete(topicConcepts).where(eq(topicConcepts.conceptId, loserId));` insert:

```ts
        // Same repoint for question tags: without it a merge silently untags
        // every question the loser was on (the loser is tombstoned, so its
        // rows would point at a dead concept forever).
        const questionLinks = await tx
          .select({ questionId: questionConcepts.questionId })
          .from(questionConcepts)
          .where(eq(questionConcepts.conceptId, loserId));
        for (const link of questionLinks) {
          await tx
            .insert(questionConcepts)
            .values({ questionId: link.questionId, conceptId: survivorId })
            .onConflictDoNothing();
        }
        await tx.delete(questionConcepts).where(eq(questionConcepts.conceptId, loserId));
```

- [ ] **Step 4: Run all tests and confirm they pass**

Run: `pnpm test && pnpm typecheck`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add "app/(tutor)/concepts/actions.ts" tests/concepts.merge-questions.test.ts
git commit -m "fix(concepts): concept merges repoint question tags too"
```

---

### Task 10: Pipeline script, real-paper run, docs

**Files:**
- Create: `scripts/test-question-pipeline.ts`
- Modify: `package.json` (scripts)
- Modify: `CLAUDE.md`, `docs/status.md`, `docs/deploy.md`

- [ ] **Step 1: Create `scripts/test-question-pipeline.ts`**

```ts
import "../worker/env";

import { readFile } from "node:fs/promises";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  attachments,
  concepts,
  questionConcepts,
  questionFigures,
  questionImports,
  questionParts,
  questions,
  syllabuses,
  topics,
} from "@/lib/db/schema";
import { createSupabaseAdminClient } from "@/lib/auth/supabase-admin";
import { generateObjectKey, removeObject } from "@/lib/storage/objects";
import { QUESTION_DOCUMENTS_BUCKET } from "@/lib/storage/config";
import { enqueueQuestionExtraction } from "@/lib/queue/question-extraction";

/**
 * Dev-only harness for question extraction, the counterpart of
 * test-syllabus-pipeline.ts. Imports a PDF into an EXISTING syllabus (it needs
 * that syllabus's topics as the tagging vocabulary), uploaded as the
 * syllabus's own tutor. Not wired into the app.
 *
 *   pnpm test:question-pipeline <file.pdf> --syllabus <syllabusId>
 *   pnpm test:question-pipeline --status <importId>
 *   pnpm test:question-pipeline --cleanup <syllabusId>   # hard-deletes that syllabus's imports + questions
 *
 * Run `pnpm worker:dev` in another terminal to process what this enqueues.
 */

async function seed(filePath: string, syllabusId: string) {
  if (!filePath.toLowerCase().endsWith(".pdf")) throw new Error("Question imports are PDF-only.");
  const [syllabus] = await db
    .select({ tutorId: syllabuses.tutorId, title: syllabuses.title })
    .from(syllabuses)
    .where(and(eq(syllabuses.id, syllabusId), isNull(syllabuses.deletedAt)))
    .limit(1);
  if (!syllabus) throw new Error("No such syllabus.");

  const bytes = await readFile(filePath);
  const objectKey = generateObjectKey();
  const { error } = await createSupabaseAdminClient()
    .storage.from(QUESTION_DOCUMENTS_BUCKET)
    .upload(objectKey, bytes, { contentType: "application/pdf" });
  if (error) throw new Error(`storage upload failed: ${error.message}`);

  const [attachment] = await db
    .insert(attachments)
    .values({
      bucket: QUESTION_DOCUMENTS_BUCKET,
      objectKey,
      originalFilename: filePath.split("/").pop() ?? filePath,
      mimeType: "application/pdf",
      sizeBytes: bytes.length,
      uploadedByUserId: syllabus.tutorId,
    })
    .returning({ id: attachments.id });
  const [imp] = await db
    .insert(questionImports)
    .values({ syllabusId, tutorId: syllabus.tutorId, sourceAttachmentId: attachment.id })
    .returning({ id: questionImports.id });
  await enqueueQuestionExtraction({ importId: imp.id });

  console.log(`Enqueued import ${imp.id} into "${syllabus.title}".
Next: pnpm worker:dev (other terminal), then
  pnpm test:question-pipeline --status ${imp.id}`);
}

async function status(importId: string) {
  const [imp] = await db.select().from(questionImports).where(eq(questionImports.id, importId)).limit(1);
  if (!imp) return console.log("No such import.");
  console.log(`status: ${imp.status}${imp.error ? ` — ${imp.error}` : ""}${imp.note ? `\nnote: ${imp.note}` : ""}`);

  const rows = await db
    .select({ q: questions, topicName: topics.name })
    .from(questions)
    .leftJoin(topics, eq(topics.id, questions.topicId))
    .where(eq(questions.importId, importId))
    .orderBy(asc(questions.orderIndex));

  for (const { q, topicName } of rows) {
    const parts = await db.select().from(questionParts).where(eq(questionParts.questionId, q.id)).orderBy(asc(questionParts.orderIndex));
    const figs = await db.select().from(questionFigures).where(eq(questionFigures.questionId, q.id)).orderBy(asc(questionFigures.orderIndex));
    const tags = await db
      .select({ name: concepts.name })
      .from(questionConcepts)
      .innerJoin(concepts, eq(concepts.id, questionConcepts.conceptId))
      .where(eq(questionConcepts.questionId, q.id));

    console.log(
      `\n${q.sectionLabel ? `[${q.sectionLabel}] ` : ""}Q${q.label}  pp.${q.sourcePageStart}-${q.sourcePageEnd}` +
        `  topic: ${topicName ?? "UNTAGGED"}  concepts: ${tags.map((t) => t.name).join(", ") || "-"}`,
    );
    console.log(`  ${q.stem.replace(/\s+/g, " ").slice(0, 200)}`);
    for (const p of parts) {
      console.log(
        `  ${p.label || "·"} ${p.body.replace(/\s+/g, " ").slice(0, 120)}` +
          `${p.marks !== null ? ` [${p.marks}]` : ""}${p.answer ? `  => ${p.answer.slice(0, 60)}` : ""}`,
      );
    }
    for (const f of figs) console.log(`  figure ${f.orderIndex + 1}: p.${f.page} box ${JSON.stringify(f.suggestedBox)}`);
  }
  console.log(`\n${rows.length} question(s).`);
}

async function cleanup(syllabusId: string) {
  const imps = await db.select().from(questionImports).where(eq(questionImports.syllabusId, syllabusId));
  if (!imps.length) return console.log("Nothing to clean up.");
  const attachmentIds = imps.map((i) => i.sourceAttachmentId);
  const objs = await db
    .select({ id: attachments.id, objectKey: attachments.objectKey })
    .from(attachments)
    .where(inArray(attachments.id, attachmentIds));

  await db.delete(questions).where(eq(questions.syllabusId, syllabusId)); // parts/figures/tags cascade
  await db.delete(questionImports).where(eq(questionImports.syllabusId, syllabusId));
  await db.delete(attachments).where(inArray(attachments.id, attachmentIds));
  for (const o of objs) await removeObject(QUESTION_DOCUMENTS_BUCKET, o.objectKey);
  console.log(`Removed ${imps.length} import(s) and their questions.`);
}

async function main() {
  const args = process.argv.slice(2);
  const flag = (name: string) => {
    const i = args.indexOf(name);
    return i === -1 ? undefined : args[i + 1];
  };
  if (args[0] === "--status") return status(args[1] ?? "");
  if (args[0] === "--cleanup") return cleanup(args[1] ?? "");
  const syllabusId = flag("--syllabus");
  if (!args[0] || !syllabusId) {
    throw new Error("usage: <file.pdf> --syllabus <id> | --status <importId> | --cleanup <syllabusId>");
  }
  return seed(args[0], syllabusId);
}

main().then(() => process.exit(0));
```

- [ ] **Step 2: Add the script to `package.json`** after `test:syllabus-pipeline`:

```json
    "test:question-pipeline": "tsx scripts/test-question-pipeline.ts"
```

- [ ] **Step 3: Provision the bucket locally.** **Tell the user first**: this restarts their local Supabase stack. Data survives, but sessions in their dev browser may need a re-login.

Run: `pnpm sb:stop && pnpm sb:start`
Expected: a later upload to `question-documents` succeeds (no `Bucket not found`).

- [ ] **Step 4: Run against real documents.** Needs `pnpm redis:start` and the user's `GEMINI_API_KEY`. Ask the user for:
  (a) a real past paper (H2 Math, matching a syllabus that already has topics; find it via `pnpm db:studio` or the Syllabi tab), and
  (b) a worksheet with an answer key at the back.

Run, for each document:
```
pnpm worker:dev                                             # separate terminal, leave running
pnpm test:question-pipeline <paper.pdf> --syllabus <id>
pnpm test:question-pipeline --status <importId>
```

Check and **report to the user** for each document:
- Every printed question is present once; parts are nested, not split into separate questions.
- LaTeX reads correctly for a sample of 5 questions.
- Marks match the paper.
- Topic choices are sensible; record the untagged count.
- Answer-key pairing is right, and the `note` shows the unpaired count.
- Figure boxes look plausible: render one page and compare by eye.
- Whether any chunk failed with `MAX_TOKENS`. If it did, raise `MAX_OUTPUT_TOKENS` in `worker/gemini-extract-questions.ts`, or consider two-pass, and record the finding.

Afterwards: `pnpm test:question-pipeline --cleanup <syllabusId>`. Prompt changes made here get their own commit with a message saying what real output prompted them.

- [ ] **Step 5: Update `CLAUDE.md`:**
  - **LLM carve-out paragraph:** "LLM calls are permitted for exactly **two** purposes": syllabus topic and concept mining, and *question extraction* (transcribing questions from a tutor-uploaded PDF and tagging them against that tutor's syllabus). Add a *Decided 2026-11-11* note. Generation, solving, auto-marking and embeddings are still out.
  - **Vocabulary table:** add **Question** (a transcribed or tutor-written bank item: stem, figures, one topic, concepts; draft until the tutor approves; syllabus-scoped, tutor-private), **Question part** (an ordered sub-part with its own marks and answer; never a bank item on its own), **Question import** (one uploaded PDF and its extraction status; a syllabus has many), **Figure** (a diagram owned by a question; Gemini suggests a box, the tutor confirms the crop; approval needs every figure confirmed). Update **Library**'s row to note the bank now exists on the syllabus.
  - **Syllabus extraction section:** add a short "Question extraction" subsection covering the closed-vocabulary handles and enum `responseSchema`, `{ importId }`-only payload, PDF-only, overlap dedup only when pages intersect, `maxOutputTokens` 16384, and the pointer to the spec.
  - **Stack:** the Gemini bullet now covers both worker purposes. List `katex` and `pdfjs-dist` as approved for slices 2–3 (not yet installed).
  - **Structure:** "all 18 tables" → "all 23 tables"; the `worker/` line consumes both queues; add `scripts/test-question-pipeline.ts` to Commands.
  - **Concept deduplication:** one line saying `mergeConcepts` also repoints `question_concepts`.
  - **Testing:** update the test count to the new total from `pnpm test`.

- [ ] **Step 6: Update `docs/status.md`:** add a Summary row "Question bank — slice 1 (extraction to drafts) | Done", a section listing what exists and what doesn't (no UI, no approval, no figure crops), the new test count, and the real-paper findings from Step 4. **Update `docs/deploy.md`:** add a `question-documents` row to the bucket table (line ~66), with the same once-per-cloud-project creation note `syllabus-documents` has (2 MIME types, 25 MiB).

- [ ] **Step 7: Final verification**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: all clean; report the test count.

- [ ] **Step 8: Commit**

```bash
git add scripts/test-question-pipeline.ts package.json CLAUDE.md docs/status.md docs/deploy.md
git commit -m "docs: question extraction carve-out, vocabulary, pipeline harness"
```

**Not part of this slice, but tell the user:** applying the migration to the cloud database and creating the cloud bucket are deploy steps (`deploy.md`). Don't run them without explicit instruction.
