/**
 * The whole of duplicate detection: a concept name reduced to a comparison
 * key. Two concepts are candidate duplicates iff their keys are equal.
 *
 * This is deliberately plain string work rather than embeddings. Calibrated
 * against the real 736-concept corpus, these rules found 45 of the 58 merges
 * embeddings found at their only safe threshold, with better precision and
 * better recall on plurals — and no API call, extension, or tunable number.
 * See docs/superpowers/specs/2026-08-06-concept-dedup-design.md, "Evidence".
 *
 * The key is never shown to a user and is never a display name: the crude
 * singulariser mangles words ("analysis" -> "analysi"), which is harmless for
 * comparison because both sides mangle identically.
 */

/**
 * Dropped before comparison, so "nucleus of the atom" and "the nucleus of the
 * atom" agree. Kept deliberately short — every word removed here is a word
 * that can no longer distinguish two concepts.
 */
const STOPWORDS = new Set([
  "the", "of", "and", "a", "an", "for", "to", "in",
  "on", "its", "it", "from", "with", "between", "by",
]);

/**
 * Crude on purpose. It only has to be *consistent*, not linguistically
 * correct, because it is applied to both sides of every comparison.
 */
function singularise(word: string): string {
  if (word.length > 4 && word.endsWith("ies")) return `${word.slice(0, -3)}y`;
  if (word.endsWith("ses") || word.endsWith("xes")) return word.slice(0, -2);
  if (word.length > 3 && word.endsWith("s") && !word.endsWith("ss")) {
    return word.slice(0, -1);
  }
  return word;
}

export function normalisedKey(name: string): string {
  const tokens = name
    .toLowerCase()
    // Curly and back quotes are a real source of duplicates: the extraction
    // model emits both "coulomb's law" and "coulomb's law".
    .replace(/[''`]/g, "'")
    .replace(/'s\b/g, "")
    .replace(/'/g, "")
    .replace(/[^a-z0-9 ]+/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 0 && !STOPWORDS.has(word))
    .map(singularise)
    // behaviour -> behavior, colour -> color.
    .map((word) => word.replace(/our$/, "or"));

  // Sorting is what makes "Inverse Matrix" and "Matrix Inverse" agree.
  // De-duplicating means a repeated word cannot distinguish two names.
  return [...new Set(tokens)].sort().join(" ");
}
