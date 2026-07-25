import { z } from "zod";

/**
 * A session's instant is submitted as an ISO-8601 UTC string, not as a wall
 * clock reading. The browser converts its `datetime-local` value with
 * `toISOString()`, so the tutor's offset is resolved on the machine that
 * actually knows it and the server never has to do timezone arithmetic.
 * `timezone` is stored alongside it as context (which zone the tutor meant),
 * never as the source of truth for when the lesson is.
 */
const isoInstant = z
  .string()
  .datetime({ message: "Pick a date and time" })
  .transform((v) => new Date(v));

/** Rejects anything Intl doesn't recognise as an IANA zone. */
const ianaTimezone = z
  .string()
  .trim()
  .min(1, "Timezone is required")
  .max(64)
  .refine((tz) => {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: tz });
      return true;
    } catch {
      return false;
    }
  }, "Unrecognised timezone");

const title = z
  .string()
  .trim()
  .max(200, "Title is too long")
  .optional()
  .transform((v) => (v === "" ? undefined : v));

export const createSessionSchema = z.object({
  title,
  scheduledAt: isoInstant,
  timezone: ianaTimezone,
});

export const updateSessionSchema = z.object({
  sessionId: z.string().uuid("Invalid session"),
  title,
  scheduledAt: isoInstant,
  timezone: ianaTimezone,
});

export type CreateSessionInput = z.infer<typeof createSessionSchema>;
export type UpdateSessionInput = z.infer<typeof updateSessionSchema>;
