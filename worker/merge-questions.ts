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
