import Link from "next/link";
import { requireStudent } from "@/lib/auth/guards";
import { listSessionsForClass } from "@/lib/db/queries/sessions";
import { SessionDateTime, SessionWhen } from "@/components/session-datetime";
import {
  listEnrolledClasses,
  listPendingInvitesForEmail,
} from "@/lib/db/queries/invitations";
import { acceptPendingInvite } from "@/app/invite/accept/actions";
import { Page, PageHeader } from "@/components/page";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export default async function StudentHome() {
  const { user } = await requireStudent();

  const [classes, pendingInvites] = await Promise.all([
    listEnrolledClasses(user.id),
    listPendingInvitesForEmail(user.email),
  ]);

  // Each lookup re-checks enrollment inside listSessionsForClass — the class
  // list is not treated as proof of access.
  const sessionsByClass = new Map(
    await Promise.all(
      classes.map(
        async (c) =>
          [c.classId, await listSessionsForClass(user.id, c.classId)] as const,
      ),
    ),
  );

  return (
    <Page>
      <PageHeader title="Your classes" />

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
              <CardContent className="space-y-1">
                {(sessionsByClass.get(c.classId) ?? []).length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No lessons scheduled yet.
                  </p>
                ) : (
                  sessionsByClass.get(c.classId)!.map((s) => (
                    <Link
                      key={s.id}
                      href={`/sessions/${s.id}`}
                      className="flex items-center justify-between gap-4 rounded px-2 py-2 hover:bg-muted"
                    >
                      <div>
                        <p className="text-sm">{s.title ?? "Untitled lesson"}</p>
                        <p className="text-xs text-muted-foreground">
                          <SessionDateTime at={s.scheduledAt} />
                        </p>
                      </div>
                      <SessionWhen at={s.scheduledAt} />
                    </Link>
                  ))
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </Page>
  );
}
