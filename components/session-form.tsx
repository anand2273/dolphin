"use client";
// Client Component: converts the tutor's wall-clock entry into an absolute
// instant. `datetime-local` has no timezone, so only the browser can say what
// "4:00 pm" actually means — it resolves that here and submits an ISO UTC
// string plus the IANA zone, and the server does no timezone arithmetic.

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { FormState } from "@/lib/types";

/** An instant -> the `YYYY-MM-DDTHH:mm` the input expects, in viewer-local time. */
function toLocalInputValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}

export function SessionForm({
  action,
  sessionId,
  defaultTitle,
  defaultAt,
  submitLabel,
  pendingLabel,
}: {
  action: (prev: FormState, formData: FormData) => Promise<FormState>;
  /** Present when editing; the update action requires it. */
  sessionId?: string;
  defaultTitle?: string | null;
  defaultAt?: Date | string;
  submitLabel: string;
  pendingLabel: string;
}) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(
    action,
    {},
  );

  const initial = defaultAt
    ? toLocalInputValue(
        typeof defaultAt === "string" ? new Date(defaultAt) : defaultAt,
      )
    : "";
  const [local, setLocal] = useState(initial);

  // Empty when the entry is blank or unparseable; Zod then rejects it.
  const parsed = local ? new Date(local) : null;
  const iso = parsed && !Number.isNaN(parsed.getTime()) ? parsed.toISOString() : "";

  return (
    <form action={formAction} className="space-y-4">
      {sessionId && <input type="hidden" name="sessionId" value={sessionId} />}
      <input type="hidden" name="scheduledAt" value={iso} />
      <input
        type="hidden"
        name="timezone"
        value={Intl.DateTimeFormat().resolvedOptions().timeZone}
      />

      <div className="space-y-2">
        <Label htmlFor="title">Title</Label>
        <Input
          id="title"
          name="title"
          defaultValue={defaultTitle ?? ""}
          placeholder="e.g. Quadratics"
        />
        <p className="text-xs text-muted-foreground">Optional.</p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="scheduledAtLocal">Date and time</Label>
        <Input
          id="scheduledAtLocal"
          type="datetime-local"
          value={local}
          onChange={(e) => setLocal(e.target.value)}
          required
        />
        <p className="text-xs text-muted-foreground">
          In your local time. Lessons can be scheduled ahead or logged after.
        </p>
      </div>

      {state.error && <p className="text-sm text-destructive">{state.error}</p>}

      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? pendingLabel : submitLabel}
      </Button>
    </form>
  );
}
