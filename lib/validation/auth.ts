import { z } from "zod";

/**
 * One password rule for every place a password is set: signup, invitation
 * acceptance and reset. Note this is stricter than GoTrue's own
 * `minimum_password_length = 6` in `supabase/config.toml` — deliberately, so
 * the floor is ours rather than the vendor's default.
 */
export const passwordSchema = z
  .string()
  .min(8, "Password must be at least 8 characters");

const emailSchema = z.string().trim().toLowerCase().email("Enter a valid email");

export const signUpSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  fullName: z
    .string()
    .trim()
    .max(200)
    .optional()
    .transform((v) => (v === "" ? undefined : v)),
});

export const logInSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "Password is required"),
});

export const requestPasswordResetSchema = z.object({
  email: emailSchema,
});

export const resetPasswordSchema = z.object({
  password: passwordSchema,
});

export type SignUpInput = z.infer<typeof signUpSchema>;
export type LogInInput = z.infer<typeof logInSchema>;
export type RequestPasswordResetInput = z.infer<typeof requestPasswordResetSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
