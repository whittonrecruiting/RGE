ALTER TYPE "public"."mpc_status" ADD VALUE 'draft' BEFORE 'active';--> statement-breakpoint
ALTER TABLE "mpcs" ALTER COLUMN "headline_role" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "mpcs" ALTER COLUMN "location" DROP NOT NULL;--> statement-breakpoint
-- status is compared as text: 'draft' was added above in this same transaction, and an uncommitted
-- enum value cannot be used as an enum literal (Postgres "unsafe use of new value").
ALTER TABLE "mpcs" ADD CONSTRAINT "mpcs_required_unless_draft" CHECK ("mpcs"."status"::text = 'draft' OR ("mpcs"."headline_role" IS NOT NULL AND "mpcs"."location" IS NOT NULL));