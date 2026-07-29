import { z } from "zod";

export const createClassSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Class name is required")
    .max(200, "Class name is too long"),
  subject: z
    .string()
    .trim()
    .max(200, "Subject is too long")
    .optional()
    .transform((v) => (v === "" ? undefined : v)),
});

export type CreateClassInput = z.infer<typeof createClassSchema>;

// The phrase itself is checked in the action — it needs the class row's name.
export const deleteClassSchema = z.object({
  confirm: z.string().trim().min(1, "Type the confirmation phrase"),
});
