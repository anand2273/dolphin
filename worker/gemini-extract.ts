import { GoogleGenerativeAI, SchemaType } from "@google/generative-ai";
import { z } from "zod";

/**
 * The only place this worker talks to Gemini. Structured/JSON-schema output
 * mode is used so the model's response is a shape we can validate, not prose
 * we have to parse heuristically.
 *
 * Two instruction channels reach the model: `responseSchema`'s per-field
 * `description`s and the prompt text. They must agree. Where they disagreed,
 * the schema tended to win (it sits structurally adjacent to the output), so
 * anything the prompt asserts about WHICH headings become topics is echoed in
 * the schema descriptions rather than left to the prompt alone.
 *
 * There is deliberately no per-topic `sourceText` / verbatim-quote field. It
 * would only be worth its output tokens if something downstream could check
 * the quote against the document, and nothing here can: pdf-chunk.ts slices
 * pages as binary via pdf-lib (no text extraction API), and of the accepted
 * MIME types only text/plain yields usable text from fileBytes directly.
 * Requiring a quote we cannot verify spends budget against maxOutputTokens
 * and adds a way to lose legitimate topics — worse on scanned PDFs, where the
 * model is reading rendered images and may not be able to reproduce a line
 * character-for-character even when the topic is genuinely there. If real
 * hallucination shows up in the H2 Math output, the honest fix is a text
 * extraction pass (pdfjs-dist getTextContent() per page, mammoth or similar
 * for .docx) carried alongside the bytes through the chunk boundary — then a
 * quote field has something to validate against.
 */

/**
 * Validation caps are generous by design. They exist to reject impossible
 * output, not to enforce editorial limits — see `isDegenerate` below
 * for the actual repetition-loop guard. A cap tight enough to catch a
 * degenerate response is also tight enough to permanently drop a legitimately
 * dense chunk, because a retry at low temperature reproduces the same result.
 */
export const MAX_TOPICS = 100;
export const MAX_CONCEPTS_PER_TOPIC = 60;

const extractionResultSchema = z.object({
  topics: z
    .array(
      z.object({
        name: z.string().min(1).max(200),
        description: z.string().max(500).optional(),
        // Required in responseSchema, so required here too — an optional here
        // would make the inferred type lie about what callers actually receive.
        concepts: z.array(
          z.object({
            name: z.string().min(1).max(200),
            description: z.string().max(500).optional(),
          }),
        ),
      }),
    )
    .max(MAX_TOPICS),
});

export type SyllabusExtractionResult = z.infer<typeof extractionResultSchema>;

/**
 * Per-field descriptions and marking `concepts` required are load-bearing, not
 * decorative — without them the model was observed (a) flattening a topic's
 * own concepts into sibling top-level topics, and (b) omitting the concepts
 * array entirely most of the time. Both went away once the schema spelled out
 * the topic/concept nesting explicitly and required the field.
 *
 * The topics description previously read "one entry per top-level heading
 * (5 headings -> 5 topics)". That is the right anti-flattening signal but it
 * contradicted the prompt's exclusion rules and the chunk addendum's
 * empty-array instruction, both of which require SOME headings to produce no
 * topic at all. It is now scoped to teachable headings.
 */
const responseSchema = {
  type: SchemaType.OBJECT,
  properties: {
    topics: {
      type: SchemaType.ARRAY,
      description:
        "The syllabus's major teachable sections/chapters, in document order. " +
        "One entry per top-level heading that this syllabus actually teaches " +
        "and assesses — do NOT create a separate topic for each concept; " +
        "concepts nest INSIDE their topic's 'concepts' array. Not every " +
        "heading qualifies: headings covering assumed knowledge, excluded or " +
        "non-examinable content, notation/symbol reference, or administrative " +
        "matter produce no topic. See the EXCLUSIONS section of the " +
        "instructions. An empty array is a valid and expected answer for a " +
        "document or excerpt containing no teachable headings.",
      items: {
        type: SchemaType.OBJECT,
        properties: {
          name: {
            type: SchemaType.STRING,
            description:
              "The topic's own heading from the document, lowercased and with " +
              "any numbering stripped, e.g. 'quadratic functions' from a " +
              "heading reading '3.2 Quadratic Functions'.",
          },
          description: {
            type: SchemaType.STRING,
            description: "One sentence describing what this topic covers.",
          },
          concepts: {
            type: SchemaType.ARRAY,
            description:
              "The specific named techniques, formulas, or skills THIS topic " +
              "covers (e.g. under 'quadratic functions': 'completing the " +
              "square', 'quadratic formula', 'discriminant'). These are NOT " +
              "separate topics — they belong nested here, under their parent. " +
              "Lowercased, numbering stripped, as with topic names.",
            items: {
              type: SchemaType.OBJECT,
              properties: {
                name: { type: SchemaType.STRING },
                description: {
                  type: SchemaType.STRING,
                  description: "One sentence describing this concept.",
                },
              },
              required: ["name"],
            },
          },
        },
        required: ["name", "concepts"],
      },
    },
  },
  required: ["topics"],
};

