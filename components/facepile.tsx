import { cn } from "@/lib/utils";

function initials(nameOrEmail: string): string {
  const words = nameOrEmail.trim().split(/\s+/).filter(Boolean);
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
  return nameOrEmail.slice(0, 2).toUpperCase();
}

/** Overlapping initial circles for a class's students. */
export function Facepile({
  names,
  max = 3,
  className,
}: {
  names: string[];
  max?: number;
  className?: string;
}) {
  const shown = names.slice(0, max);
  const extra = names.length - shown.length;

  return (
    <span className={cn("flex", className)}>
      {shown.map((n, i) => (
        <span
          key={`${n}-${i}`}
          title={n}
          className="-ml-1.5 grid size-[22px] place-items-center rounded-full border-2 border-card bg-muted text-[10px] font-semibold text-muted-foreground first:ml-0"
        >
          {initials(n)}
        </span>
      ))}
      {extra > 0 && (
        <span className="-ml-1.5 grid size-[22px] place-items-center rounded-full border-2 border-card bg-muted text-[10px] font-semibold text-muted-foreground">
          +{extra}
        </span>
      )}
    </span>
  );
}
