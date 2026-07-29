"use client";
// Client Component: inline invite form with pending state + error; resets on
// success. Binds the classId to the server action.

import { useActionState, useEffect, useRef } from "react";
import { inviteStudent } from "@/app/(tutor)/classes/[classId]/actions";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useFormDialog } from "@/components/ui/form-dialog";
import type { FormState } from "@/lib/types";

export function InviteStudentForm({ classId }: { classId: string }) {
  const boundAction = inviteStudent.bind(null, classId);
  const dialog = useFormDialog();
  const [state, formAction, pending] = useActionState<FormState, FormData>(
    boundAction,
    {},
  );
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.ok) {
      formRef.current?.reset();
      // Inside a FormDialog the pending-invitation row is the acknowledgement.
      dialog?.close();
    }
  }, [state, dialog]);

  return (
    <form ref={formRef} action={formAction} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="email">Student email</Label>
        <Input
          id="email"
          name="email"
          type="email"
          placeholder="student@example.com"
          required
        />
      </div>
      {state.error && <p className="text-sm text-destructive">{state.error}</p>}
      {state.ok && (
        <p className="text-sm text-muted-foreground">Invitation sent.</p>
      )}
      <Button type="submit" disabled={pending}>
        {pending && <Spinner />}
        {pending ? "Sending…" : "Send invite"}
      </Button>
    </form>
  );
}
