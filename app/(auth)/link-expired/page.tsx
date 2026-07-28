import Link from "next/link";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

/**
 * Where /auth/confirm sends someone whose emailed link no longer verifies —
 * already opened, expired, or truncated by their mail client. Email links are
 * single-use, so this is a normal outcome, not an error state. It must never
 * dump an invited student on /login: they have no password yet, so a login form
 * is a dead end.
 */
export default async function LinkExpiredPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  const kind = next?.startsWith("/invite/accept/")
    ? "invite"
    : next === "/reset-password"
      ? "recovery"
      : "magiclink";

  const description = {
    invite:
      "Invitation links work once and then expire. Ask your tutor to send the invitation again — the new email will let you set a password and join.",
    recovery:
      "Password reset links work once and then expire. Request another and open the newest email — an older link in your inbox will not work.",
    magiclink:
      "Sign-in links work once and then expire. Request a new one to continue.",
  }[kind];

  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-lg">This link has already been used</CardTitle>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
        <CardContent>
          {/* A dead recovery link means the password is still unknown, so /login
              is the same dead end it is for an invitee. Send them for a new one. */}
          {kind === "recovery" ? (
            <p className="text-sm text-muted-foreground">
              <Link href="/forgot-password" className="underline">
                Send a new reset link
              </Link>
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">
              Already set a password?{" "}
              <Link href="/login" className="underline">
                Sign in
              </Link>
              .
            </p>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
