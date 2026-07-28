import Link from "next/link";
import { getAuthUser } from "@/lib/auth/session";
import { hasRecoverySession } from "@/lib/auth/recovery";
import { ResetPasswordForm } from "@/components/reset-password-form";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-sm">{children}</Card>
    </main>
  );
}

/**
 * Where /auth/confirm lands a `type=recovery` link.
 *
 * Two conditions, both required: a session, and the recovery marker minted for
 * that same user. A session on its own would make this a change-password form
 * that never asks for the old password. The action re-checks both — this page
 * only decides what to render.
 */
export default async function ResetPasswordPage() {
  const user = await getAuthUser();
  const fromRecoveryLink = user ? await hasRecoverySession(user.id) : false;

  if (!user || !fromRecoveryLink) {
    // Never a login form: the whole reason to be here is not knowing the
    // password. The way forward is a fresh link, not a sign-in attempt.
    return (
      <Shell>
        <CardHeader>
          <CardTitle className="text-lg">Open this from your reset email</CardTitle>
          <CardDescription>
            The link in the email signs you in first, then brings you here to
            choose a new password. Links work once and expire after a while, so
            if yours has stopped working, ask for another.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            <Link href="/forgot-password" className="underline">
              Send a new reset link
            </Link>
          </p>
        </CardContent>
      </Shell>
    );
  }

  return (
    <Shell>
      <CardHeader>
        <CardTitle className="text-lg">Choose a new password</CardTitle>
        <CardDescription>Setting a new password for {user.email}.</CardDescription>
      </CardHeader>
      <CardContent>
        <ResetPasswordForm />
      </CardContent>
    </Shell>
  );
}
