"use client";
// Client Component: joins a class from an invite. In "create" mode (brand-new
// invitee) it collects a name + password to create the student account; in
// "join" mode (existing student) it's a single confirm button.

import { useActionState } from "react";
import { acceptInvitation } from "@/app/invite/accept/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { FormState } from "@/lib/types";

export function AcceptInviteForm({
  token,
  mode,
}: {
  token: string;
  mode: "create" | "join";
}) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(
    acceptInvitation,
    {},
  );

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="token" value={token} />
      {mode === "create" && (
        <>
          <div className="space-y-2">
            <Label htmlFor="fullName">Your name</Label>
            <Input id="fullName" name="fullName" autoComplete="name" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">Choose a password</Label>
            <Input
              id="password"
              name="password"
              type="password"
              autoComplete="new-password"
              required
            />
            <p className="text-xs text-muted-foreground">At least 8 characters.</p>
          </div>
        </>
      )}
      {state.error && <p className="text-sm text-destructive">{state.error}</p>}
      <Button type="submit" className="w-full" disabled={pending}>
        {pending
          ? "Joining…"
          : mode === "create"
            ? "Create account & join"
            : "Join class"}
      </Button>
    </form>
  );
}
