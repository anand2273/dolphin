"use client";
// Client Component: owns the open/closed state of a native <dialog>, exactly
// like ConfirmButton. The trigger + dialog pattern lets Server Component pages
// put the existing form components behind a button instead of a sidebar card.

import { createContext, useCallback, useContext, useId, useRef } from "react";
import { Button, type ButtonProps } from "@/components/ui/button";

/**
 * Hosted forms can't receive a close callback across the server-component
 * boundary (pages compose <FormDialog><CreateClassForm/></FormDialog>), so the
 * dialog provides one via context instead. Forms consume it optionally — the
 * same form still works outside any dialog.
 */
const FormDialogContext = createContext<{ close: () => void } | null>(null);

export function useFormDialog() {
  return useContext(FormDialogContext);
}

export function FormDialog({
  trigger,
  triggerVariant = "default",
  title,
  description,
  children,
}: {
  /** Label of the button that opens the dialog. */
  trigger: React.ReactNode;
  triggerVariant?: ButtonProps["variant"];
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const close = useCallback(() => dialogRef.current?.close(), []);
  const headingId = useId();

  return (
    <>
      <Button
        type="button"
        variant={triggerVariant}
        onClick={() => dialogRef.current?.showModal()}
      >
        {trigger}
      </Button>

      <dialog
        ref={dialogRef}
        aria-labelledby={headingId}
        // A click landing on the dialog element itself is a backdrop click —
        // anything inside it targets a child.
        onClick={(e) => {
          if (e.target === dialogRef.current) close();
        }}
        className="fixed inset-0 m-auto h-fit w-[calc(100%-2rem)] max-w-sm rounded-lg border bg-card p-6 text-card-foreground shadow-card backdrop:bg-black/50"
      >
        <h2 id={headingId} className="font-display text-base font-semibold">
          {title}
        </h2>
        {description && (
          <p className="mt-1 text-sm text-muted-foreground">{description}</p>
        )}

        <div className="mt-5">
          <FormDialogContext.Provider value={{ close }}>
            {children}
          </FormDialogContext.Provider>
        </div>
      </dialog>
    </>
  );
}
