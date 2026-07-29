import { requireStudent } from "@/lib/auth/guards";
import { listSessionsForClass } from "@/lib/db/queries/sessions";
import { DateChip, SessionDateTime } from "@/components/session-datetime";
import {
  listEnrolledClasses,
  listPendingInvitesForEmail,
} from "@/lib/db/queries/invitations";
import { acceptPendingInvite } from "@/app/invite/accept/actions";
import { Greeting, TodayLine } from "@/components/greeting";
import { Page, PageHeader } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Section, SectionLabel } from "@/components/ui/section";
import {
  Chevron,
  Panel,
  PanelRow,
  RowEnd,
  RowMain,
  RowMeta,
  RowTitle,
} from "@/components/ui/panel";

export default async function StudentHome() {
  const { user, profile } = await requireStudent();

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
      <PageHeader
        meta={<TodayLine />}
        title={<Greeting name={profile?.fullName ?? user.email} />}
      />

      {pendingInvites.length > 0 && (
        <Section aria-label="Invitations">
          <SectionLabel>Invitations</SectionLabel>
          <Panel>
            {pendingInvites.map(({ invitation, className, tutorName }) => (
              <PanelRow key={invitation.id}>
                <RowMain>
                  <RowTitle>{className}</RowTitle>
                  <RowMeta>from {tutorName ?? "a tutor"}</RowMeta>
                </RowMain>
                <RowEnd>
                  <form action={acceptPendingInvite.bind(null, invitation.id)}>
                    <Button size="sm" type="submit">
                      Accept
                    </Button>
                  </form>
                </RowEnd>
              </PanelRow>
            ))}
          </Panel>
        </Section>
      )}

      {classes.length === 0 ? (
        <Panel>
          <PanelRow>
            <RowMain>
              <RowTitle>No classes yet</RowTitle>
              <RowMeta>
                When your tutor invites you, your class will appear here.
              </RowMeta>
            </RowMain>
          </PanelRow>
        </Panel>
      ) : (
        classes.map((c) => (
          <Section key={c.classId} aria-label={c.name}>
            <div>
              <h2 className="font-display text-base font-semibold tracking-tight">
                {c.name}
              </h2>
              <p className="text-[12.5px] text-muted-foreground">
                {c.subject ? `${c.subject} · ` : ""}
                {c.tutorName ?? "Your tutor"}
              </p>
            </div>
            <Panel>
              {(sessionsByClass.get(c.classId) ?? []).length === 0 ? (
                <PanelRow>
                  <RowMeta>No lessons scheduled yet.</RowMeta>
                </PanelRow>
              ) : (
                sessionsByClass.get(c.classId)!.map((s) => (
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
                ))
              )}
            </Panel>
          </Section>
        ))
      )}
    </Page>
  );
}
