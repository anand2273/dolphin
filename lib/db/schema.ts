/**
 * TutorOS — v1 Drizzle schema (design artifact for Checkpoint 1).
 *
 * Conventions (per CLAUDE.md):
 *  - Session is the organising unit. Every material/assignment/submission is
 *    reachable from exactly one session.
 *  - Soft-delete (`deleted_at`) on everything user-visible. The append-only
 *    `events` log is the deliberate exception.
 *  - Timestamps are UTC `timestamptz`. Sessions additionally carry the tutor's
 *    IANA timezone.
 *  - Authorization is NOT enforced here. It lives in the server-side authz
 *    helper (lib/auth). RLS, if enabled later, is defense-in-depth only.
 *  - Forward-compat AI hooks are present as columns/tables; no behaviour.
 */

import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgSchema,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/* -------------------------------------------------------------------------- */
/* Supabase-managed auth schema (we do NOT migrate this; we only reference it) */
/* -------------------------------------------------------------------------- */

const authSchema = pgSchema("auth");

/** Minimal handle on Supabase's auth.users so we can FK to it. */
export const authUsers = authSchema.table("users", {
  id: uuid("id").primaryKey(),
});

/* -------------------------------------------------------------------------- */
/* Reusable column sets                                                        */
/* -------------------------------------------------------------------------- */

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
};

/** deleted_at: NULL = live. Reads filter this out centrally. */
const softDelete = {
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
};

/* -------------------------------------------------------------------------- */
/* Enums                                                                       */
/* -------------------------------------------------------------------------- */

// Global account role. `tutor` = the paying user, created by self-signup;
// `student` = invited, very low-privilege, created only by accepting an invite.
// Fixed for the account's lifetime — this boundary is the monetization boundary
// and the coarse authorization gate (which half of the app you can reach).
export const userRole = pgEnum("user_role", ["tutor", "student"]);

// NOTE: no `session_status` enum. planned-vs-delivered is DERIVED from
// scheduled_at vs now(); it is not stored. Cancellation, if ever needed, would
// be an explicit `cancelled_at` column (not built in v1).

export const invitationStatus = pgEnum("invitation_status", [
  "pending",
  "accepted",
  "revoked",
  "expired",
]);

/** No extraction happens in v1; column exists for the AI layer. */
export const extractionStatus = pgEnum("extraction_status", [
  "none",
  "pending",
  "processing",
  "done",
  "failed",
]);

/** v1 only ever writes 'tutor'. 'agent' reserved for the AI layer. */
export const feedbackAuthorType = pgEnum("feedback_author_type", [
  "tutor",
  "agent",
]);

/* -------------------------------------------------------------------------- */
/* profiles — one row per Supabase auth user                                   */
/* -------------------------------------------------------------------------- */

export const profiles = pgTable("profiles", {
  // PK equals auth.users.id; no default — set at account creation.
  id: uuid("id")
    .primaryKey()
    .references(() => authUsers.id, { onDelete: "cascade" }),
  // Coarse capability + billing boundary. Defaults to 'tutor' so self-signup
  // (and any existing backfilled account) is a tutor; the invite path sets
  // 'student' explicitly.
  role: userRole("role").notNull().default("tutor"),
  fullName: text("full_name"),
  // Mirror of auth email, lower-cased, kept for invite matching & joins.
  // auth.users.email remains the source of truth.
  email: text("email").notNull(),
  ...timestamps,
  ...softDelete,
});

/* -------------------------------------------------------------------------- */
/* classes — one tutor, one subject, many students                            */
/* -------------------------------------------------------------------------- */

export const classes = pgTable(
  "classes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tutorId: uuid("tutor_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    subject: text("subject"), // free text in v1; structured topics are separate
    ...timestamps,
    ...softDelete,
  },
  (t) => [index("classes_tutor_id_idx").on(t.tutorId)],
);

/* -------------------------------------------------------------------------- */
/* enrollments — a student's membership in a class (collection from day one)   */
/* -------------------------------------------------------------------------- */

