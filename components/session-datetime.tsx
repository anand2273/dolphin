"use client";
// Client Component: a session's instant must render in the VIEWER's timezone
// (CLAUDE.md), which only the browser knows. The server's own timezone is
// irrelevant and would be wrong for everyone else.

export function SessionDateTime({
  at,
  tutorTimezone,
  className,
}: {
  at: Date | string;
  /** The zone the tutor scheduled in. Shown only when it isn't the viewer's. */
  tutorTimezone?: string;
  className?: string;
}) {
  const date = typeof at === "string" ? new Date(at) : at;
  const viewerZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  const formatted = date.toLocaleString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

  return (
    // The server pass formats in the server's zone, so the first client render
    // legitimately differs. The value is correct after hydration.
    <span className={className} suppressHydrationWarning>
      {formatted}
      {tutorTimezone && tutorTimezone !== viewerZone && (
        <span className="text-muted-foreground"> · set in {tutorTimezone}</span>
      )}
    </span>
  );
}

/** Past vs future is DERIVED from the instant — there is no status column. */
export function SessionWhen({ at }: { at: Date | string }) {
  const date = typeof at === "string" ? new Date(at) : at;
  const planned = date.getTime() > Date.now();
  return (
    <span
      suppressHydrationWarning
      className={
        planned
          ? "rounded bg-primary/10 px-1.5 py-0.5 text-xs text-primary"
          : "rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground"
      }
    >
      {planned ? "Planned" : "Delivered"}
    </span>
  );
}
