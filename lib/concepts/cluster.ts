import { normalisedKey } from "./normalise";

export type ClusterableConcept = { id: string; name: string };
export type ConceptCluster = { key: string; concepts: ClusterableConcept[] };

/**
 * Canonical identifier for an unordered pair, matching the
 * CHECK (concept_a_id < concept_b_id) on concept_merge_rejections. Both sides
 * must agree or a stored rejection will never match the pair it describes.
 */
export function pairKey(a: string, b: string): string {
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}

/**
 * Derived on every read — deliberately not stored. A stored candidate goes
 * stale the moment a neighbouring merge changes group membership, and the
 * invalidation logic that would fix that is exactly the thing most likely to
 * be subtly wrong.
 *
 * Grouping is by *equal* key rather than by similarity, so it is transitive
 * and needs no connected-components pass.
 */
export function clusterConcepts(
  concepts: ClusterableConcept[],
  rejectedPairs: ReadonlySet<string>,
): ConceptCluster[] {
  const groups = new Map<string, ClusterableConcept[]>();
  for (const concept of concepts) {
    const key = normalisedKey(concept.name);
    // A name made only of stopwords normalises to nothing and would otherwise
    // pull every such concept into one meaningless cluster.
    if (key === "") continue;
    groups.set(key, [...(groups.get(key) ?? []), concept]);
  }

  const clusters: ConceptCluster[] = [];
  for (const [key, members] of groups) {
    if (members.length < 2) continue;

    // Shown while any pair remains unjudged, so a concept joining a
    // previously-rejected group re-surfaces it rather than inheriting a
    // decision the tutor never made about it.
    const hasUnrejectedPair = members.some((a, i) =>
      members.slice(i + 1).some((b) => !rejectedPairs.has(pairKey(a.id, b.id))),
    );
    if (!hasUnrejectedPair) continue;

    clusters.push({ key, concepts: members });
  }

  return clusters.sort((a, b) => b.concepts.length - a.concepts.length);
}
