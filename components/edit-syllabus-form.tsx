"use client";
// Client Component: pre-filled update form; closes the dialog on success — the
// page's own re-render (revalidatePath) is the acknowledgement.

import { useActionState, useEffect } from "react";
import { updateSyllabus } from "@/app/(tutor)/syllabi/[syllabusId]/actions";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useFormDialog } from "@/components/ui/form-dialog";
import type { FormState } from "@/lib/types";
import type { Syllabus } from "@/lib/db/queries/syllabuses";

export function EditSyllabusForm({ syllabus }: { syllabus: Syllabus }) {
  const dialog = useFormDialog();
  const [state, formAction, pending] = useActionState<FormState, FormData>(
    updateSyllabus,
    {},
  );

  useEffect(() => {
    if (state.ok) dialog?.close();
  }, [state, dialog]);

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="syllabusId" value={syllabus.id} />
      <div className="space-y-2">
        <Label htmlFor="edit-title">Title</Label>
        <Input id="edit-title" name="title" defaultValue={syllabus.title} required />
      </div>
      <div className="space-y-2">
        <Label htmlFor="edit-subject">Subject</Label>
        <Input
          id="edit-subject"
          name="subject"
          defaultValue={syllabus.subject ?? ""}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="edit-level">Level</Label>
        <Input id="edit-level" name="level" defaultValue={syllabus.level ?? ""} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="edit-description">Description</Label>
        <Input
          id="edit-description"
          name="description"
          defaultValue={syllabus.description ?? ""}
        />
      </div>
      {state.error && <p className="text-sm text-destructive">{state.error}</p>}
      <Button type="submit" disabled={pending}>
        {pending && <Spinner />}
        {pending ? "Saving…" : "Save"}
      </Button>
    </form>
  );
}
