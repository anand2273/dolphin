import { z } from "zod";

// Zod's .uuid() regex accepts mixed case, but every equality check downstream
// of this schema — the self-merge .refine() below, the Set-based dedupe in
// the actions, and Postgres's own uuid canonicalisation — is exact-value
// comparison. Without normalising here, the SAME concept id in two different
// letter cases looks like two different ids to .includes()/Set even though
// the database and assertConceptsOwned treat them as one row, which is
// exactly the gap that let a self-merge slip past the refinement below.
const uuidField = () => z.string().uuid("Invalid concept").toLowerCase();

export const mergeConceptsSchema = z
  .object({
    survivorId: uuidField(),
    loserIds: z.array(uuidField()).min(1, "Nothing to merge"),
  })
  .refine((v) => !v.loserIds.includes(v.survivorId), {
    message: "A concept cannot be merged into itself",
  });

export const rejectClusterSchema = z.object({
  conceptIds: z.array(uuidField()).min(2, "A cluster needs at least two concepts"),
});

export type MergeConceptsInput = z.infer<typeof mergeConceptsSchema>;
export type RejectClusterInput = z.infer<typeof rejectClusterSchema>;
