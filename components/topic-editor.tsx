"use client";
// Client Component: one per topic, rendered as a <details> row — the same
// disclosure pattern the class page uses for past lessons, so a row can host
// an editor without inventing a button-as-row trigger. Three independent
// action states (save, link, create-concept) live side by side here.

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  createConcept,
  deleteTopic,
  linkTopicConcept,
  unlinkTopicConcept,
  updateTopic,
} from "@/app/(tutor)/syllabi/[syllabusId]/actions";
import { Button } from "@/components/ui/button";
import { ConfirmButton } from "@/components/ui/confirm-button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Pill } from "@/components/ui/pill";
import { Spinner } from "@/components/ui/spinner";
import type { Concept, TopicWithConcepts } from "@/lib/db/queries/syllabuses";
import type { FormState } from "@/lib/types";

export function TopicEditor({
  topic,
  allConcepts,
}: {
  topic: TopicWithConcepts;
  allConcepts: Concept[];
}) {
  const router = useRouter();
  const [newConceptName, setNewConceptName] = useState("");

  const [saveState, saveAction, saving] = useActionState<FormState, FormData>(
    updateTopic,
    {},
  );
  const [linkState, linkAction, linking] = useActionState<FormState, FormData>(
    linkTopicConcept,
    {},
  );
  const [createState, createAction, creating] = useActionState<
    FormState,
    FormData
  >(createConcept, {});

  useEffect(() => {
    if (createState.ok) {
      setNewConceptName("");
      router.refresh();
    }
  }, [createState, router]);

  const linkedIds = new Set(topic.concepts.map((c) => c.id));
  const linkable = allConcepts.filter((c) => !linkedIds.has(c.id));

  return (
    <details className="group">
      <summary className="flex cursor-pointer select-none list-none items-center gap-4 px-4 py-3 text-left hover:bg-muted [&::-webkit-details-marker]:hidden">
        <span
          aria-hidden
          className="text-faint transition-transform group-open:rotate-90"
        >
          ›
        </span>
        <span className="min-w-0 flex-1 truncate text-sm font-medium">
          {topic.name}
        </span>
        <Pill>
          {topic.concepts.length}{" "}
          {topic.concepts.length === 1 ? "concept" : "concepts"}
        </Pill>
      </summary>

      <div className="space-y-5 border-t px-4 py-4">
        <form action={saveAction} className="space-y-3">
          <input type="hidden" name="topicId" value={topic.id} />
          <div className="space-y-2">
            <Label htmlFor={`topic-name-${topic.id}`}>Name</Label>
            <Input
              id={`topic-name-${topic.id}`}
              name="name"
              defaultValue={topic.name}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor={`topic-desc-${topic.id}`}>Description</Label>
            <Input
              id={`topic-desc-${topic.id}`}
              name="description"
              defaultValue={topic.description ?? ""}
            />
          </div>
          {saveState.error && (
            <p className="text-sm text-destructive">{saveState.error}</p>
          )}
          <Button type="submit" size="sm" disabled={saving}>
            {saving && <Spinner />}
            {saving ? "Saving…" : "Save"}
          </Button>
        </form>

        <div className="space-y-2">
          <Label>Concepts</Label>
          {topic.concepts.length === 0 ? (
            <p className="text-[12.5px] text-muted-foreground">
              No concepts linked yet.
            </p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {topic.concepts.map((concept) => (
                <form
                  key={concept.id}
                  action={unlinkTopicConcept.bind(null, topic.id, concept.id)}
                >
                  <button
                    type="submit"
                    className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[11.5px] font-medium text-muted-foreground hover:bg-destructive-tint hover:text-destructive"
                    title="Remove from this topic"
                  >
                    {concept.name}
                    <span aria-hidden>×</span>
                  </button>
                </form>
              ))}
            </div>
          )}

          {linkable.length > 0 && (
            <form action={linkAction} className="flex items-end gap-2 pt-1">
              <input type="hidden" name="topicId" value={topic.id} />
              <div className="flex-1 space-y-1">
                <Label htmlFor={`link-concept-${topic.id}`} className="text-xs">
                  Link an existing concept
                </Label>
                <select
                  id={`link-concept-${topic.id}`}
                  name="conceptId"
                  required
                  className="flex h-9 w-full rounded-sm border border-input bg-card px-3 py-2 text-sm"
                >
                  {linkable.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
              <Button type="submit" size="sm" variant="outline" disabled={linking}>
                {linking && <Spinner />}
                Link
              </Button>
            </form>
          )}
          {linkState.error && (
            <p className="text-sm text-destructive">{linkState.error}</p>
          )}

          <form action={createAction} className="flex items-end gap-2 pt-1">
            <div className="flex-1 space-y-1">
              <Label htmlFor={`new-concept-${topic.id}`} className="text-xs">
                Or create a new concept
              </Label>
              <Input
                id={`new-concept-${topic.id}`}
                name="name"
                value={newConceptName}
                onChange={(e) => setNewConceptName(e.target.value)}
                placeholder="e.g. Quadratic Formula"
              />
            </div>
            <Button type="submit" size="sm" variant="outline" disabled={creating}>
              {creating && <Spinner />}
              Create
            </Button>
          </form>
          {createState.error && (
            <p className="text-sm text-destructive">{createState.error}</p>
          )}
          {createState.ok && (
            <p className="text-[12.5px] text-muted-foreground">
              Created — pick it from the list above to link it here.
            </p>
          )}
        </div>

        <div className="border-t pt-3">
          <ConfirmButton
            action={deleteTopic.bind(null, topic.id)}
            title="Delete this topic?"
            body={`"${topic.name}" and its concept links will be removed. Concepts themselves are not deleted.`}
            confirmLabel="Delete topic"
            triggerClassName="h-auto px-1 py-0.5 text-[13px] font-normal text-faint underline underline-offset-2 hover:bg-transparent hover:text-destructive"
          >
            Delete this topic…
          </ConfirmButton>
        </div>
      </div>
    </details>
  );
}
