import { cn } from "@/lib/utils";

/** The Dolphn mark + wordmark, shared by the top bar and the auth pages. */
export function Brand({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "flex items-center gap-2 font-display text-base font-semibold tracking-tight",
        className,
      )}
    >
      <span
        aria-hidden
        className="grid size-6 flex-none place-items-center rounded-[7px] bg-primary text-primary-foreground"
      >
        <svg
          width="13"
          height="13"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.6"
          strokeLinecap="round"
        >
          <path d="M4 15 Q12 4 20 15" />
          <path d="M9 15 Q12 11 15 15" />
        </svg>
      </span>
      Dolphn
    </span>
  );
}
