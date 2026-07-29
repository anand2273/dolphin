import Link from "next/link";
import { requireTutor } from "@/lib/auth/guards";
import { listClassOverviewsForTutor } from "@/lib/db/queries/classes";
import { listUpcomingSessionsForTutor } from "@/lib/db/queries/sessions";
import { CreateClassForm } from "@/components/create-class-form";
import { FirstRun } from "@/components/first-run";
import { Facepile } from "@/components/facepile";
import { Greeting, TodayLine } from "@/components/greeting";
import { DateChip, SessionDateTime } from "@/components/session-datetime";
import { Notice } from "@/components/notice";
import { resolveNotice } from "@/lib/notices";
import { Page, PageHeader } from "@/components/page";
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

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string | string[] }>;
}) {
  // Never rendered raw — resolveNotice maps a known key to our own copy.
  const notice = resolveNotice((await searchParams).notice);
  const { user, profile } = await requireTutor();
  const [overviews, upNext] = await Promise.all([
    listClassOverviewsForTutor(user.id),
    listUpcomingSessionsForTutor(user.id),
  ]);

  const displayName = profile.fullName ?? user.email;

  if (overviews.length === 0) {
    return (
      <Page>
        {notice && <Notice message={notice} />}
        <PageHeader
          meta={<TodayLine />}
          title={<Greeting name={displayName} />}
        />
        <FirstRun />
      </Page>
    );
  }

  return (
    <Page>
      {notice && <Notice message={notice} />}

      <PageHeader
        meta={<TodayLine />}
        title={<Greeting name={displayName} />}
        actions={
          <FormDialog
            trigger="+ New class"
            title="New class"
            description="One class = one ongoing engagement for one subject."
          >
            <CreateClassForm />
          </FormDialog>
        }
      />

      {upNext.length > 0 && (
        <Section aria-label="Up next">
          <SectionLabel>Up next</SectionLabel>
          <Panel>
            {upNext.map(({ session, className }) => (
              <PanelRow key={session.id} href={`/sessions/${session.id}`}>
                <DateChip at={session.scheduledAt} />
                <RowMain>
                  <RowTitle>{session.title ?? "Untitled lesson"}</RowTitle>
                  <RowMeta>
                    {className} <MetaDot />{" "}
                    <SessionDateTime at={session.scheduledAt} />
                  </RowMeta>
                </RowMain>
                <RowEnd>
                  <Chevron />
                </RowEnd>
              </PanelRow>
            ))}
          </Panel>
        </Section>
      )}

      <Section aria-label="Your classes">
        <SectionLabel>Your classes</SectionLabel>
        <div className="grid gap-3.5 [grid-template-columns:repeat(auto-fill,minmax(270px,1fr))]">
          {overviews.map((klass) => (
            <Link
              key={klass.id}
              href={`/classes/${klass.id}`}
              className="flex flex-col gap-2.5 rounded-lg border bg-card p-4 text-card-foreground shadow-card transition-colors hover:border-primary"
            >
              <div>
                <div className="font-display text-base font-semibold tracking-tight">
                  {klass.name}
                </div>
                {klass.subject && (
                  <div className="mt-px text-[12.5px] text-muted-foreground">
                    {klass.subject}
                  </div>
                )}
              </div>

              {klass.nextSession && (
                <div className="flex items-center gap-1.5 text-[12.5px] tabular-nums text-muted-foreground">
                  <span aria-hidden className="text-[8px] text-primary">
                    ●
                  </span>
                  Next lesson{" "}
                  <SessionDateTime at={klass.nextSession.scheduledAt} />
                </div>
              )}

              <div className="mt-auto flex items-center justify-between gap-2 border-t pt-2.5">
                {klass.studentNames.length > 0 ? (
                  <Facepile names={klass.studentNames} />
                ) : (
                  <span className="text-[12.5px] text-faint">
                    No students yet
                  </span>
                )}
                {klass.pendingInviteCount > 0 ? (
                  <Pill variant="accent">
                    {klass.pendingInviteCount}{" "}
                    {klass.pendingInviteCount === 1 ? "invite" : "invites"}{" "}
                    pending
                  </Pill>
                ) : (
                  <Pill>Up to date</Pill>
                )}
              </div>
            </Link>
          ))}
        </div>
      </Section>
    </Page>
  );
}
