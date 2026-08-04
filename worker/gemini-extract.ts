import { GoogleGenerativeAI, SchemaType } from "@google/generative-ai";
import { z } from "zod";

/**
 * The only place this worker talks to Gemini. Structured/JSON-schema output
 * mode is used so the model's response is a shape we can validate, not prose
 * we have to parse heuristically.
 */

/**
 * Field-length and array-size caps are a deliberate guard, not a formality —
 * this model occasionally free-runs into a degenerate repetition loop (one
 * field ballooning to tens of thousands of tokens of repeated filler) while
 * still producing syntactically valid JSON that would otherwise pass
 * validation. Rejecting anything outside plausible bounds turns that failure
 * mode into a clean, retryable error instead of silent garbage in the DB.
 */
const extractionResultSchema = z.object({
  topics: z
    .array(
      z.object({
        name: z.string().min(1).max(200),
        description: z.string().max(500).optional(),
        concepts: z
          .array(
            z.object({
              name: z.string().min(1).max(200),
              description: z.string().max(500).optional(),
            }),
          )
          .max(30)
          .optional(),
      }),
    )
    .max(60),
});

export type SyllabusExtractionResult = z.infer<typeof extractionResultSchema>;

/**
 * Per-field descriptions and marking `concepts` required are load-bearing, not
 * decorative — without them the model was observed (a) flattening a topic's
 * own concepts into sibling top-level topics, and (b) omitting the concepts
 * array entirely most of the time. Both went away once the schema spelled out
 * the topic/concept nesting explicitly and required the field.
 */
