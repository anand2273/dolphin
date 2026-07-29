"use client";
// Client Component: Next.js requires error boundaries to be client components
// so they can offer reset().

import Link from "next/link";
import { Brand } from "@/components/brand";
import { Button, buttonVariants } from "@/components/ui/button";

export default function ErrorPage({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-4 text-center">
      <Brand />
      <div>
        <h1 className="font-display text-[26px] font-semibold tracking-tight">
          Something went wrong
        </h1>
        <p className="mx-auto mt-2 max-w-sm text-sm text-muted-foreground">
          Not your fault — the page hit an error on our side. Nothing you
          entered has been lost from your classes.
        </p>
      </div>
      <div className="flex items-center gap-2">
        <Button type="button" onClick={reset}>
          Try again
        </Button>
        <Link href="/" className={buttonVariants({ variant: "outline" })}>
          Go to your classes
        </Link>
      </div>
    </main>
  );
}
