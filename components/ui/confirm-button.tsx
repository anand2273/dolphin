"use client";
// Client Component: owns the open/closed state of a native <dialog>. The pages
// that use it stay Server Components — this is the client boundary, the same way
// EditSessionPanel and UploadMaterialForm are.

import { useCallback, useEffect, useId, useRef } from "react";
import { useFormStatus } from "react-dom";
import { Button, type ButtonProps } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";

/**
 * A destructive action behind a confirmation step.
 *
 * Built on the platform's `<dialog showModal()>` rather than a modal library:
 * the focus trap, Esc-to-close, and inert background come for free and cost no
 * dependency. The bound Server Action is handed straight to `<form action>`, so
 * call sites keep the shape they had before the dialog existed.
 */
export function ConfirmButton({
  action,
  title,
  body,
  confirmLabel,
  variant = "ghost",
  size = "sm",
  triggerClassName,
  children,
}: {
  /** A Server Action with its subject already bound. */
  action: () => Promise<void>;
  title: string;
  body: string;
  confirmLabel: string;
  variant?: ButtonProps["variant"];
  size?: ButtonProps["size"];
  /** Extra classes for the trigger, e.g. the quiet danger-link treatment. */
  triggerClassName?: string;
  children: React.ReactNode;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const close = useCallback(() => dialogRef.current?.close(), []);
  const headingId = useId();

  return (
    <>
      <Button
        type="button"
        variant={variant}
        size={size}
        className={triggerClassName}
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

        <form action={action} className="mt-6 flex justify-end gap-2">
          {/* Cancel takes initial focus: the safe choice should be the one a
              stray Enter press lands on. */}
          <Button type="button" variant="outline" size="sm" autoFocus onClick={close}>
            Cancel
          </Button>
          <ConfirmSubmit label={confirmLabel} onSettled={close} />
        </form>
      </dialog>
    </>
  );
}

/**
 * Separate component because `useFormStatus` only reports on a form it is
 * rendered *inside*. Closing on the pending true->false edge covers the case
 * where the action is a no-op and the row this dialog belongs to is never
 * removed — otherwise the dialog would sit there looking like it had hung.
 */
function ConfirmSubmit({
  label,
  onSettled,
}: {
  label: string;
  onSettled: () => void;
}) {
  const { pending } = useFormStatus();
  const wasPending = useRef(false);

  useEffect(() => {
    if (wasPending.current && !pending) onSettled();
    wasPending.current = pending;
  }, [pending, onSettled]);

  return (
    <Button type="submit" variant="destructive" size="sm" disabled={pending}>
      {pending && <Spinner />}
      {label}
    </Button>
  );
}
