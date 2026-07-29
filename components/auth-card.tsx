import { Brand } from "@/components/brand";
import { Card } from "@/components/ui/card";

/**
 * The centered single-card scaffold every signed-out page uses (login, signup,
 * password flows, invite acceptance). Replaces the per-page copies of the same
 * markup. Deliberately shell-less: these pages have no signed-in viewer.
 */
export function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-5 p-4">
      <Brand />
      <Card className="w-full max-w-sm">{children}</Card>
    </main>
  );
}