export const enrollments = pgTable(
  "enrollments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    classId: uuid("class_id")
      .notNull()
      .references(() => classes.id, { onDelete: "cascade" }),
    studentId: uuid("student_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "restrict" }),
    enrolledAt: timestamp("enrolled_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    ...timestamps,
    ...softDelete,
  },
  (t) => [
    index("enrollments_student_id_idx").on(t.studentId),
    index("enrollments_class_id_idx").on(t.classId),
    // A student is enrolled in a class at most once while live.
    uniqueIndex("enrollments_class_student_live_uidx")
      .on(t.classId, t.studentId)
      .where(sql`${t.deletedAt} is null`),
  ],
);

/* -------------------------------------------------------------------------- */
/* invitations — email-bound, single-use, pre-enrollment token                 */
/* -------------------------------------------------------------------------- */

export const invitations = pgTable(
  "invitations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    classId: uuid("class_id")
      .notNull()
      .references(() => classes.id, { onDelete: "cascade" }),
    // The address the invite is bound to. Acceptance requires proving control
    // of THIS email; the link is a convenience, not the authority.
    email: text("email").notNull(),
    // Opaque, unguessable token identifying the invitation (store a hash).
    tokenHash: text("token_hash").notNull(),
    invitedByUserId: uuid("invited_by_user_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "restrict" }),
    status: invitationStatus("status").notNull().default("pending"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    acceptedByUserId: uuid("accepted_by_user_id").references(
      () => profiles.id,
      { onDelete: "set null" },
    ),
    ...timestamps,
    ...softDelete,
  },
  (t) => [
    index("invitations_class_id_idx").on(t.classId),
    uniqueIndex("invitations_token_hash_uidx").on(t.tokenHash),
    // At most one live pending invite per (class, email).
    uniqueIndex("invitations_class_email_pending_uidx")
      .on(t.classId, sql`lower(${t.email})`)
      .where(sql`${t.status} = 'pending' and ${t.deletedAt} is null`),
    check("invitations_expiry_after_creation", sql`${t.expiresAt} > ${t.createdAt}`),
  ],
);

/* -------------------------------------------------------------------------- */
/* sessions — THE organising unit                                              */
/* -------------------------------------------------------------------------- */

export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    classId: uuid("class_id")
      .notNull()
      .references(() => classes.id, { onDelete: "cascade" }),
    title: text("title"),
    // The lesson's date/time (may be future=planned or past=delivered).
    scheduledAt: timestamp("scheduled_at", { withTimezone: true }).notNull(),
    // Tutor's IANA timezone at creation, e.g. "Europe/London". Render local.
    timezone: text("timezone").notNull(),
    // planned vs delivered is derived: scheduled_at > now() => planned.
    ...timestamps,
    ...softDelete,
  },
  (t) => [
    index("sessions_class_id_idx").on(t.classId),
    index("sessions_scheduled_at_idx").on(t.scheduledAt),
  ],
);

/* -------------------------------------------------------------------------- */
/* attachments — pure stored-file metadata. Points at a private object.        */
/* -------------------------------------------------------------------------- */

export const attachments = pgTable(
  "attachments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Opaque object key in the private bucket. NEVER derived from filename/ids.
    bucket: text("bucket").notNull(),
    objectKey: text("object_key").notNull(),
    // Original filename is metadata ONLY, never part of the storage path.
    originalFilename: text("original_filename").notNull(),
    mimeType: text("mime_type").notNull(),
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
    uploadedByUserId: uuid("uploaded_by_user_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "restrict" }),
    // --- Forward-compat AI hooks (no behaviour in v1) ---
    extractedText: text("extracted_text"),
    extractionStatus: extractionStatus("extraction_status")
      .notNull()
      .default("none"),
    ...timestamps,
    ...softDelete,
  },
  (t) => [
    uniqueIndex("attachments_object_key_uidx").on(t.objectKey),
    check("attachments_size_bytes_nonneg", sql`${t.sizeBytes} >= 0`),
  ],
);

/* -------------------------------------------------------------------------- */
/* materials — a titled file attached to one session by the tutor             */
/* -------------------------------------------------------------------------- */

export const materials = pgTable(
  "materials",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    attachmentId: uuid("attachment_id")
      .notNull()
      .references(() => attachments.id, { onDelete: "restrict" }),
    title: text("title"), // defaults to filename in UI if null
    createdByUserId: uuid("created_by_user_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "restrict" }),
    ...timestamps,
    ...softDelete,
  },
  (t) => [index("materials_session_id_idx").on(t.sessionId)],
);

/* -------------------------------------------------------------------------- */
/* assignments — homework issued in a session, reviewed in a later one         */
/* -------------------------------------------------------------------------- */

export const assignments = pgTable(
  "assignments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    issuedInSessionId: uuid("issued_in_session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    // Usually a LATER session. Nullable. Not derived from due date.
    reviewSessionId: uuid("review_session_id").references(() => sessions.id, {
      onDelete: "set null",
    }),
    title: text("title").notNull(),
    instructions: text("instructions"),
    // Independent of session dates. Nullable at DB; product may require it.
    dueAt: timestamp("due_at", { withTimezone: true }),
    createdByUserId: uuid("created_by_user_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "restrict" }),
    ...timestamps,
    ...softDelete,
  },
  (t) => [
    index("assignments_issued_in_session_id_idx").on(t.issuedInSessionId),
    index("assignments_review_session_id_idx").on(t.reviewSessionId),
  ],
);

/** Many question PDFs/worksheets per assignment, uploaded by the tutor when
 * issuing the homework. Points at the shared attachments table. */
