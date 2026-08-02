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
}): Promise<SyllabusExtractionResult> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is not set");

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({
    // Deliberately NOT a "-latest" alias pointing at a "thinking" model — one
    // was observed leaking its internal reasoning into output fields, breaking
    // the JSON. "flash-lite" is the non-thinking tier, which is what a
    // structured-extraction task like this wants.
    model: "gemini-flash-lite-latest",
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema,
      // A hard ceiling against the repetition-loop failure mode described
      // above — bounds worst-case latency/cost even when it happens.
      maxOutputTokens: 8192,
      temperature: 0.2,
    },
  });

  const base64 = Buffer.from(input.fileBytes).toString("base64");
  const result = await model.generateContent([
    { inlineData: { data: base64, mimeType: input.mimeType } },
    {
      text:
        "Extract this syllabus document's topics and, for each topic, the " +
        "concepts it covers. Use the document's own structure and terminology " +
        "where possible. Names should be a few words; descriptions one sentence.",
    },
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
