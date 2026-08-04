"use client";
// Client Component: inline create form with pending state + error; resets the
// fields once the server action reports success.

import { useActionState, useEffect, useRef } from "react";
import { createSyllabus } from "@/app/(tutor)/syllabi/actions";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useFormDialog } from "@/components/ui/form-dialog";
import type { FormState } from "@/lib/types";

export function CreateSyllabusForm() {
  const formRef = useRef<HTMLFormElement>(null);
  const dialog = useFormDialog();
  const [state, formAction, pending] = useActionState<FormState, FormData>(
    createSyllabus,
    {},
  );

  useEffect(() => {
    if (state.ok) {
      formRef.current?.reset();
      dialog?.close();
    }
  }, [state, dialog]);

  return (
    <form ref={formRef} action={formAction} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="title">Title</Label>
        <Input
          id="title"
          name="title"
          placeholder="e.g. CIE IGCSE Mathematics 0580"
          required
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="subject">Subject</Label>
        <Input id="subject" name="subject" placeholder="e.g. Mathematics" />
      </div>
      <div className="space-y-2">
        <Label htmlFor="level">Level</Label>
        <Input id="level" name="level" placeholder="e.g. IGCSE" />
      </div>
      <div className="space-y-2">
        <Label htmlFor="description">Description</Label>
        <Input id="description" name="description" placeholder="Optional" />
      </div>
      {state.error && <p className="text-sm text-destructive">{state.error}</p>}
      <Button type="submit" disabled={pending}>
        {pending && <Spinner />}
        {pending ? "Creating…" : "Create syllabus"}
      </Button>
    </form>
  );
}
