"use client";
// Client Component: drives submission state (pending) and shows inline
// validation/auth errors. The server action + CTA are passed in so the same
// form serves both tutor (/signup) and student (/signup/student) signups.

import Link from "next/link";
import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { FormState } from "@/lib/types";

type Action = (state: FormState, formData: FormData) => Promise<FormState>;

export function SignupForm({
  action,
  submitLabel,
  altHref,
  altLabel,
}: {
  action: Action;
  submitLabel: string;
  altHref: string;
  altLabel: string;
}) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(
    action,
    {},
  );

  return (
    <form action={formAction} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="fullName">Your name</Label>
        <Input id="fullName" name="fullName" autoComplete="name" />
      </div>
      <div className="space-y-2">
        <Label htmlFor="email">Email</Label>
        <Input id="email" name="email" type="email" autoComplete="email" required />
      </div>
      <div className="space-y-2">
        <Label htmlFor="password">Password</Label>
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
        {pending ? "Creating account…" : submitLabel}
      </Button>
      <p className="text-center text-sm text-muted-foreground">
        <Link href={altHref} className="underline">
          {altLabel}
        </Link>
      </p>
    </form>
  );
}
