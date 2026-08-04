import { notFound } from "next/navigation";
import { requireAuthUser } from "@/lib/auth/session";
import { assertSyllabusOwner, AuthzError } from "@/lib/auth/authz";
import {
  listConceptsForTutor,
  listTopicsForSyllabus,
} from "@/lib/db/queries/syllabuses";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { Notice } from "@/components/notice";
import { resolveNotice } from "@/lib/notices";
import { Page, PageHeader } from "@/components/page";
import { ConfirmButton } from "@/components/ui/confirm-button";
import { FormDialog } from "@/components/ui/form-dialog";
import { Pill } from "@/components/ui/pill";
import { Button } from "@/components/ui/button";
import { Section, SectionLabel } from "@/components/ui/section";
import { Panel, PanelRow, RowMeta } from "@/components/ui/panel";
import { EditSyllabusForm } from "@/components/edit-syllabus-form";
import { CreateTopicForm } from "@/components/create-topic-form";
import { TopicEditor } from "@/components/topic-editor";
import { SyllabusStatusPill } from "@/components/syllabus-status-pill";
import { SyllabusExtractionPoller } from "@/components/syllabus-extraction-poller";
import {
  deleteSyllabusAndRedirect,
  retrySyllabusExtraction,
} from "./actions";

export default async function SyllabusPage({
  params,
  searchParams,
}: {
  params: Promise<{ syllabusId: string }>;
  searchParams: Promise<{ notice?: string | string[] }>;
}) {
  const { syllabusId } = await params;
  // Never rendered raw — resolveNotice maps a known key to our own copy.
  const notice = resolveNotice((await searchParams).notice);
  const user = await requireAuthUser();

  let syllabus;
  try {
    syllabus = await assertSyllabusOwner(user.id, syllabusId);
  } catch (e) {
    if (e instanceof AuthzError) notFound();
    throw e;
  }

  const [topics, allConcepts] = await Promise.all([
    listTopicsForSyllabus(user.id, syllabusId),
    listConceptsForTutor(user.id),
  ]);

  return (
    <Page>
      {notice && <Notice message={notice} />}

      <div className="flex flex-col gap-4">
        <Breadcrumbs
          items={[{ label: "Syllabi", href: "/syllabi" }, { label: syllabus.title }]}
        />
        <PageHeader
          title={syllabus.title}
          sub={
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {syllabus.subject && <Pill>{syllabus.subject}</Pill>}
              {syllabus.level && <Pill>{syllabus.level}</Pill>}
              {syllabus.description && (
                <span className="text-sm text-muted-foreground">
                  {syllabus.description}
                </span>
              )}
            </div>
          }
          actions={
            <FormDialog
              trigger="Edit"
              triggerVariant="outline"
              title="Edit syllabus"
            >
              <EditSyllabusForm syllabus={syllabus} />
            </FormDialog>
          }
        />
      </div>

      {syllabus.sourceAttachmentId && (
        <div className="flex items-center gap-3 rounded-lg border bg-card px-4 py-3">
          <SyllabusExtractionPoller status={syllabus.extractionStatus} />
          <SyllabusStatusPill status={syllabus.extractionStatus} />
          {syllabus.extractionStatus === "failed" && (
            <>
              <span className="text-sm text-muted-foreground">
                We couldn&apos;t extract topics from this document. Try
                again, or upload a different file.
              </span>
              <form
                action={retrySyllabusExtraction.bind(null, syllabus.id)}
                className="ml-auto"
              >
                <Button type="submit" variant="outline" size="sm">
                  Retry extraction
                </Button>
              </form>
            </>
          )}
          {(syllabus.extractionStatus === "pending" ||
            syllabus.extractionStatus === "processing") && (
            <span className="text-sm text-muted-foreground">
              Reading the uploaded document and drafting topics — this can
              take a minute.
            </span>
          )}
        </div>
      )}

      <Section aria-label="Topics">
        <SectionLabel>Topics</SectionLabel>
        <Panel>
          {topics.length === 0 ? (
            <PanelRow>
              <RowMeta>
                No topics yet — add one below, or upload a document to
                extract them.
              </RowMeta>
            </PanelRow>
          ) : (
            topics.map((topic) => (
              <TopicEditor key={topic.id} topic={topic} allConcepts={allConcepts} />
            ))
          )}
          <FormDialog
            trigger="+ Add topic"
            triggerVariant="ghost"
            triggerClassName="h-auto w-full justify-center gap-2 rounded-none px-4 py-3 text-[13px] font-medium text-primary hover:bg-primary-tint"
            title="Add a topic"
            description="A unit of this syllabus, e.g. “Algebra”."
          >
            <CreateTopicForm syllabusId={syllabus.id} />
          </FormDialog>
        </Panel>
      </Section>

      <div className="flex items-center justify-between gap-4 text-[13px] text-faint">
        <span>
          Created{" "}
          {syllabus.createdAt.toLocaleDateString(undefined, {
            day: "numeric",
            month: "short",
            year: "numeric",
          })}
        </span>
        <ConfirmButton
          action={deleteSyllabusAndRedirect.bind(null, syllabus.id)}
          title="Delete this syllabus?"
          body={`"${syllabus.title}" and its topics will no longer be reachable. Classes are never attached to a syllabus in v1, so nothing else is affected.`}
          confirmLabel="Delete syllabus"
          triggerClassName="h-auto px-1 py-0.5 text-[13px] font-normal text-faint underline underline-offset-2 hover:bg-transparent hover:text-destructive"
        >
          Delete this syllabus…
        </ConfirmButton>
      </div>
    </Page>
  );
}
