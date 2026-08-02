CREATE TYPE "public"."syllabus_extraction_status" AS ENUM('none', 'pending', 'processing', 'done', 'failed');--> statement-breakpoint
CREATE TABLE "concepts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tutor_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "syllabuses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tutor_id" uuid NOT NULL,
	"title" text NOT NULL,
	"subject" text,
	"level" text,
	"description" text,
	"source_attachment_id" uuid,
	"preset_key" text,
	"extraction_status" "syllabus_extraction_status" DEFAULT 'none' NOT NULL,
	"extraction_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "topic_concepts" (
	"topic_id" uuid NOT NULL,
	"concept_id" uuid NOT NULL,
	CONSTRAINT "topic_concepts_topic_id_concept_id_pk" PRIMARY KEY("topic_id","concept_id")
);
--> statement-breakpoint
DROP INDEX "topics_tutor_name_live_uidx";--> statement-breakpoint
ALTER TABLE "topics" ADD COLUMN "syllabus_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "topics" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "topics" ADD COLUMN "order_index" integer;--> statement-breakpoint
ALTER TABLE "concepts" ADD CONSTRAINT "concepts_tutor_id_profiles_id_fk" FOREIGN KEY ("tutor_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "syllabuses" ADD CONSTRAINT "syllabuses_tutor_id_profiles_id_fk" FOREIGN KEY ("tutor_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "syllabuses" ADD CONSTRAINT "syllabuses_source_attachment_id_attachments_id_fk" FOREIGN KEY ("source_attachment_id") REFERENCES "public"."attachments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "topic_concepts" ADD CONSTRAINT "topic_concepts_topic_id_topics_id_fk" FOREIGN KEY ("topic_id") REFERENCES "public"."topics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "topic_concepts" ADD CONSTRAINT "topic_concepts_concept_id_concepts_id_fk" FOREIGN KEY ("concept_id") REFERENCES "public"."concepts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "concepts_tutor_name_live_uidx" ON "concepts" USING btree ("tutor_id",lower("name")) WHERE "concepts"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "syllabuses_tutor_id_idx" ON "syllabuses" USING btree ("tutor_id");--> statement-breakpoint
ALTER TABLE "topics" ADD CONSTRAINT "topics_syllabus_id_syllabuses_id_fk" FOREIGN KEY ("syllabus_id") REFERENCES "public"."syllabuses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "topics_syllabus_id_idx" ON "topics" USING btree ("syllabus_id");--> statement-breakpoint
CREATE UNIQUE INDEX "topics_syllabus_name_live_uidx" ON "topics" USING btree ("syllabus_id",lower("name")) WHERE "topics"."deleted_at" is null;