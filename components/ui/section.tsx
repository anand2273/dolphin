import { cn } from "@/lib/utils";

export function Section({
  children,
  className,
  ...props
}: React.HTMLAttributes<HTMLElement>) {
  return (
    <section className={cn("flex flex-col gap-3", className)} {...props}>
      {children}
    </section>
  );
}

/** Uppercase tracked section label, with an optional right-aligned action. */
export function SectionLabel({
  children,
  action,
}: {
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <h2 className="text-[11px] font-semibold uppercase tracking-[0.09em] text-faint">
        {children}
      </h2>
      {action}
    </div>
  );
}
