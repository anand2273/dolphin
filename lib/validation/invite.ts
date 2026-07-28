import { z } from "zod";
import { passwordSchema } from "./auth";

export const inviteStudentSchema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email"),
});

export const acceptInviteSchema = z.object({
  token: z.string().min(10, "Missing invitation token"),
  // Present only on the set-password path (new accounts).
  password: passwordSchema.optional(),
  fullName: z
    .string()
    .trim()
    .max(200)
    .optional()
    .transform((v) => (v === "" ? undefined : v)),
});

export type InviteStudentInput = z.infer<typeof inviteStudentSchema>;
export type AcceptInviteInput = z.infer<typeof acceptInviteSchema>;