export const assignmentAttachments = pgTable(
  "assignment_attachments",
  {
    assignmentId: uuid("assignment_id")
      .notNull()
      .references(() => assignments.id, { onDelete: "cascade" }),
    attachmentId: uuid("attachment_id")
      .notNull()
      .references(() => attachments.id, { onDelete: "restrict" }),
  },
  (t) => [
    primaryKey({ columns: [t.assignmentId, t.attachmentId] }),
    // An attachment belongs to exactly one owner (see decisions doc #1).
    uniqueIndex("assignment_attachments_attachment_id_uidx").on(t.attachmentId),
  ],
);

/* -------------------------------------------------------------------------- */
/* submissions — append-only. Resubmission = new version, never overwrite.     */
/* -------------------------------------------------------------------------- */

export const submissions = pgTable(
  "submissions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    assignmentId: uuid("assignment_id")
      .notNull()
      .references(() => assignments.id, { onDelete: "cascade" }),
    // Whose work this is.
    studentId: uuid("student_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "restrict" }),
    // Who actually created the row (may be the tutor uploading paper on
    // behalf of the student). Kept separate from student_id by design.
    uploadedByUserId: uuid("uploaded_by_user_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "restrict" }),
    // Monotonic per (assignment, student). Resubmission increments this.
    version: integer("version").notNull().default(1),
    // A submission may be text and/or files (files via submission_attachments).
    bodyText: text("body_text"),
    submittedAt: timestamp("submitted_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    ...timestamps,
    ...softDelete,
  },
  (t) => [
    index("submissions_assignment_id_idx").on(t.assignmentId),
    index("submissions_student_id_idx").on(t.studentId),
    uniqueIndex("submissions_assignment_student_version_uidx").on(
      t.assignmentId,
      t.studentId,
      t.version,
    ),
    check("submissions_version_positive", sql`${t.version} > 0`),
  ],
);

/** Many files per submission (multi-image phone uploads, etc.). */
export const submissionAttachments = pgTable(
  "submission_attachments",
  {
    submissionId: uuid("submission_id")
      .notNull()
      .references(() => submissions.id, { onDelete: "cascade" }),
    attachmentId: uuid("attachment_id")
      .notNull()
      .references(() => attachments.id, { onDelete: "restrict" }),
  },
  (t) => [
    primaryKey({ columns: [t.submissionId, t.attachmentId] }),
    // An attachment belongs to exactly one owner (see decisions doc #1).
    uniqueIndex("submission_attachments_attachment_id_uidx").on(t.attachmentId),
  ],
);

/* -------------------------------------------------------------------------- */
/* feedback — AI-layer hook. v1 writes only 'tutor' rows.                       */
/* -------------------------------------------------------------------------- */

export const feedback = pgTable(
  "feedback",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    submissionId: uuid("submission_id")
      .notNull()
      .references(() => submissions.id, { onDelete: "cascade" }),
    authorType: feedbackAuthorType("author_type").notNull(),
    authorUserId: uuid("author_user_id").references(() => profiles.id, {
      onDelete: "set null",
    }),
    body: text("body").notNull(),
    ...timestamps,
    ...softDelete,
  },
  (t) => [index("feedback_submission_id_idx").on(t.submissionId)],
);

/* -------------------------------------------------------------------------- */
/* topics + assignment_topics — the highest-value AI hook. Tutor-tagged.        */
/* -------------------------------------------------------------------------- */

export const topics = pgTable(
  "topics",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Topics are owned/curated per tutor.
    tutorId: uuid("tutor_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    ...timestamps,
    ...softDelete,
  },
  (t) => [
    uniqueIndex("topics_tutor_name_live_uidx")
      .on(t.tutorId, sql`lower(${t.name})`)
      .where(sql`${t.deletedAt} is null`),
  ],
);

export const assignmentTopics = pgTable(
  "assignment_topics",
  {
    assignmentId: uuid("assignment_id")
      .notNull()
      .references(() => assignments.id, { onDelete: "cascade" }),
    topicId: uuid("topic_id")
      .notNull()
      .references(() => topics.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.assignmentId, t.topicId] })],
);

/* -------------------------------------------------------------------------- */
/* events — append-only audit/activity log. No soft-delete.                     */
/* Written on: upload, issue, submit, grade (and more later).                   */
/* -------------------------------------------------------------------------- */

export const events = pgTable(
  "events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    actorId: uuid("actor_id").references(() => profiles.id, {
      onDelete: "set null",
    }),
    verb: text("verb").notNull(), // e.g. 'material.uploaded', 'assignment.issued'
    subjectType: text("subject_type").notNull(), // e.g. 'material', 'submission'
    subjectId: uuid("subject_id").notNull(),
    payload: jsonb("payload"),
    occurredAt: timestamp("occurred_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("events_subject_idx").on(t.subjectType, t.subjectId),
    index("events_actor_id_idx").on(t.actorId),
    index("events_occurred_at_idx").on(t.occurredAt),
  ],
);
