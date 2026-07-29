import { cn } from "@/lib/utils";

/** The standard page container under the shell: one column, mockup rhythm. */
export function Page({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <main
      className={cn(
        "mx-auto flex w-full max-w-[960px] flex-col gap-9 px-4 py-8 pb-24 sm:px-6",
        className,
      )}
    >
      {children}
    </main>
  );
}

/**
 * Title block + right-aligned actions. `meta` is the small line above the
 * title (the dashboard's date), `sub` the line under it (a lesson's when).
 */
export function PageHeader({
  title,
  meta,
  sub,
  actions,
}: {
  title: React.ReactNode;
  meta?: React.ReactNode;
  sub?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
      <div className="min-w-0">
        {meta && (
          <p className="mb-0.5 text-[13px] tabular-nums text-faint">{meta}</p>
        )}
        <h1 className="text-balance font-display text-[26px] font-semibold leading-tight tracking-[-0.015em]">
          {title}
        </h1>
        {sub && <div className="mt-1 text-sm text-muted-foreground">{sub}</div>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </header>
  );
}
