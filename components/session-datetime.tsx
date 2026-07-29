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

/**
 * The mockup's left date block on lesson rows: weekday over day-of-month, in
 * the viewer's timezone. Today/past variants derive from the instant, like
 * SessionWhen — the server pass may disagree with the client near midnight,
 * which suppressHydrationWarning absorbs; the value settles after hydration.
 */
export function DateChip({ at }: { at: Date | string }) {
  const date = typeof at === "string" ? new Date(at) : at;
  const now = new Date();
  const isToday = date.toDateString() === now.toDateString();
  const isPast = !isToday && date.getTime() < now.getTime();

  return (
    <span
      suppressHydrationWarning
      aria-hidden
      className={
        "w-[46px] flex-none rounded-sm py-1 text-center leading-tight " +
        (isToday
          ? "bg-primary-tint"
          : isPast
            ? "border border-dashed border-border-strong"
            : "bg-muted")
      }
    >
      <span
        suppressHydrationWarning
        className={
          "block text-[10px] font-semibold uppercase tracking-[0.08em] " +
          (isToday ? "text-primary" : "text-faint")
        }
      >
        {date.toLocaleDateString(undefined, { weekday: "short" })}
      </span>
      <span
        suppressHydrationWarning
        className={
          "block font-display text-[17px] font-semibold tabular-nums " +
          (isToday ? "text-primary" : "text-foreground")
        }
      >
        {date.toLocaleDateString(undefined, { day: "numeric" })}
      </span>
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
