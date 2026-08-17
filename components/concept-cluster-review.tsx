"use client";

// Client component: the tutor picks a survivor with radio buttons before
// submitting, which is local state the server cannot hold.

import { useActionState, useState } from "react";
import { mergeConcepts, rejectCluster } from "@/app/(tutor)/concepts/actions";
import { Button } from "@/components/ui/button";
import { PanelRow, RowMeta } from "@/components/ui/panel";

type ClusterConcept = { id: string; name: string; topicCount: number };

export function ConceptClusterReview({
  concepts,
}: {
  concepts: ClusterConcept[];
}) {
  const [survivorId, setSurvivorId] = useState(
    // Default to the most-used name: the one already attached to most topics
    // is the one the tutor has effectively been treating as canonical.
    [...concepts].sort((a, b) => b.topicCount - a.topicCount)[0]?.id ?? "",
  );
  const [mergeState, mergeAction, merging] = useActionState(mergeConcepts, {});
  const [rejectState, rejectAction, rejecting] = useActionState(rejectCluster, {});

  const error = mergeState.error ?? rejectState.error;

  return (
    <PanelRow>
      <div className="flex w-full flex-col gap-3">
        <RowMeta>
          {concepts.length} similar concepts — which name should survive?
        </RowMeta>

        <form action={mergeAction} className="flex flex-col gap-2">
          {concepts.map((concept) => (
            <label key={concept.id} className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="survivorId"
                value={concept.id}
                checked={survivorId === concept.id}
                onChange={() => setSurvivorId(concept.id)}
              />
              <span>{concept.name}</span>
              <span className="text-faint">
                {concept.topicCount} {concept.topicCount === 1 ? "topic" : "topics"}
              </span>
            </label>
          ))}

          {concepts
            .filter((c) => c.id !== survivorId)
            .map((c) => (
              <input key={c.id} type="hidden" name="loserIds" value={c.id} />
            ))}

          <div className="flex items-center gap-2">
            <Button type="submit" size="sm" disabled={merging || rejecting}>
              {merging ? "Merging…" : "Merge into this name"}
            </Button>
          </div>
        </form>

        <form action={rejectAction}>
          {concepts.map((c) => (
            <input key={c.id} type="hidden" name="conceptIds" value={c.id} />
          ))}
          <Button
            type="submit"
            variant="ghost"
            size="sm"
            disabled={merging || rejecting}
          >
            {rejecting ? "Saving…" : "Not duplicates — keep all"}
          </Button>
        </form>

        {error && <p className="text-sm text-destructive">{error}</p>}
      </div>
    </PanelRow>
  );
}
