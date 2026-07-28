"use client";
// Client Component: drives submission state (pending) and shows inline errors.
// On success the action redirects, so there is no success state to render here.

import { useActionState } from "react";
import { resetPassword } from "@/app/(auth)/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { FormState } from "@/lib/types";

export function ResetPasswordForm() {
  const [state, formAction, pending] = useActionState<FormState, FormData>(
    resetPassword,
    {},
  );

  return (
    <form action={formAction} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="password">New password</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          required
        />
        <p className="text-xs text-muted-foreground">At least 8 characters.</p>
      </div>
      {state?.error && <p className="text-sm text-destructive">{state.error}</p>}
      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? "Saving…" : "Set new password"}
      </Button>
      <p className="text-xs text-muted-foreground">
        Setting a new password signs you out everywhere else.
      </p>
    </form>
  );
}
