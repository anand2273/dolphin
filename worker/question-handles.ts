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
