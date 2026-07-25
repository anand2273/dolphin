import Link from "next/link";
import { getAuthUser, getProfile } from "@/lib/auth/session";
import { getInvitationByToken } from "@/lib/db/queries/invitations";
import {
  evaluateInviteAcceptance,
  inviteRejectionMessage,
} from "@/lib/auth/invite-access";
import { AcceptInviteForm } from "@/components/accept-invite-form";
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

export default async function AcceptInvitePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  const user = await getAuthUser();
  if (!user) {
    // Reaching this page unauthenticated means /auth/confirm never ran (the
    // link was opened out of context, or the URL was copied by hand). Do NOT
    // bounce to /login: a brand-new invitee has no password, so the login form
    // is a dead end and they end up unable to use their own email address.
    return (
      <Shell>
        <CardHeader>
          <CardTitle className="text-lg">Open this from your invitation email</CardTitle>
          <CardDescription>
            The link in the email signs you in first, then brings you here to
            create your account and join the class. If the email link has stopped
            working, ask your tutor to send the invitation again.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Already have a TutorOS student account?{" "}
            <Link href="/login" className="underline">
              Sign in
            </Link>{" "}
            — pending invitations are waiting on your dashboard.
          </p>
        </CardContent>
      </Shell>
    );
  }

  const row = await getInvitationByToken(token);
  const verdict = evaluateInviteAcceptance({
    invitation: row
      ? {
          email: row.invitation.email,
          status: row.invitation.status,
          expiresAt: row.invitation.expiresAt,
        }
      : null,
    userEmail: user.email,
  });

  if (!verdict.ok) {
    return (
      <Shell>
        <CardHeader>
          <CardTitle className="text-lg">Can&apos;t accept this invite</CardTitle>
          <CardDescription>{inviteRejectionMessage(verdict.reason)}</CardDescription>
        </CardHeader>
      </Shell>
    );
  }

  const profile = await getProfile(user.id);

  // A tutor account cannot join a class as a student (strict separation).
  if (profile?.role === "tutor") {
    return (
      <Shell>
        <CardHeader>
          <CardTitle className="text-lg">Signed in as a tutor</CardTitle>
          <CardDescription>
            Sign out and use the invite link again to join {row!.className} as a
            student.
          </CardDescription>
        </CardHeader>
      </Shell>
    );
  }

  // Existing student -> one-click join. Brand-new invitee -> create account.
  const mode = profile ? "join" : "create";

  return (
    <Shell>
      <CardHeader>
        <CardTitle className="text-lg">Join {row!.className}</CardTitle>
        <CardDescription>
          {mode === "create"
            ? `Invited by ${row!.tutorName ?? "your tutor"}. Create your student account to join as ${user.email}.`
            : `Invited by ${row!.tutorName ?? "your tutor"}. Join as ${user.email}.`}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <AcceptInviteForm token={token} mode={mode} />
      </CardContent>
    </Shell>
  );
}
