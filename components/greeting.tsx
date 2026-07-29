"use client";
// Client Component: "good afternoon" and today's date belong to the VIEWER's
// clock, which only the browser knows — the same reasoning as SessionDateTime.

export function Greeting({ name }: { name: string }) {
  const now = new Date();
  const hour = now.getHours();
  const daypart = hour < 12 ? "morning" : hour < 18 ? "afternoon" : "evening";
  const firstName = name.trim().split(/\s+/)[0] || name;

  return (
    <span suppressHydrationWarning>
      Good {daypart}, {firstName}
    </span>
  );
}

/** The small "Thursday 30 July" line above the greeting. */
export function TodayLine() {
  return (
    <span suppressHydrationWarning>
      {new Date().toLocaleDateString(undefined, {
        weekday: "long",
        day: "numeric",
        month: "long",
      })}
    </span>
  );
}
