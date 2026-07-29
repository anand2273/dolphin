"use client";
// Client Component: dismissing has to clear the query param, which needs the
// router. The message itself is resolved on the server before it gets here.

import { usePathname, useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

/**
 * Acknowledgement for an action whose result the user is navigated away from —
 * currently only "you deleted a lesson, and that is why you are suddenly looking
 * at the class page". Anything whose result is visible in place (a row appearing
 * or vanishing) deliberately gets nothing.
 */
export function Notice({ message }: { message: string }) {
  const router = useRouter();
  const pathname = usePathname();

  return (
    <div
      role="status"
      className="flex items-center justify-between gap-4 rounded-md border bg-muted px-4 py-2 text-sm"
    >
      <span>{message}</span>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        aria-label="Dismiss"
        // Drops the param so a refresh or a shared link doesn't replay it.
        onClick={() => router.replace(pathname)}
      >
        Dismiss
      </Button>
    </div>
  );
}
