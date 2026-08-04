import { requireTutor } from "@/lib/auth/guards";
import { listSyllabiForTutor } from "@/lib/db/queries/syllabuses";
import { Notice } from "@/components/notice";
import { resolveNotice } from "@/lib/notices";
import { Page, PageHeader } from "@/components/page";
import { FormDialog } from "@/components/ui/form-dialog";
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
import { CreateSyllabusForm } from "@/components/create-syllabus-form";
import { CreateSyllabusFromPresetForm } from "@/components/create-syllabus-from-preset-form";
import { UploadSyllabusDocumentForm } from "@/components/upload-syllabus-document-form";
import { SyllabusStatusPill } from "@/components/syllabus-status-pill";

export default async function SyllabiPage({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string | string[] }>;
}) {
  // Never rendered raw — resolveNotice maps a known key to our own copy.
  const notice = resolveNotice((await searchParams).notice);
  const { user } = await requireTutor();
  const syllabuses = await listSyllabiForTutor(user.id);

  return (
    <Page>
      {notice && <Notice message={notice} />}

      <PageHeader
        title="Syllabi"
        sub="Optional curricula you own — independent of any class, reusable across all of them."
        actions={
          <>
            <FormDialog
              trigger="Upload document"
              triggerVariant="outline"
              title="Upload a syllabus document"
              description="PDF, Word, or plain text. We'll extract topics and concepts automatically."
            >
              <UploadSyllabusDocumentForm />
            </FormDialog>
            <FormDialog
              trigger="From preset"
              triggerVariant="outline"
              title="Start from a preset"
              description="Copies a ready-made syllabus into your own account — fully editable afterwards."
            >
              <CreateSyllabusFromPresetForm />
            </FormDialog>
            <FormDialog
              trigger="+ New syllabus"
              title="New syllabus"
              description="Add topics by hand, or from a document/preset instead."
            >
              <CreateSyllabusForm />
            </FormDialog>
          </>
        }
      />

      <Section aria-label="Syllabi">
        <SectionLabel>Your syllabi</SectionLabel>
        <Panel>
          {syllabuses.length === 0 ? (
            <PanelRow>
              <RowMeta>
                No syllabuses yet — create one above, or start from a preset.
              </RowMeta>
            </PanelRow>
          ) : (
            syllabuses.map((s) => (
              <PanelRow key={s.id} href={`/syllabi/${s.id}`}>
                <RowMain>
                  <RowTitle>{s.title}</RowTitle>
                  <RowMeta>
                    {s.subject && <span>{s.subject}</span>}
                    {s.subject && s.level && <MetaDot />}
                    {s.level && <span>{s.level}</span>}
                    {!s.subject && !s.level && <span>No subject set</span>}
                  </RowMeta>
                </RowMain>
                <RowEnd>
                  <SyllabusStatusPill status={s.extractionStatus} />
                  <Chevron />
                </RowEnd>
              </PanelRow>
            ))
          )}
        </Panel>
      </Section>
    </Page>
  );
}
