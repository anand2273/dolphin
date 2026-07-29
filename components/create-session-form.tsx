"use client";
// Client Component: binds the classId to the create action and clears the form
// on success, so a tutor can add several lessons in a row.

import { useState } from "react";
import { createSession } from "@/app/(tutor)/classes/[classId]/actions";
import { SessionForm } from "@/components/session-form";
import { useFormDialog } from "@/components/ui/form-dialog";

export function CreateSessionForm({ classId }: { classId: string }) {
  // Remounting SessionForm is what resets its controlled datetime field.
  const [attempt, setAttempt] = useState(0);
  const dialog = useFormDialog();

  const action = async (prev: Parameters<typeof createSession>[1], formData: FormData) => {
    const result = await createSession(classId, prev, formData);
    if (result.ok) {
      setAttempt((n) => n + 1);
      // Inside a FormDialog the new lesson row is the acknowledgement.
      dialog?.close();
    }
    return result;
  };

  return (
    <SessionForm
      key={attempt}
      action={action}
      submitLabel="Add lesson"
      pendingLabel="Adding…"
    />
  );
}
