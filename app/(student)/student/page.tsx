import { requireStudent } from "@/lib/auth/guards";
import {
  listEnrolledClasses,
  listPendingInvitesForEmail,
} from "@/lib/db/queries/invitations";
import { signOut } from "@/app/(auth)/actions";
import { acceptPendingInvite } from "@/app/invite/accept/actions";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export default async function StudentHome() {
  const { user, profile } = await requireStudent();

  const [classes, pendingInvites] = await Promise.all([
    listEnrolledClasses(user.id),
    listPendingInvitesForEmail(user.email),
  ]);

  return (
    <main className="mx-auto max-w-xl space-y-6 p-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Your classes</h1>
          <p className="text-sm text-muted-foreground">
            {profile?.fullName ?? user.email}
          </p>
        </div>
        <form action={signOut}>
          <Button variant="outline" size="sm" type="submit">
            Sign out
          </Button>
        </form>
      </header>

      {pendingInvites.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-medium text-muted-foreground">
            Invitations
          </h2>
          {pendingInvites.map(({ invitation, className, tutorName }) => (
            <Card key={invitation.id}>
              <CardContent className="flex items-center justify-between p-4">
                <div>
                  <p className="text-sm font-medium">{className}</p>
                  <p className="text-xs text-muted-foreground">
                    from {tutorName ?? "a tutor"}
                  </p>
                </div>
                <form action={acceptPendingInvite.bind(null, invitation.id)}>
                  <Button size="sm" type="submit">
                    Accept
                  </Button>
                </form>
              </CardContent>
            </Card>
          ))}
        </section>
      )}

      {classes.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">No classes yet</CardTitle>
            <CardDescription>
              When your tutor invites you, your class will appear here.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <div className="space-y-3">
          {classes.map((c) => (
            <Card key={c.classId}>
              <CardHeader>
                <CardTitle className="text-base">{c.name}</CardTitle>
                <CardDescription>
                  {c.subject ? `${c.subject} · ` : ""}
                  {c.tutorName ?? "Your tutor"}
                </CardDescription>
              </CardHeader>
            </Card>
          ))}
        </div>
      )}
    </main>
  );
}
