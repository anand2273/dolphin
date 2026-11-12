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
  type Slot = { q: MergedQuestion; key: string; seq: number; lastChunk: number };
  const slots: Slot[] = [];

  // A section heading applies to everything after it until the next one, but
  // a chunk that starts past the heading never sees it, so the model leaves
  // sectionLabel empty there. Carry the last heading forward in document
  // order; otherwise the overlap copy of a question keys differently from the
  // original and both survive (seen on a real paper, 2026-11-11).
  let currentSection: string | null = null;

  chunks.forEach((chunk, chunkIndex) => {
    for (const raw of chunk.result.questions) {
      const q = toMerged(chunk, raw);
      if (q.sectionLabel) currentSection = q.sectionLabel;
      else q.sectionLabel = currentSection;
      const key = keyOf(q.sectionLabel, q.label);
      // An overlap duplicate is the same key, intersecting pages, and a
      // DIFFERENT chunk: one chunk never repeats a question through overlap,
      // so two same-numbered items from one chunk are two questions (sections
      // restarting their numbering without a heading the model caught). An
      // unlabeled question has no identity to match on, so it never merges.
      const dup = normaliseQuestionLabel(q.label)
        ? slots.find(
            (s) =>
              s.key === key &&
              s.lastChunk !== chunkIndex &&
              s.q.startPage <= q.endPage &&
              q.startPage <= s.q.endPage,
          )
        : undefined;
      if (!dup) {
        slots.push({ q, key, seq: slots.length, lastChunk: chunkIndex });
        continue;
      }
      const winner = moreComplete(q, dup.q) ? q : dup.q;
      dup.q = {
        ...winner,
        startPage: Math.min(q.startPage, dup.q.startPage),
        endPage: Math.max(q.endPage, dup.q.endPage),
      };
      dup.lastChunk = chunkIndex;
    }
  });

  const documentOrder = (a: Slot, b: Slot) => a.q.startPage - b.q.startPage || a.seq - b.seq;

  // Collect answer-key entries, deduped: the overlap page repeats them. The
  // answer text is part of the identity, so two different "1" entries on one
  // key page are two entries, not one overlap repeat.
  type Entry = { partKey: string; answer: string };
  type Group = { candidates: Slot[]; entries: Entry[] };
  const groups = new Map<string, Group>();
  const seenAnswers = new Set<string>();
  let unpairedAnswers = 0;

  const entries = chunks.flatMap((chunk) =>
    chunk.result.answers.map((a) => ({ a, page: toAbsolute(chunk, a.page) })),
  );
  entries.sort((x, y) => x.page - y.page); // stable: keeps within-page order

  for (const { a, page } of entries) {
    const answer = a.answer.trim();
    const qKey = normaliseQuestionLabel(a.questionLabel);
    const partKey = a.partLabel ? normalisePartLabel(a.partLabel) : "";
    const sKey = normaliseSection(a.sectionLabel);
    const id = `${sKey}|${qKey}|${partKey}|${page}|${answer.toLowerCase().replace(/\s+/g, " ").slice(0, 80)}`;
    if (seenAnswers.has(id)) continue;
    seenAnswers.add(id);
    if (!qKey || !answer) {
      unpairedAnswers++;
      continue;
    }

    // Prefer an exact (section, label) match; answer keys often drop or
    // reword the section heading, so fall back to the label alone.
    const exact = slots.filter((s) => s.key === keyOf(a.sectionLabel, a.questionLabel));
    const groupKey = exact.length ? `x:${sKey}|${qKey}|${partKey}` : `l:${qKey}|${partKey}`;
    let group = groups.get(groupKey);
    if (!group) {
      const candidates = exact.length
        ? exact
        : slots.filter((s) => normaliseQuestionLabel(s.q.label) === qKey);
      group = { candidates: [...candidates].sort(documentOrder), entries: [] };
      groups.set(groupKey, group);
    }
    group.entries.push({ partKey, answer });
  }

  // A target that already took an answer-key entry; a second one is unpaired.
  const keyed = new Set<object>();
  const assign = (target: MergedQuestion, entry: Entry) => {
    if (entry.partKey) {
      const part = target.parts.find((p) => normalisePartLabel(p.label) === entry.partKey);
      if (!part || keyed.has(part)) return void unpairedAnswers++;
      if (part.answer !== null) return; // inline wins, silently
      part.answer = entry.answer;
      keyed.add(part);
    } else if (target.parts.length === 0) {
      if (keyed.has(target)) return void unpairedAnswers++;
      if (target.answer !== null) return;
      target.answer = entry.answer;
      keyed.add(target);
    } else {
      unpairedAnswers++; // a whole-question answer has no single home on a multi-part question
    }
  };

  for (const { candidates, entries: groupEntries } of groups.values()) {
    if (candidates.length === 1) {
      for (const e of groupEntries) assign(candidates[0].q, e);
    } else if (candidates.length > 1 && groupEntries.length === candidates.length) {
      // Same label repeated across sections, one key entry per occurrence:
      // the n-th entry belongs to the n-th question. Any other shape is a
      // guess, and a wrong answer on a draft is worse than a counted gap.
      groupEntries.forEach((e, i) => assign(candidates[i].q, e));
    } else {
      unpairedAnswers += groupEntries.length;
    }
  }

  const questions = slots.sort(documentOrder).map((s) => s.q);
  return { questions, unpairedAnswers };
}
