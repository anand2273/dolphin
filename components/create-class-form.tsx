"use client";
// Client Component: inline create form with pending state + error; resets the
// fields once the server action reports success.

import { useActionState, useEffect, useRef } from "react";
import { createClass } from "@/app/(tutor)/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { FormState } from "@/lib/types";

export function CreateClassForm() {
  const formRef = useRef<HTMLFormElement>(null);
  const [state, formAction, pending] = useActionState<FormState, FormData>(
    createClass,
    {},
  );

  useEffect(() => {
    if (state.ok) formRef.current?.reset();
  }, [state]);

  return (
    <form ref={formRef} action={formAction} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="name">Class name</Label>
        <Input id="name" name="name" placeholder="e.g. Priya — A-Level Maths" required />
      </div>
      <div className="space-y-2">
        <Label htmlFor="subject">Subject</Label>
        <Input id="subject" name="subject" placeholder="e.g. Mathematics" />
      </div>
      {state.error && <p className="text-sm text-destructive">{state.error}</p>}
      <Button type="submit" disabled={pending}>
        {pending ? "Creating…" : "Create class"}
      </Button>
    </form>
  );
}
