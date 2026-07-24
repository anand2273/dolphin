CREATE TYPE "public"."user_role" AS ENUM('tutor', 'student');--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "role" "user_role" DEFAULT 'tutor' NOT NULL;