CREATE TYPE "public"."ai_purpose" AS ENUM('extraction', 'find_more');--> statement-breakpoint
CREATE TABLE "ai_usage" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agency_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"purpose" "ai_purpose" NOT NULL,
	"model" text NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"web_searches" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agencies" ADD COLUMN "enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "agencies" ADD COLUMN "clerk_updated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "memberships" ADD COLUMN "clerk_updated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "mpc_facts" ADD COLUMN "source_document_id" uuid;--> statement-breakpoint
ALTER TABLE "mpc_facts" ADD COLUMN "edited_by" uuid;--> statement-breakpoint
ALTER TABLE "mpc_facts" ADD COLUMN "edited_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "clerk_updated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "ai_usage" ADD CONSTRAINT "ai_usage_agency_id_agencies_id_fk" FOREIGN KEY ("agency_id") REFERENCES "public"."agencies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_usage" ADD CONSTRAINT "ai_usage_user_member_fk" FOREIGN KEY ("agency_id","user_id") REFERENCES "public"."memberships"("agency_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_usage_agency_created_idx" ON "ai_usage" USING btree ("agency_id","created_at");--> statement-breakpoint
CREATE INDEX "ai_usage_agency_user_created_idx" ON "ai_usage" USING btree ("agency_id","user_id","created_at");--> statement-breakpoint
ALTER TABLE "mpc_facts" ADD CONSTRAINT "mpc_facts_edited_by_member_fk" FOREIGN KEY ("agency_id","edited_by") REFERENCES "public"."memberships"("agency_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mpc_documents" ADD CONSTRAINT "mpc_documents_agency_id_unique" UNIQUE("agency_id","id");--> statement-breakpoint
-- Column-only SET NULL (PostgreSQL 15+): deleting a document clears the link, never agency_id.
ALTER TABLE "mpc_facts" ADD CONSTRAINT "mpc_facts_source_document_fk" FOREIGN KEY ("agency_id","source_document_id") REFERENCES "public"."mpc_documents"("agency_id","id") ON DELETE SET NULL ("source_document_id") ON UPDATE no action;