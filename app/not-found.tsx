import Link from "next/link";
import { Brand } from "@/components/brand";
import { buttonVariants } from "@/components/ui/button";

/**
 * Serves real 404s AND unauthorized access, which this app deliberately
 * answers with notFound() so existence never leaks. The copy owns that
 * ambiguity instead of showing a stranger a stock error.
 */
export default function NotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-4 text-center">
      <Brand />
      <div>
        <h1 className="font-display text-[26px] font-semibold tracking-tight">
          There&apos;s nothing here
        </h1>
        <p className="mx-auto mt-2 max-w-sm text-sm text-muted-foreground">
          This page doesn&apos;t exist — or it belongs to someone else&apos;s
          class. If a link brought you here, check you&apos;re signed in with
          the account it was shared with.
        </p>
      </div>
      <Link href="/" className={buttonVariants({ variant: "outline" })}>
        Go to your classes
      </Link>
    </main>
  );
}
