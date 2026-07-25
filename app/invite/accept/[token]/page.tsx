import { redirect } from "next/navigation";
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
    // The email link should have signed them in via /auth/confirm. If not,
    // send them to log in and return here.
    redirect(`/login?next=${encodeURIComponent(`/invite/accept/${token}`)}`);
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