/**
 * The floating `-latest` alias is deliberate, and the drift it exposes us to is
 * accepted rather than overlooked: the alias can move under us and silently
 * change extraction behaviour against a corpus we have already validated.
 *
 * Pinning a dated snapshot is nonetheless worse. Dated names are actively being
 * sunset — `gemini-2.5-flash` and `gemini-2.0-flash` both 404 on
 * `generateContent` while still appearing in ListModels — so a pin trades
 * reproducibility now for a hard outage on someone else's schedule. The
 * `-latest` family is the only thing confirmed to keep working. See CLAUDE.md's
 * "Model gotchas" section, which is where that was learned.
 *
 * Was "gemini-flash-lite-latest" until the chunking work (fd20abb): lite gave
 * topics too vague to be useful even one chunk at a time. This tier is what the
 * H2 Math extraction was validated against. If you change this, re-run
 * `pnpm test:syllabus-pipeline` against a real syllabus and check output
 * quality before committing.
 */
const MODEL_ID = "gemini-flash-latest";

/**
 * The repetition-loop failure mode: one field free-runs into tens of thousands
 * of tokens of repeated filler, or the same name is emitted over and over,
 * while the JSON stays syntactically valid. Detecting the repetition directly
 * separates it from a chunk that is merely large, which we would rather
 * truncate than throw away.
 *
 * Thresholds below are guesses. Test them against a saved degenerate response
 * if one exists — a real sample beats the heuristic.
 */
