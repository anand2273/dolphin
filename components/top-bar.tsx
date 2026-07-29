import Link from "next/link";
import { signOut } from "@/app/(auth)/actions";

/**
 * The persistent shell header. Rendered by the signed-in route-group layouts —
 * never by the (auth) pages, which are signed out and centered. Sign-out lives
 * here and nowhere else, so it is reachable from every signed-in page.
 */
export function TopBar({
  name,
  homeHref,
}: {
  /** Display name for the avatar initial; falls back to email upstream. */
  name: string;
  /** Role-resolved home: /dashboard for tutors, /student for students. */
  homeHref: string;
}) {
  const initial = (name.trim()[0] ?? "?").toUpperCase();

  return (
    <header className="sticky top-0 z-20 border-b bg-background">
      <div className="mx-auto flex h-[54px] w-full max-w-[960px] items-center gap-5 px-4 sm:px-6">
        <Link
          href={homeHref}
          aria-label="Dolphn home"
          className="flex items-center gap-2 font-display text-base font-semibold tracking-tight"
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
        </Link>
        <nav aria-label="Primary" className="ml-2 hidden sm:flex">
          <Link
            href={homeHref}
            className="rounded-sm bg-muted px-2.5 py-1.5 text-[13.5px] font-medium text-foreground"
            aria-current="page"
          >
            Classes
          </Link>
        </nav>
        <div className="ml-auto flex items-center gap-3">
          <form action={signOut}>
            <button
              type="submit"
              className="rounded-sm px-1.5 py-1 text-[13px] text-faint hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Sign out
            </button>
          </form>
          <span
            aria-hidden
            className="grid size-7 flex-none place-items-center rounded-full bg-primary-tint text-xs font-semibold text-primary"
          >
            {initial}
          </span>
        </div>
      </div>
    </header>
  );
}
