CREATE TYPE "public"."membership_status" AS ENUM('active', 'removed');--> statement-breakpoint
ALTER TABLE "memberships" ADD COLUMN "status" "membership_status" DEFAULT 'active' NOT NULL;