import { notFound } from "next/navigation";
import { requireAuthUser } from "@/lib/auth/session";
import { getSessionForViewer } from "@/lib/db/queries/sessions";
import { listMaterialsForSession } from "@/lib/db/queries/materials";
import { formatBytes } from "@/lib/storage/config";
import { SessionDateTime } from "@/components/session-datetime";
import { EditSessionPanel } from "@/components/edit-session-panel";
import { AddMaterialRow } from "@/components/add-material-row";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { Page, PageHeader } from "@/components/page";
import { deleteMaterial } from "./actions";
import { buttonVariants } from "@/components/ui/button";
import { ConfirmButton } from "@/components/ui/confirm-button";
import { ExtChip } from "@/components/ui/ext-chip";
import { Section, SectionLabel } from "@/components/ui/section";
import {
  MetaDot,
  Panel,
  PanelRow,
  RowEnd,
  RowMain,
  RowMeta,
  RowTitle,
} from "@/components/ui/panel";

/**
 * The session detail page — the organising screen of the app. One route serves
 * both roles: `getSessionForViewer` resolves the viewer's standing in the owning
 * class exactly once, and the tutor-only controls hang off that result. Keeping
 * it as a single route means the read rule cannot drift between two copies.
 *
 * Materials are live (CP5): the tutor uploads, both roles download through the
 * authorizing route. Homework is CP6 and remains an empty placeholder.
 */
export default async function SessionPage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const { sessionId } = await params;
  const user = await requireAuthUser();

  const found = await getSessionForViewer(user.id, sessionId);
  // Missing, soft-deleted, and not-yours are all 404 — never leak existence.
  if (!found) notFound();

  const { session, klass, relationship } = found;
  const isOwner = relationship === "owner";

  const sessionMaterials = await listMaterialsForSession(user.id, session.id);

  return (
    <Page>
      <div className="flex flex-col gap-4">
        {/* A student has no class page of their own, so their class crumb is
            context rather than a link. */}
        <Breadcrumbs
          items={
            isOwner
              ? [
                  { label: "Classes", href: "/dashboard" },
                  { label: klass.name, href: `/classes/${klass.id}` },
                  { label: session.title ?? "Untitled lesson" },
                ]
              : [
                  { label: "Your classes", href: "/student" },
                  { label: klass.name },
                  { label: session.title ?? "Untitled lesson" },
                ]
          }
        />
        <PageHeader
          title={session.title ?? "Untitled lesson"}
          sub={
            <SessionDateTime
              at={session.scheduledAt}
              tutorTimezone={session.timezone}
            />
          }
        />
      </div>

      {isOwner && (
        <EditSessionPanel
          sessionId={session.id}
          title={session.title}
          scheduledAt={session.scheduledAt.toISOString()}
        />
      )}

      <Section aria-label="Materials">
        <SectionLabel>Materials</SectionLabel>
        <Panel>
          {sessionMaterials.length === 0 && (
            <PanelRow>
              <RowMeta>
                {isOwner
                  ? "No materials yet — add one below."
                  : "Your tutor hasn't added any materials to this lesson."}
              </RowMeta>
            </PanelRow>
          )}
          {sessionMaterials.map((m) => (
            <PanelRow key={m.materialId}>
              <ExtChip filename={m.originalFilename} mimeType={m.mimeType} />
              <RowMain>
                <RowTitle>{m.title ?? m.originalFilename}</RowTitle>
                <RowMeta>
                  {m.originalFilename} <MetaDot /> {formatBytes(m.sizeBytes)}
                </RowMeta>
              </RowMain>
              <RowEnd>
                {/* Plain link: the route authorizes, then redirects to a
                    short-lived signed URL. No signed URL is ever rendered
                    into the page itself. */}
                <a
                  href={`/api/materials/${m.materialId}/download`}
                  className={buttonVariants({ variant: "outline", size: "sm" })}
                >
                  Download
                </a>
                {isOwner && (
                  <ConfirmButton
                    action={deleteMaterial.bind(null, m.materialId)}
                    title="Remove this material?"
                    body="Students in this class will no longer see it."
                    confirmLabel="Remove"
                  >
                    Remove
                  </ConfirmButton>
                )}
              </RowEnd>
            </PanelRow>
          ))}
          {isOwner && <AddMaterialRow sessionId={session.id} />}
        </Panel>
      </Section>

      <Section aria-label="Homework">
        <SectionLabel>Homework</SectionLabel>
        <Panel>
          <PanelRow>
            <RowMeta>No homework issued in this lesson.</RowMeta>
          </PanelRow>
        </Panel>
      </Section>

      {!isOwner && (
        <p className="text-[13px] text-faint">
          Your tutor runs this lesson — materials and homework appear here once
          they add them.
        </p>
      )}
    </Page>
  );
}
