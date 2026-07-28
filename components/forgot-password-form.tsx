"use client";
// Client Component: drives submission state (pending) and swaps the form for a
// confirmation once the action reports the request was accepted.

import Link from "next/link";
import { useActionState } from "react";
import { requestPasswordReset } from "@/app/(auth)/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { FormState } from "@/lib/types";

export function ForgotPasswordForm() {
  const [state, formAction, pending] = useActionState<FormState, FormData>(
    requestPasswordReset,
    {},
  );

  // Worded so it reads the same whether or not that address has an account —
  // the server deliberately does not say which.
  if (state?.ok) {
    return (
      <div className="space-y-4">
        <p className="text-sm">
          If that address has a Dolphn account, a reset link is on its way. The
          link works once and expires, so open it on this device if you can.
        </p>
        <p className="text-sm text-muted-foreground">
          Didn&apos;t arrive? Check spam, then{" "}
          <Link href="/forgot-password" className="underline">
            try again
          </Link>
          .
        </p>
      </div>
    );
  }

  return (
    <form action={formAction} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="email">Email</Label>
        <Input id="email" name="email" type="email" autoComplete="email" required />
      </div>
      {state?.error && <p className="text-sm text-destructive">{state.error}</p>}
      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? "Sending…" : "Email me a reset link"}
      </Button>
      <p className="text-center text-sm text-muted-foreground">
        Remembered it?{" "}
        <Link href="/login" className="underline">
          Sign in
        </Link>
      </p>
    </form>
  );
}