const responseSchema = {
  type: SchemaType.OBJECT,
  properties: {
    topics: {
      type: SchemaType.ARRAY,
      description:
        "The syllabus's major sections/chapters, in document order. There " +
        "should be one entry per top-level heading in the source document " +
        "(e.g. 5 headings -> 5 topics) — do NOT create a separate topic for " +
        "each concept; concepts nest INSIDE their topic's 'concepts' array.",
      items: {
        type: SchemaType.OBJECT,
        properties: {
          name: {
            type: SchemaType.STRING,
            description: "The topic's own heading/title from the document, e.g. 'Quadratic Functions'.",
          },
          description: { type: SchemaType.STRING },
          concepts: {
            type: SchemaType.ARRAY,
            description:
              "The specific named techniques, formulas, or skills THIS topic " +
              "covers (e.g. under 'Quadratic Functions': 'Completing the " +
              "Square', 'Quadratic Formula', 'Discriminant'). These are NOT " +
              "separate topics — they belong nested here, under their parent.",
            items: {
              type: SchemaType.OBJECT,
              properties: {
                name: { type: SchemaType.STRING },
                description: { type: SchemaType.STRING },
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
  pageRange?: { startPage: number; endPage: number; totalPages: number };
}): Promise<SyllabusExtractionResult> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is not set");

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({
    // Was "gemini-flash-lite-latest" until the chunking work (fd20abb): lite
    // gave topics too vague to be useful even one chunk at a time. This tier
    // is what the H2 Math extraction was validated against.
    model: "gemini-flash-latest",
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema,
      // A hard ceiling against the repetition-loop failure mode described
      // above — bounds worst-case latency/cost even when it happens.
      maxOutputTokens: 8192,
      temperature: 0.2,
    },
  });

  const basePrompt =
      "Extract this syllabus document into a hierarchy of topics and concepts. " +
      "Preserve the document's original terminology and order where possible. " +
      "Do not infer a curriculum hierarchy if it is not explicit in the document. " +

      "A topic is a major sub-area of the subject that groups several related " +
      "skills, methods, formulas, or ideas. A concept is a more specific skill, " +
      "technique, formula, method, or terminology taught within a topic. " +

      "Choose a topic granularity between the broad subject and individual concepts. " +
      "For example, in Linear Algebra, 'Linear Algebra' is too broad to be a topic, " +
      "'Vectors' is an appropriate topic, and 'Vector Cross Product' is a concept. " +
      "Similarly, in Organic Chemistry, 'Organic Chemistry' is too broad, " +
      "'Hydroxyl Compounds' is an appropriate topic, and 'Grignard Reaction' is a concept. " +
      "Similarly, Calculus is too broad: Differentiation Techniques is a topic, Chain rule is a concept. " +

      // A syllabus routinely names content it does NOT teach: an "Assumed
      // Knowledge" / "Prerequisites" appendix listing prior learning, and
      // "excluded content" notes. That material is explicitly and
      // unambiguously named in the document, so every rule above ("extract
      // what the document literally states") argues FOR extracting it — which
      // is exactly how it ends up as a pile of spurious topics. It has to be
      // ruled out on the grounds of what it MEANS, not how clearly it is
      // stated. Chunk mode makes this worse, not better: the excerpt holding
      // the appendix has no way to see that it sits outside the syllabus body.
      "Extract only content that this syllabus itself teaches and assesses. " +
      "Ignore any section describing prior, assumed, or prerequisite knowledge " +
      "(for example one headed 'Assumed Knowledge', 'Prerequisites', 'Prior " +
      "Learning', or 'Knowledge Assumed'), and any section listing content that " +
      "is explicitly excluded, not examinable, or out of scope. Those sections " +
      "describe what lies OUTSIDE the syllabus, so never create a topic or " +
      "concept from them, however clearly they are named. " +

      // The notation appendix is the single biggest source of junk on a
      // Cambridge-style syllabus: a symbol reference table whose section
      // headings ("Miscellaneous Symbols", "Operations", "Matrices") are
      // indistinguishable from real topic headings to a chunk that cannot see
      // it sits in an appendix. Measured on the H2 Math 9758 syllabus, pages
      // 17-21 contributed 8 spurious topics out of 27.
      "Ignore reference material that lists notation rather than teaching " +
      "content: sections of mathematical or scientific notation, symbol " +
      "tables, glossaries, formula sheets, and lists of abbreviations. Their " +
      "headings look like topic headings but they define symbols, so never " +
      "create a topic or concept from them. " +

      "Do not promote concepts into separate topics. Do not create topics or concepts " +
      "that are not supported by the document. When the document's hierarchy is " +
      "ambiguous, prefer the most literal interpretation of its headings. " +

      "Names should be concise. Descriptions should be one sentence.";

  // Chunk mode trades one whole-document call for several narrow ones
  // specifically to kill this failure mode: given the full document, the
  // model would fill gaps with what a syllabus "usually" covers. Told
  // explicitly it's holding only a slice, and ordered to return nothing
  // rather than guess, it has no reason to do that.
  const chunkAddendum = input.pageRange
      ? " This is NOT the full document — it is an excerpt covering pages " +
        `${input.pageRange.startPage}-${input.pageRange.endPage} of ` +
        `${input.pageRange.totalPages} total pages. Only extract a topic or ` +
        "concept if it is explicitly and unambiguously named or described " +
        "somewhere in THIS excerpt. Do not infer, guess, or complete a topic " +
        "or concept based on what a syllabus for this subject would typically " +
        "contain, and do not use knowledge of the subject beyond this excerpt's " +
        "literal text. If this excerpt contains no clearly stated topic content " +
        "(e.g. it is a cover page, table of contents, administrative text, or " +
        "otherwise inconclusive), return an empty topics array rather than a " +
        "best guess. The same applies if this excerpt consists only of assumed " +
        "or prerequisite knowledge, or of content marked as excluded — an " +
        "excerpt can be entirely such material, and the correct answer is then " +
        "an empty topics array, not the topics it names. The same applies to " +
        "an excerpt that is only a notation or symbol reference table, a " +
        "glossary, or a formula sheet."
      : "";

  const base64 = Buffer.from(input.fileBytes).toString("base64");
  const result = await model.generateContent([
    { inlineData: { data: base64, mimeType: input.mimeType } },
    { text: basePrompt + chunkAddendum },
  ]);

  const finishReason = result.response.candidates?.[0]?.finishReason;
  if (finishReason && finishReason !== "STOP") {
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
  return parsed.data;
}
