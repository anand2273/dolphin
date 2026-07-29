import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAuthUser } from "@/lib/auth/session";
import { assertClassOwner, AuthzError } from "@/lib/auth/authz";
import {
  listPendingInvitesForClass,
  listRoster,
} from "@/lib/db/queries/invitations";
import { listSessionsForClass } from "@/lib/db/queries/sessions";
import { InviteStudentForm } from "@/components/invite-student-form";
import { CreateSessionForm } from "@/components/create-session-form";
import { SessionDateTime, SessionWhen } from "@/components/session-datetime";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { Notice } from "@/components/notice";
import { Page } from "@/components/page";
import { resolveNotice } from "@/lib/notices";
import { deleteClass, revokeInvitation } from "./actions";
import { ConfirmButton } from "@/components/ui/confirm-button";
import { TypeToConfirmButton } from "@/components/ui/type-to-confirm-button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export default async function ClassPage({
  params,
  searchParams,
}: {
  params: Promise<{ classId: string }>;
  searchParams: Promise<{ notice?: string | string[] }>;
}) {
  const { classId } = await params;
  // Never rendered raw — resolveNotice maps a known key to our own copy.
  const notice = resolveNotice((await searchParams).notice);
  const user = await requireAuthUser();

  let klass;
  try {
    klass = await assertClassOwner(user.id, classId);
  } catch (e) {
    if (e instanceof AuthzError) notFound();
    throw e;
  }

  const [roster, pending, classSessions] = await Promise.all([
    listRoster(classId),
    listPendingInvitesForClass(classId),
    listSessionsForClass(user.id, classId),
  ]);

  return (
    <Page>
      {notice && <Notice message={notice} />}

      <div>
        <Breadcrumbs
          items={[
            { label: "Dashboard", href: "/dashboard" },
            { label: klass.name },
          ]}
        />
        <h1 className="mt-2 text-2xl font-semibold">{klass.name}</h1>
        {klass.subject && (
          <p className="text-sm text-muted-foreground">{klass.subject}</p>
        )}
      </div>

      <section className="grid gap-6 md:grid-cols-[1fr_320px]">
        <div className="space-y-6">
          <div className="space-y-3">
            <h2 className="text-sm font-medium text-muted-foreground">
              Lessons ({classSessions.length})
            </h2>
            {classSessions.length === 0 ? (
              <Card>
                <CardContent className="p-4 text-sm text-muted-foreground">
                  No lessons yet. Add the first one on the right.
                </CardContent>
              </Card>
            ) : (
              classSessions.map((s) => (
                <Card key={s.id}>
                  <Link href={`/sessions/${s.id}`} className="block">
                    <CardContent className="flex items-center justify-between gap-4 p-4">
                      <div>
                        <p className="text-sm font-medium">
                          {s.title ?? "Untitled lesson"}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          <SessionDateTime at={s.scheduledAt} />
                        </p>
                      </div>
                      <SessionWhen at={s.scheduledAt} />
                    </CardContent>
                  </Link>
                </Card>
              ))
            )}
          </div>

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
                    <ConfirmButton
                      action={revokeInvitation.bind(null, inv.id)}
                      title="Revoke this invitation?"
                      body="The emailed link stops working. You can invite them again afterwards."
                      confirmLabel="Revoke"
                    >
                      Revoke
                    </ConfirmButton>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>

        <div className="space-y-6">
          <Card className="h-fit">
            <CardHeader>
              <CardTitle className="text-base">Add a lesson</CardTitle>
              <CardDescription>
                A dated lesson. Materials and homework attach to it.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <CreateSessionForm classId={classId} />
            </CardContent>
          </Card>

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

          <Card className="h-fit border-destructive/50">
            <CardHeader>
              <CardTitle className="text-base">Danger zone</CardTitle>
              <CardDescription>
                Deleting this class removes it for you and your students.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <TypeToConfirmButton
                action={deleteClass.bind(null, classId)}
                confirmPhrase={`delete ${klass.name}`}
                title="Delete this class?"
                body={`Lessons, materials and student work in "${klass.name}" will no longer be accessible, and pending invite links stop working.`}
                confirmLabel="Delete class"
              >
                Delete class
              </TypeToConfirmButton>
            </CardContent>
          </Card>
        </div>
      </section>
    </Page>
  );
}
