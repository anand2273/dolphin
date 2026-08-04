"use client";
// Client Component: binds the syllabusId to the create action, mirrors
// create-session-form.tsx's shape.

import { useActionState, useEffect } from "react";
import { createTopic } from "@/app/(tutor)/syllabi/[syllabusId]/actions";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useFormDialog } from "@/components/ui/form-dialog";
import type { FormState } from "@/lib/types";

export function CreateTopicForm({ syllabusId }: { syllabusId: string }) {
  const dialog = useFormDialog();
  const [state, formAction, pending] = useActionState<FormState, FormData>(
    createTopic,
    {},
  );

  useEffect(() => {
    if (state.ok) dialog?.close();
  }, [state, dialog]);

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="syllabusId" value={syllabusId} />
      <div className="space-y-2">
        <Label htmlFor="topic-name">Name</Label>
        <Input id="topic-name" name="name" placeholder="e.g. Algebra" required />
      </div>
      <div className="space-y-2">
        <Label htmlFor="topic-description">Description</Label>
        <Input id="topic-description" name="description" placeholder="Optional" />
      </div>
      {state.error && <p className="text-sm text-destructive">{state.error}</p>}
      <Button type="submit" disabled={pending}>
        {pending && <Spinner />}
        {pending ? "Adding…" : "Add topic"}
      </Button>
    </form>
  );
}
