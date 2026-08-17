import { requireAuthUser } from "@/lib/auth/session";
import {
  countTopicsForConcepts,
  listConceptClustersForTutor,
} from "@/lib/db/queries/concepts";
import { listConceptsForTutor } from "@/lib/db/queries/syllabuses";
import { Page, PageHeader } from "@/components/page";
import { Panel, PanelRow, RowMeta } from "@/components/ui/panel";
import { Section, SectionLabel } from "@/components/ui/section";
import { ConceptClusterReview } from "@/components/concept-cluster-review";

export default async function ConceptsPage() {
  const user = await requireAuthUser();

  const [all, clusters] = await Promise.all([
    listConceptsForTutor(user.id),
    listConceptClustersForTutor(user.id),
  ]);

  const topicCounts = await countTopicsForConcepts(
    user.id,
    clusters.flatMap((c) => c.concepts.map((x) => x.id)),
  );

  return (
    <Page>
      <PageHeader
        title="Concepts"
        sub={
          <span className="text-sm text-muted-foreground">
            {all.length} concepts
            {clusters.length > 0 && ` · ${clusters.length} to review`}
          </span>
        }
      />

      {clusters.length > 0 && (
        <Section aria-label="Possible duplicates">
          <SectionLabel>Possible duplicates</SectionLabel>
          <Panel>
            {clusters.map((cluster) => (
              <ConceptClusterReview
                key={cluster.key}
                concepts={cluster.concepts.map((c) => ({
                  ...c,
                  topicCount: topicCounts.get(c.id) ?? 0,
                }))}
              />
            ))}
          </Panel>
        </Section>
      )}

      <Section aria-label="All concepts">
        <SectionLabel>All concepts</SectionLabel>
        <Panel>
          {all.length === 0 ? (
            <PanelRow>
              <RowMeta>
                No concepts yet — they appear as you build syllabuses.
              </RowMeta>
            </PanelRow>
          ) : (
            all.map((concept) => (
              <PanelRow key={concept.id}>
                <span className="text-sm">{concept.name}</span>
              </PanelRow>
            ))
          )}
        </Panel>
      </Section>
    </Page>
  );
}
