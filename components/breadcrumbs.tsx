import Link from "next/link";

export type Crumb = {
  label: string;
  /** Omitted when the crumb has no page to point at — a student has no class
   *  route, so their class crumb is context, not navigation. */
  href?: string;
};

/**
 * The one way back. Replaces the ad-hoc "← Dashboard" links that used to differ
 * per page; the last crumb is always the current page and is never a link.
 */
export function Breadcrumbs({ items }: { items: Crumb[] }) {
  return (
    <nav aria-label="Breadcrumb">
      <ol className="flex flex-wrap items-center gap-1.5 text-sm text-muted-foreground">
        {items.map((item, i) => {
          const isLast = i === items.length - 1;
          return (
            <li key={`${item.label}-${i}`} className="flex items-center gap-1.5">
              {item.href && !isLast ? (
                <Link href={item.href} className="hover:text-foreground hover:underline">
                  {item.label}
                </Link>
              ) : (
                <span
                  aria-current={isLast ? "page" : undefined}
                  className={isLast ? "truncate text-foreground" : undefined}
                >
                  {item.label}
                </span>
              )}
              {!isLast && (
                <span aria-hidden className="text-border">
                  /
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
