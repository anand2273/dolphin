"use client";
// Client Component: owns the open/closed state of a native <dialog> plus the
// typed-phrase gate that arms the destructive submit. Sibling of ConfirmButton,
// whose action shape (() => Promise<void>) has no form fields and no error
// surface.

import { useActionState, useCallback, useId, useRef, useState } from "react";
import { Button, type ButtonProps } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import type { FormState } from "@/lib/types";

/**
 * A destructive action behind a type-to-confirm step: the submit stays disabled
 * until the exact phrase is typed. The phrase gate here is friction, not a
 * guard — the server action re-checks it. Built on the platform's
 * `<dialog showModal()>` like ConfirmButton, for the same zero-dependency
 * reasons. On success the action redirects, which unmounts the dialog; on error
 * the dialog stays open and shows the action's message.
 */
export function TypeToConfirmButton({
  action,
  confirmPhrase,
  title,
  body,
  confirmLabel,
  variant = "destructive",
  size = "sm",
  children,
}: {
  /** A FormState Server Action with its subject already bound. */
  action: (prev: FormState, formData: FormData) => Promise<FormState>;
  /** The exact phrase the user must type before the submit arms. */
  confirmPhrase: string;
  title: string;
  body: string;
  confirmLabel: string;
  variant?: ButtonProps["variant"];
  size?: ButtonProps["size"];
  children: React.ReactNode;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [typed, setTyped] = useState("");
  const [state, formAction, pending] = useActionState<FormState, FormData>(
    action,
    {},
  );
  const headingId = useId();
  const inputId = useId();
  const close = useCallback(() => {
    dialogRef.current?.close();
    setTyped("");
  }, []);
  const armed = typed.trim() === confirmPhrase;

  return (
    <>
      <Button
        type="button"
        variant={variant}
        size={size}
        onClick={() => dialogRef.current?.showModal()}
      >
        {children}
      </Button>

      <dialog
        ref={dialogRef}
        aria-labelledby={headingId}
        // A click landing on the dialog element itself is a backdrop click —
        // anything inside it targets a child.
        onClick={(e) => {
          if (e.target === dialogRef.current) close();
        }}
        className="fixed inset-0 m-auto h-fit w-[calc(100%-2rem)] max-w-sm rounded-lg border bg-card p-6 text-card-foreground shadow-lg backdrop:bg-black/50"
      >
        <h2 id={headingId} className="text-base font-semibold">
          {title}
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">{body}</p>

        <form action={formAction} className="mt-4 space-y-4">
          <div className="space-y-2">
            <Label htmlFor={inputId}>
              Type{" "}
              <span className="font-mono font-medium text-foreground">
                {confirmPhrase}
              </span>{" "}
              to confirm
            </Label>
            <Input
              id={inputId}
              name="confirm"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              autoComplete="off"
              spellCheck={false}
            />
          </div>

          {state.error && (
            <p className="text-sm text-destructive">{state.error}</p>
          )}

          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" size="sm" onClick={close}>
              Cancel
            </Button>
            {/* A disabled default submit also blocks the form's implicit
                (Enter-key) submission, so the phrase gate holds either way. */}
            <Button
              type="submit"
              variant="destructive"
              size="sm"
              disabled={!armed || pending}
            >
              {pending && <Spinner />}
              {confirmLabel}
            </Button>
          </div>
        </form>
      </dialog>
    </>
  );
}
