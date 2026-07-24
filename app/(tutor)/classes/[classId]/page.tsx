import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAuthUser } from "@/lib/auth/session";
import { assertClassOwner, AuthzError } from "@/lib/auth/authz";
import {
  listPendingInvitesForClass,
  listRoster,
} from "@/lib/db/queries/invitations";
import { InviteStudentForm } from "@/components/invite-student-form";
import { revokeInvitation } from "./actions";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export default async function ClassPage({
  params,
}: {
  params: Promise<{ classId: string }>;
}) {
  const { classId } = await params;
  const user = await requireAuthUser();

  let klass;
  try {
    klass = await assertClassOwner(user.id, classId);
  } catch (e) {
    if (e instanceof AuthzError) notFound();
    throw e;
  }

  const [roster, pending] = await Promise.all([
    listRoster(classId),
    listPendingInvitesForClass(classId),
  ]);

  return (
    <main className="mx-auto max-w-3xl space-y-8 p-6">
      <div>
        <Link href="/dashboard" className="text-sm text-muted-foreground underline">
          ← Dashboard
        </Link>
        <h1 className="mt-2 text-2xl font-semibold">{klass.name}</h1>
        {klass.subject && (
          <p className="text-sm text-muted-foreground">{klass.subject}</p>
        )}
      </div>

      <section className="grid gap-6 md:grid-cols-[1fr_320px]">
        <div className="space-y-6">
          <div className="space-y-3">
            <h2 className="text-sm font-medium text-muted-foreground">
              Students ({roster.length})
            </h2>
            {roster.length === 0 ? (
              <Card>
                <CardContent className="p-4 text-sm text-muted-foreground">
                  No students yet. Invite one on the right.
                </CardContent>
              </Card>
            ) : (
              roster.map((s) => (
                <Card key={s.enrollmentId}>
                  <CardContent className="flex items-center justify-between p-4">
                    <div>
                      <p className="text-sm font-medium">{s.fullName ?? s.email}</p>
                      <p className="text-xs text-muted-foreground">{s.email}</p>
                    </div>
                  </CardContent>
                </Card>
              ))
            )}
          </div>

          {pending.length > 0 && (
            <div className="space-y-3">
              <h2 className="text-sm font-medium text-muted-foreground">
                Pending invitations ({pending.length})
              </h2>
              {pending.map((inv) => (
                <Card key={inv.id}>
                  <CardContent className="flex items-center justify-between p-4">
                    <div>
                      <p className="text-sm">{inv.email}</p>
                      <p className="text-xs text-muted-foreground">
                        Invited {inv.createdAt.toLocaleDateString()}
                      </p>
                    </div>
                    <form action={revokeInvitation.bind(null, inv.id)}>
                      <Button variant="ghost" size="sm" type="submit">
                        Revoke
                      </Button>
                    </form>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>

        <Card className="h-fit">
          <CardHeader>
            <CardTitle className="text-base">Invite a student</CardTitle>
            <CardDescription>
              They&apos;ll get an email to set a password and join.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <InviteStudentForm classId={classId} />
          </CardContent>
        </Card>
      </section>
    </main>
  );
}
