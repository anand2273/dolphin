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

// Text fields TRUNCATE rather than reject: one over-long field must never fail
// a whole chunk (and, at temperature 0, every retry of it). Gemini emits null
// for optional fields it has nothing for; accept both.
const text = (max: number) => z.string().transform((s) => s.slice(0, max));
const optionalText = (max: number) => text(max).nullish();
// A nonsense mark (negative, fractional, absurd) becomes "no mark", not a failure.
const marks = z
  .number()
  .nullish()
  // undefined (not null) keeps the key optional in the inferred type; merge maps it to null.
  .transform((n) => (n != null && Number.isInteger(n) && n >= 0 && n <= 1000 ? n : undefined));

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
          // May be empty: an unnumbered "Challenge" item is still a question.
          label: text(50),
          stem: text(20_000),
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
                label: text(50),
                body: text(10_000),
                marks,
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
          questionLabel: text(50),
          partLabel: optionalText(50),
          page: z.number().int(),
          answer: text(10_000),
        }),
      )
      .default([])
      // A blank key line carries nothing to pair; drop it rather than fail.
      .transform((answers) =>
        answers.filter((a) => a.questionLabel.trim() !== "" && a.answer.trim() !== ""),
      ),
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
  // The stem is part of the key: a real repetition loop repeats content, while
  // restarted numbering (two sections of 1-5 with the heading missed) repeats
  // only labels and must not fail the import.
  const keys = result.questions.map(
    (q) =>
      `${(q.sectionLabel ?? "").trim().toLowerCase()}|${q.label.trim().toLowerCase()}|` +
      q.stem.trim().toLowerCase().replace(/\s+/g, " ").slice(0, 200),
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
