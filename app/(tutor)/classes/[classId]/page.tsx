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
import { DateChip, SessionDateTime } from "@/components/session-datetime";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { Notice } from "@/components/notice";
import { resolveNotice } from "@/lib/notices";
import { Page, PageHeader } from "@/components/page";
import { deleteClass, revokeInvitation } from "./actions";
import { ConfirmButton } from "@/components/ui/confirm-button";
import { TypeToConfirmButton } from "@/components/ui/type-to-confirm-button";
import { FormDialog } from "@/components/ui/form-dialog";
import { Pill } from "@/components/ui/pill";
import { Section, SectionLabel } from "@/components/ui/section";
import {
  Chevron,
  MetaDot,
  Panel,
  PanelRow,
  RowEnd,
  RowMain,
  RowMeta,
  RowTitle,
} from "@/components/ui/panel";

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

  // Grouped at render time; a lesson crossing the boundary moves on next load.
  const now = Date.now();
  const upcoming = classSessions.filter(
    (s) => s.scheduledAt.getTime() >= now,
  );
  const past = classSessions
    .filter((s) => s.scheduledAt.getTime() < now)
    .reverse(); // query is ascending; past reads most-recent-first

  const lessonRow = (s: (typeof classSessions)[number]) => (
    <PanelRow key={s.id} href={`/sessions/${s.id}`}>
      <DateChip at={s.scheduledAt} />
      <RowMain>
        <RowTitle>{s.title ?? "Untitled lesson"}</RowTitle>
        <RowMeta>
          <SessionDateTime at={s.scheduledAt} />
        </RowMeta>
      </RowMain>
      <RowEnd>
        <Chevron />
      </RowEnd>
    </PanelRow>
  );

  return (
    <Page>
      {notice && <Notice message={notice} />}

      <div className="flex flex-col gap-4">
        <Breadcrumbs
          items={[
            { label: "Classes", href: "/dashboard" },
            { label: klass.name },
          ]}
        />
        <PageHeader
          title={klass.name}
          sub={
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {klass.subject && <Pill>{klass.subject}</Pill>}
              {roster.map((s) => (
                <Pill key={s.enrollmentId}>{s.fullName ?? s.email}</Pill>
              ))}
            </div>
          }
          actions={
            <>
              <FormDialog
                trigger="Invite student"
                triggerVariant="outline"
                title="Invite a student"
                description="They'll get an email to set a password and join."
              >
                <InviteStudentForm classId={classId} />
              </FormDialog>
              <FormDialog
                trigger="+ Add lesson"
                title="Add a lesson"
                description="A dated lesson. Materials and homework attach to it."
              >
                <CreateSessionForm classId={classId} />
              </FormDialog>
            </>
          }
        />
      </div>

      <Section aria-label="Lessons">
        <SectionLabel>Upcoming</SectionLabel>
        <Panel>
          {upcoming.length === 0 ? (
            <PanelRow>
              <RowMeta>
                No upcoming lessons — add one with “+ Add lesson” above.
              </RowMeta>
            </PanelRow>
          ) : (
            upcoming.map(lessonRow)
          )}
          {past.length > 0 && (
            <details className="group divide-y divide-border">
              <summary className="flex cursor-pointer select-none list-none items-center gap-2 px-4 py-3 text-[12.5px] font-medium text-muted-foreground hover:bg-muted [&::-webkit-details-marker]:hidden">
                <span
                  aria-hidden
                  className="text-faint transition-transform group-open:rotate-90"
                >
                  ›
                </span>
                {past.length} past {past.length === 1 ? "lesson" : "lessons"}
              </summary>
              {past.map(lessonRow)}
            </details>
          )}
        </Panel>
      </Section>

      <Section aria-label="Students">
        <SectionLabel>Students</SectionLabel>
        <Panel>
          {roster.length === 0 ? (
            <PanelRow>
              <RowMeta>
                No students yet — invite one with “Invite student” above.
              </RowMeta>
            </PanelRow>
          ) : (
            roster.map((s) => (
              <PanelRow key={s.enrollmentId}>
                <RowMain>
                  <RowTitle>{s.fullName ?? s.email}</RowTitle>
                  <RowMeta>{s.email}</RowMeta>
                </RowMain>
              </PanelRow>
            ))
          )}
        </Panel>
      </Section>

      {pending.length > 0 && (
        <Section aria-label="Pending invitations">
          <SectionLabel>Pending invitations</SectionLabel>
          <Panel>
            {pending.map((inv) => (
              <PanelRow key={inv.id}>
                <RowMain>
                  <RowTitle>{inv.email}</RowTitle>
                  <RowMeta>
                    Invited {inv.createdAt.toLocaleDateString()}
                  </RowMeta>
                </RowMain>
                <RowEnd>
                  <ConfirmButton
                    action={revokeInvitation.bind(null, inv.id)}
                    title="Revoke this invitation?"
                    body="The emailed link stops working. You can invite them again afterwards."
                    confirmLabel="Revoke"
                  >
                    Revoke
                  </ConfirmButton>
                </RowEnd>
              </PanelRow>
            ))}
          </Panel>
        </Section>
      )}

      <div className="flex items-center justify-between gap-4 text-[13px] text-faint">
        <span>
          Created{" "}
          {klass.createdAt.toLocaleDateString(undefined, {
            day: "numeric",
            month: "short",
            year: "numeric",
          })}
        </span>
        <TypeToConfirmButton
          action={deleteClass.bind(null, classId)}
          confirmPhrase={`delete ${klass.name}`}
          title="Delete this class?"
          body={`Lessons, materials and student work in "${klass.name}" will no longer be accessible, and pending invite links stop working.`}
          confirmLabel="Delete class"
          variant="ghost"
          size="sm"
          triggerClassName="h-auto px-1 py-0.5 text-[13px] font-normal text-faint underline underline-offset-2 hover:bg-transparent hover:text-destructive"
        >
          Delete this class…
        </TypeToConfirmButton>
      </div>
    </Page>
  );
}
