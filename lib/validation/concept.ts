import { z } from "zod";

export const mergeConceptsSchema = z
  .object({
    survivorId: z.string().uuid("Invalid concept"),
    loserIds: z.array(z.string().uuid("Invalid concept")).min(1, "Nothing to merge"),
  })
  .refine((v) => !v.loserIds.includes(v.survivorId), {
    message: "A concept cannot be merged into itself",
  });

export const rejectClusterSchema = z.object({
  conceptIds: z
    .array(z.string().uuid("Invalid concept"))
    .min(2, "A cluster needs at least two concepts"),
});

export type MergeConceptsInput = z.infer<typeof mergeConceptsSchema>;
export type RejectClusterInput = z.infer<typeof rejectClusterSchema>;
