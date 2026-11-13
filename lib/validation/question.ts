import { z } from "zod";
import {
  MAX_FILE_BYTES,
  QUESTION_IMPORT_MIME_TYPES,
  formatBytes,
} from "@/lib/storage/config";

/**
 * Shown both by the upload action (refused up front) and by extraction (a job
 * whose syllabus lost its topics before it ran). One string, so the tutor sees
 * the same words either way. Lives in lib/ so both app/ and lib/extraction can import it.
 */
export const NO_TOPICS_MESSAGE =
  "This syllabus has no topics yet. Add topics before importing questions.";

// Lowercased for the same reason as lib/validation/concept.ts: downstream
// equality checks are exact-value.
const uuidField = (message: string) => z.string().uuid(message).toLowerCase();

/** generateObjectKey() is `<uuid>/<uuid>`; anything else was not minted by us. */
const objectKey = z
  .string()
  .regex(/^[0-9a-f-]{36}\/[0-9a-f-]{36}$/i, "Invalid upload");

export const requestQuestionImportUploadSchema = z.object({
  syllabusId: uuidField("Invalid syllabus"),
  filename: z.string().trim().min(1, "Filename is required").max(255, "Filename is too long"),
  mimeType: z.enum(QUESTION_IMPORT_MIME_TYPES, {
    errorMap: () => ({ message: "Only PDF files can be imported" }),
  }),
  sizeBytes: z
    .number()
    .int()
    .positive("File is empty")
    .max(MAX_FILE_BYTES, `Files must be under ${formatBytes(MAX_FILE_BYTES)}`),
});

export const confirmQuestionImportUploadSchema = z.object({
  syllabusId: uuidField("Invalid syllabus"),
  objectKey,
  filename: z.string().trim().min(1).max(255),
});

export const retryQuestionImportSchema = uuidField("Invalid import");
