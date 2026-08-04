import { Pill } from "@/components/ui/pill";
import { Spinner } from "@/components/ui/spinner";
import type { Syllabus } from "@/lib/db/queries/syllabuses";

/**
 * Pure/server-safe: no polling here, just today's status rendered as a Pill.
 * Used on both the list row (static) and the detail header (paired with
 * SyllabusExtractionPoller there for live updates).
 */
export function SyllabusStatusPill({
  status,
}: {
  status: Syllabus["extractionStatus"];
}) {
  if (status === "pending" || status === "processing") {
    return (
      <Pill variant="accent">
        <Spinner size="sm" /> Extracting…
      </Pill>
    );
  }
  if (status === "failed") {
    return <Pill variant="danger">Extraction failed</Pill>;
  }
  return null;
}
