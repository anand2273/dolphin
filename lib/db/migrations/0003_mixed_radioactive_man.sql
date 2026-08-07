CREATE TABLE "concept_merge_rejections" (
	"tutor_id" uuid NOT NULL,
	"concept_a_id" uuid NOT NULL,
	"concept_b_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "concept_merge_rejections_concept_a_id_concept_b_id_pk" PRIMARY KEY("concept_a_id","concept_b_id")
);
--> statement-breakpoint
ALTER TABLE "concepts" ADD COLUMN "merged_into_id" uuid;--> statement-breakpoint
ALTER TABLE "concept_merge_rejections" ADD CONSTRAINT "concept_merge_rejections_tutor_id_profiles_id_fk" FOREIGN KEY ("tutor_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "concept_merge_rejections" ADD CONSTRAINT "concept_merge_rejections_concept_a_id_concepts_id_fk" FOREIGN KEY ("concept_a_id") REFERENCES "public"."concepts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "concept_merge_rejections" ADD CONSTRAINT "concept_merge_rejections_concept_b_id_concepts_id_fk" FOREIGN KEY ("concept_b_id") REFERENCES "public"."concepts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "concept_merge_rejections_tutor_id_idx" ON "concept_merge_rejections" USING btree ("tutor_id");--> statement-breakpoint
ALTER TABLE "concepts" ADD CONSTRAINT "concepts_merged_into_id_concepts_id_fk" FOREIGN KEY ("merged_into_id") REFERENCES "public"."concepts"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "concept_merge_rejections"
  ADD CONSTRAINT "concept_merge_rejections_ordered"
  CHECK ("concept_a_id" < "concept_b_id");