export function isDegenerate(result: SyllabusExtractionResult): boolean {
  const names = (xs: { name: string }[]) =>
    xs.map((x) => x.name.trim().toLowerCase());

  const mostlyDuplicated = (xs: string[]) =>
    xs.length >= 8 && new Set(xs).size <= xs.length / 2;

  if (mostlyDuplicated(names(result.topics))) return true;

  for (const topic of result.topics) {
    if (mostlyDuplicated(names(topic.concepts))) return true;

    // A single field repeating one short phrase to fill the buffer.
    const d = topic.description;
    if (d && d.length > 300) {
      const tokens = d.split(/\s+/);
      if (tokens.length >= 40 && new Set(tokens).size <= tokens.length / 4) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Sane-but-oversized output is trimmed rather than rejected.
 *
 * Note this only actually applies to concepts today: `extractionResultSchema`
 * carries `.max(MAX_TOPICS)` on the topics array, so a result with more than
 * MAX_TOPICS topics fails `safeParse` and throws before it ever reaches here.
 * The topics slice below is defensive only. See the worker extraction tests.
 */
export function truncate(
  result: SyllabusExtractionResult,
): SyllabusExtractionResult {
  return {
    topics: result.topics.slice(0, MAX_TOPICS).map((t) => ({
      ...t,
      concepts: t.concepts.slice(0, MAX_CONCEPTS_PER_TOPIC),
    })),
  };
}

const BASE_PROMPT =
  "You extract a hierarchy of topics and concepts from syllabus documents.\n\n" +

  "DEFINITIONS\n" +
  "A topic is a major sub-area of the subject that groups several related " +
  "skills, methods, formulas, or ideas. A concept is a specific skill, " +
  "technique, formula, method, or piece of terminology taught within a topic.\n\n" +

  "GRANULARITY\n" +
  "Pick a level between the broad subject and individual concepts:\n" +
  "  Linear Algebra    -> topic: vectors                    concept: vector cross product\n" +
  "  Organic Chemistry -> topic: hydroxyl compounds         concept: grignard reaction\n" +
  "  Calculus          -> topic: differentiation techniques concept: chain rule\n" +
  "  History           -> topic: sources and historiography concept: evaluating provenance\n" +
  "  Economics         -> topic: market failure             concept: deadweight loss\n" +
  "The subject name itself is never a topic. A single formula, rule, named " +
  "reaction, or definition is never a topic.\n\n" +

  "GROUNDING\n" +
  "Every topic and concept must come from text explicitly present in the " +
  "document. Use the document's own hierarchy; where it is ambiguous, prefer " +
  "the most literal reading of its headings over a curriculum structure you " +
  "expect the subject to have. A heading with exactly one item beneath it " +
  "stays a topic with one concept — do not promote the item or drop the " +
  "heading.\n\n" +

  "EXCLUSIONS\n" +
  "Some sections carry headings that look like topics but describe content " +
  "outside this syllabus. Never create a topic or concept from:\n" +
  "- Prior or assumed knowledge ('Assumed Knowledge', 'Prerequisites', 'Prior " +
  "Learning', 'Knowledge Assumed'), whether under such a heading or stated " +
  "inline (e.g. 'students are expected to already be familiar with ...').\n" +
  "- Content marked excluded, non-examinable, or out of scope.\n" +
  "- Notation reference: symbol tables, notation sections, glossaries, formula " +
  "sheets, lists of abbreviations. These define symbols rather than teach.\n" +
  "- Administrative matter: assessment weightings, exam timings, cover pages, " +
  "tables of contents, contact details, revision histories.\n" +
  "Extract only what this syllabus itself teaches and assesses.\n\n" +
  "- Vague/Genetic Topic Descriptions: These include introduction, overview, summary etc." +
  "Do not encode these as topics." +

  "NAMING\n" +
  "Preserve the document's terminology and ordering. Normalise only the " +
  "surface form of names:\n" +
  "- Lowercase every topic and concept name, including words that are proper " +
  "nouns or eponyms ('grignard reaction', 'newton's laws'). No exceptions — " +
  "consistent casing matters more here than conventional capitalisation.\n" +
  "- Strip leading numbering, lettering and bullets ('3.2 Vectors' -> 'vectors').\n" +
  "- Strip leading articles and trailing punctuation or colons.\n" +
  "- Keep the source's singular/plural form; do not pluralise or singularise.\n" +
  "- Do not translate. Name topics in the document's own language.\n" +
  "Names are concise noun phrases. Descriptions are exactly one sentence.";

/** Page numbers are 1-indexed and inclusive of both endpoints. */
type PageRange = { startPage: number; endPage: number; totalPages: number };

const buildChunkAddendum = (pageRange?: PageRange): string =>
  pageRange
    ? "\n\nEXCERPT SCOPE\n" +
      `This is NOT the full document. It is an excerpt covering pages ` +
      `${pageRange.startPage}-${pageRange.endPage} of ${pageRange.totalPages}.\n` +
      "Extract a topic or concept only if it is explicitly named or described " +
      "in the text of THIS excerpt. Do not infer or complete a hierarchy from " +
      "what a syllabus for this subject would usually contain, and do not draw " +
      "on knowledge of the subject beyond this excerpt's literal text. A topic " +
      "merely alluded to here and presumably detailed elsewhere belongs to the " +
      "chunk that details it, not to this one.\n" +
      "An excerpt may legitimately contain nothing extractable: a cover page, a " +
      "table of contents or other content overview, administrative text, or " +
      "material falling wholly under EXCLUSIONS. Return an empty topics array " +
      "in that case. An empty result is a correct answer and is always " +
      "preferred to a plausible guess."
    : "";

export async function extractTopicsAndConcepts(input: {
  fileBytes: ArrayBuffer;
  mimeType: string;
  /**
   * Present when this call is one structural chunk of a larger document
   * (see worker/pdf-chunk.ts). Tightens the prompt to refuse inference
   * beyond what this excerpt explicitly states, and gives the model the
   * page range so it doesn't mistake a mid-document excerpt for the whole
   * syllabus.
   */
  pageRange?: PageRange;
}): Promise<SyllabusExtractionResult> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is not set");

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({
    model: MODEL_ID,
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema,
      // A hard ceiling against the repetition-loop failure mode described
      // above — bounds worst-case latency/cost even when it happens.
      maxOutputTokens: 8192,
      // 0, not 0.2: chunks are merged downstream by name, so the same heading
      // seen in two chunks must produce the same string both times.
      temperature: 0,
    },
  });

  const base64 = Buffer.from(input.fileBytes).toString("base64");
  const result = await model.generateContent([
    { inlineData: { data: base64, mimeType: input.mimeType } },
    { text: BASE_PROMPT + buildChunkAddendum(input.pageRange) },
  ]);

  // A prompt-level block yields no candidates at all, so finishReason is
  // undefined and the check below would pass — .text() then throws something
  // that tells us nothing. Check the block reason first.
  const blockReason = result.response.promptFeedback?.blockReason;
  if (blockReason) {
    throw new Error(`Gemini blocked the request (${blockReason})`);
  }

  const candidate = result.response.candidates?.[0];
  if (!candidate) throw new Error("Gemini returned no candidates");

  const finishReason = candidate.finishReason;
  if (finishReason && finishReason !== "STOP") {
    // MAX_TOKENS here almost always means the repetition loop; the JSON will
    // be truncated mid-string and fail to parse anyway.
    throw new Error(`Gemini did not finish cleanly (${finishReason})`);
  }

  const text = result.response.text();
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error("Gemini did not return valid JSON");
  }

  const parsed = extractionResultSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`Gemini returned an unexpected shape: ${parsed.error.message}`);
  }

  if (isDegenerate(parsed.data)) {
    // Retryable: distinct from an oversized-but-sane result, which we trim.
    throw new Error("Gemini returned degenerate repeated output");
  }

  return truncate(parsed.data);
}