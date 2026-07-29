"use client";
// Client Component: holds the open/closed state of the edit panel so the detail
// page itself stays a Server Component.

import { useState } from "react";
import { updateSession, deleteSession } from "@/app/sessions/[sessionId]/actions";
import { SessionForm } from "@/components/session-form";
import { Button } from "@/components/ui/button";
import { ConfirmButton } from "@/components/ui/confirm-button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export function EditSessionPanel({
  sessionId,
  title,
  scheduledAt,
}: {
  sessionId: string;
  title: string | null;
  scheduledAt: string;
}) {
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <div className="flex gap-2">
        <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
          Edit lesson
        </Button>
        <ConfirmButton
          action={deleteSession.bind(null, sessionId)}
          title="Delete this lesson?"
          body="Its materials and any homework go with it."
          confirmLabel="Delete"
        >
          Delete
        </ConfirmButton>
      </div>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Edit lesson</CardTitle>
        <CardDescription>
          Changing the time does not move any homework due dates.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <SessionForm
          action={updateSession}
          sessionId={sessionId}
          defaultTitle={title}
          defaultAt={scheduledAt}
          submitLabel="Save changes"
          pendingLabel="Saving…"
        />
        <Button
          variant="ghost"
          size="sm"
          className="w-full"
          onClick={() => setOpen(false)}
        >
          Cancel
        </Button>
      </CardContent>
    </Card>
  );
}
