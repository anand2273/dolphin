import * as React from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";

/**
 * The list surface from the UI-direction mockup: one bordered panel whose rows
 * divide with hairlines, replacing the old stack of separate Cards.
 */
export function Panel({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "divide-y divide-border overflow-hidden rounded-lg border bg-card text-card-foreground shadow-card",
        className,
      )}
    >
      {children}
    </div>
  );
}

const rowClass = "flex w-full items-center gap-4 px-4 py-3 text-left";

/**
 * One row. With `href` it's a Link and gets the hover treatment; without, it's
 * a plain div whose interactivity (if any) lives in its children.
 */
export function PanelRow({
  href,
  children,
  className,
}: {
  href?: string;
  children: React.ReactNode;
  className?: string;
}) {
  if (href) {
    return (
      <Link href={href} className={cn(rowClass, "hover:bg-muted", className)}>
        {children}
      </Link>
    );
  }
  return <div className={cn(rowClass, className)}>{children}</div>;
}

export function RowMain({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <div className={cn("min-w-0 flex-1", className)}>{children}</div>;
}

export function RowTitle({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("truncate text-sm font-medium", className)}>
      {children}
    </div>
  );
}

export function RowMeta({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "mt-px flex flex-wrap items-center gap-x-1.5 text-[12.5px] tabular-nums text-muted-foreground",
        className,
      )}
    >
      {children}
    </div>
  );
}

/** The `·` between row-meta fragments. */
export function MetaDot() {
  return (
    <span aria-hidden className="text-border-strong">
      ·
    </span>
  );
}

/** Right-hand slot of a row: pills, buttons, the chevron. */
export function RowEnd({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-none items-center gap-2", className)}>
      {children}
    </div>
  );
}

export function Chevron() {
  return (
    <span aria-hidden className="flex-none text-faint">
      ›
    </span>
  );
}

/**
 * The dashed full-width action row at the foot of a panel ("+ Add material").
 * A plain button so client parents can attach handlers; inside a form it can
 * submit. `border-dashed` restyles the hairline the Panel's divide-y gives it.
 */
export const AddRow = React.forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement>
>(({ className, children, type = "button", ...props }, ref) => (
  <button
    ref={ref}
    type={type}
    className={cn(
      "flex w-full items-center justify-center gap-2 border-dashed border-border-strong px-4 py-3 text-[13px] font-medium text-primary hover:bg-primary-tint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
      className,
    )}
    {...props}
  >
    {children}
  </button>
));
AddRow.displayName = "AddRow";
