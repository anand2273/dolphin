"use client";
// Client Component: drives submission state (pending), keeps the typed email
// across the action round-trip, and throttles resends behind a visible timer.

import Link from "next/link";
import { useActionState, useEffect, useState } from "react";
import { requestPasswordReset } from "@/app/(auth)/actions";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { FormState } from "@/lib/types";

const COOLDOWN_SECONDS = 120;

function formatCountdown(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function ForgotPasswordForm() {
  const [state, formAction, pending] = useActionState<FormState, FormData>(
    requestPasswordReset,
    {},
  );

  // Controlled, because React resets an uncontrolled form after an action
  // submits — which would blank the address right when someone wants to resend.
  const [email, setEmail] = useState("");

  // Cooldown is stored as an ABSOLUTE deadline, not a decrementing counter:
  // browsers throttle timers in background tabs, so a naive tick would drift
  // and under-count. Recomputing from the clock stays right regardless.
  const [cooldownUntil, setCooldownUntil] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());

  // Starts on a SUCCESSFUL send, not on click. A rejected address sends no
  // email, so there is nothing to throttle — locking someone out for two
  // minutes over a typo would be punishing them for our validation.
  useEffect(() => {
    if (state?.ok) {
      setNow(Date.now());
      setCooldownUntil(Date.now() + COOLDOWN_SECONDS * 1000);
    }
  }, [state]);

  useEffect(() => {
    if (cooldownUntil === null) return;
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, [cooldownUntil]);

  const secondsLeft = cooldownUntil
    ? Math.max(0, Math.ceil((cooldownUntil - now) / 1000))
    : 0;
  const cooling = secondsLeft > 0;
  const sent = state?.ok === true;

  return (
    <form action={formAction} className="space-y-4">
      {/* The form stays put rather than being swapped for a success panel:
          resending is then the same button, not a link back to this same route
          that cannot reset the action state and so appears to do nothing. */}
      {sent && (
        <div
          role="status"
          className="rounded-md border border-border bg-muted/50 p-3 text-sm"
        >
          <p>
            If that address has a Dolphn account, a reset link is on its way. It
            works once and then expires.
          </p>
          <p className="mt-2 text-muted-foreground">
            Not there? Check spam — delivery can lag by a minute — then send
            another.
          </p>
        </div>
      )}
      <div className="space-y-2">
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
      </div>
      {state?.error && <p className="text-sm text-destructive">{state.error}</p>}
      <Button type="submit" className="w-full" disabled={pending || cooling}>
        {pending && <Spinner />}
        {pending
          ? "Sending…"
          : cooling
            ? `Send another link in ${formatCountdown(secondsLeft)}`
            : sent
              ? "Send another link"
              : "Email me a reset link"}
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
