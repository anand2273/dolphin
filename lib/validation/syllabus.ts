import { z } from "zod";
import {
  MAX_FILE_BYTES,
  SYLLABUS_DOCUMENT_MIME_TYPES,
  formatBytes,
} from "@/lib/storage/config";

const title = z.string().trim().min(1, "Title is required").max(200, "Title is too long");
const optionalMeta = z
  .string()
  .trim()
  .max(200)
  .optional()
  .transform((v) => (v === "" ? undefined : v));
const optionalDescription = z
  .string()
  .trim()
  .max(4000, "Description is too long")
  .optional()
  .transform((v) => (v === "" ? undefined : v));

/** Manual syllabus creation — no document, tutor types everything in by hand. */
export const createSyllabusSchema = z.object({
  title,
  subject: optionalMeta,
  level: optionalMeta,
  description: optionalDescription,
});

export const updateSyllabusSchema = z.object({
  syllabusId: z.string().uuid("Invalid syllabus"),
  title,
  subject: optionalMeta,
  level: optionalMeta,
  description: optionalDescription,
});

export const createSyllabusFromPresetSchema = z.object({
  presetKey: z.string().trim().min(1, "Invalid preset"),
});

/**
 * What the client CLAIMS about the syllabus document, checked before minting an
 * upload URL. Never trusted afterwards — confirmSyllabusDocumentUpload re-reads
 * the object's real size and type from storage before writing any rows, same
 * pattern as material uploads.
 */
export const requestSyllabusDocumentUploadSchema = z.object({
  filename: z.string().trim().min(1, "Filename is required").max(255, "Filename is too long"),
  mimeType: z.enum(SYLLABUS_DOCUMENT_MIME_TYPES, {
    errorMap: () => ({ message: "That file type isn't allowed" }),
  }),
  sizeBytes: z
    .number()
    .int()
    .positive("File is empty")
    .max(MAX_FILE_BYTES, `Files must be under ${formatBytes(MAX_FILE_BYTES)}`),
});

export const confirmSyllabusDocumentUploadSchema = z.object({
  objectKey: z.string().min(1),
  filename: z.string().trim().min(1).max(255),
  title,
  subject: optionalMeta,
  level: optionalMeta,
});

export const createTopicSchema = z.object({
  syllabusId: z.string().uuid("Invalid syllabus"),
  name: z.string().trim().min(1, "Name is required").max(200, "Name is too long"),
  description: optionalDescription,
});

export const updateTopicSchema = z.object({
  topicId: z.string().uuid("Invalid topic"),
  name: z.string().trim().min(1, "Name is required").max(200, "Name is too long"),
  description: optionalDescription,
  orderIndex: z.number().int().optional(),
});

export const createConceptSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(200, "Name is too long"),
  description: optionalDescription,
});

export const linkTopicConceptSchema = z.object({
  topicId: z.string().uuid("Invalid topic"),
  conceptId: z.string().uuid("Invalid concept"),
});

export type CreateSyllabusInput = z.infer<typeof createSyllabusSchema>;
export type UpdateSyllabusInput = z.infer<typeof updateSyllabusSchema>;
export type CreateSyllabusFromPresetInput = z.infer<
  typeof createSyllabusFromPresetSchema
>;
export type RequestSyllabusDocumentUploadInput = z.infer<
  typeof requestSyllabusDocumentUploadSchema
>;
export type ConfirmSyllabusDocumentUploadInput = z.infer<
  typeof confirmSyllabusDocumentUploadSchema
>;
export type CreateTopicInput = z.infer<typeof createTopicSchema>;
export type UpdateTopicInput = z.infer<typeof updateTopicSchema>;
export type CreateConceptInput = z.infer<typeof createConceptSchema>;
export type LinkTopicConceptInput = z.infer<typeof linkTopicConceptSchema>;
