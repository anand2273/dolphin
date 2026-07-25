import { z } from "zod";
import {
  ALLOWED_MIME_TYPES,
  MAX_FILE_BYTES,
  formatBytes,
} from "@/lib/storage/config";

/**
 * What the client CLAIMS about a file, checked before we mint an upload URL.
 * These claims are never trusted afterwards: `confirmMaterialUpload` re-reads
 * the object's real size and type from storage before writing any rows.
 */
export const requestUploadSchema = z.object({
  sessionId: z.string().uuid("Invalid session"),
  filename: z
    .string()
    .trim()
    .min(1, "Filename is required")
    .max(255, "Filename is too long"),
  mimeType: z.enum(ALLOWED_MIME_TYPES, {
    errorMap: () => ({ message: "That file type isn't allowed" }),
  }),
  sizeBytes: z
    .number()
    .int()
    .positive("File is empty")
    .max(MAX_FILE_BYTES, `Files must be under ${formatBytes(MAX_FILE_BYTES)}`),
});

export const confirmUploadSchema = z.object({
  sessionId: z.string().uuid("Invalid session"),
  objectKey: z.string().min(1),
  filename: z.string().trim().min(1).max(255),
  title: z
    .string()
    .trim()
    .max(200, "Title is too long")
    .optional()
    .transform((v) => (v === "" ? undefined : v)),
});

export type RequestUploadInput = z.infer<typeof requestUploadSchema>;
export type ConfirmUploadInput = z.infer<typeof confirmUploadSchema>;
