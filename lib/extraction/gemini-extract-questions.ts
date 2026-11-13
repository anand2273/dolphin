import {
  GoogleGenerativeAI,
  type GenerationConfig,
  type ResponseSchema,
} from "@google/generative-ai";
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
 * Never generates, solves or paraphrases. Guards mirror gemini-extract.ts
 * for the same reasons; read its comments before changing any of them.
 *
 * Same model as topic extraction; see gemini-extract.ts on why a floating
 * -latest alias rather than a dated pin.
 */
const MODEL_ID = "gemini-flash-latest";

/**
 * Higher than topic extraction's 8192: verbatim LaTeX transcription of three
 * dense exam pages is far more output than a topic list. A MAX_TOKENS finish
 * still throws rather than truncating.
 *
 * thinkingBudget is load-bearing. This is a reasoning model and its hidden
 * thinking is billed against maxOutputTokens. Measured 2026-11-11 on a real
 * 5-page AP/GP tutorial with thinking uncapped: 15727 thinking tokens, 643
 * answer tokens, MAX_TOKENS on every attempt (temperature 0 reproduces it).
 * Transcription needs almost no reasoning. 1024 rather than 0 because some
 * model generations behind the -latest alias reject a zero budget.
 * SDK 0.21 doesn't type thinkingConfig; the API accepts it in generationConfig.
 */
export const QUESTION_GENERATION_CONFIG = {
  maxOutputTokens: 16_384,
  thinkingConfig: { thinkingBudget: 1024 },
  // 0: overlapping chunks are merged by label, so the same question seen
  // twice must come back the same way.
  temperature: 0,
};

/**
 * The token breakdown is the only thing that tells a MAX_TOKENS finish's three
 * causes apart: hidden thinking eating the budget (cap thinking), a repetition
 * loop (the degeneracy guard's job), or genuinely long output (raise the limit
 * or shrink chunks). It goes into the error so it lands on
 * question_imports.error and the Vercel function log. SDK 0.21 doesn't type
 * thoughtsTokenCount though the API returns it; derive it from the total when
 * it's absent.
 */
type Usage = {
  promptTokenCount?: number;
  candidatesTokenCount?: number;
  thoughtsTokenCount?: number;
  totalTokenCount?: number;
};

export function describeUnfinished(finishReason: string, usage: Usage | undefined): string {
  if (!usage) return `Gemini did not finish cleanly (${finishReason})`;
  const prompt = usage.promptTokenCount ?? 0;
  const answer = usage.candidatesTokenCount ?? 0;
  const thinking =
    usage.thoughtsTokenCount ?? Math.max(0, (usage.totalTokenCount ?? 0) - prompt - answer);
  return `Gemini did not finish cleanly (${finishReason}; answer ${answer}, thinking ${thinking}, prompt ${prompt})`;
}

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
      // Built per job: the allowed handles ARE this syllabus. The builder
      // assembles properties dynamically (conceptRefs is conditional), which
      // the SDK's discriminated Schema union can't follow, hence the cast.
      responseSchema: buildQuestionResponseSchema(input.handles) as unknown as ResponseSchema,
      ...QUESTION_GENERATION_CONFIG,
    } as GenerationConfig,
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
    throw new Error(describeUnfinished(candidate.finishReason, result.response.usageMetadata));
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
