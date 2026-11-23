ALTER TYPE "public"."ai_purpose" ADD VALUE 'sample_pitch';--> statement-breakpoint
-- Before the saved bullet fact key below, which references it.
ALTER TABLE "mpc_facts" ADD CONSTRAINT "mpc_facts_agency_id_unique" UNIQUE("agency_id","id");--> statement-breakpoint
CREATE TABLE "mpc_saved_bullets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agency_id" uuid NOT NULL,
	"mpc_id" uuid NOT NULL,
	"fact_id" uuid NOT NULL,
	"position" smallint NOT NULL,
	"text" text NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mpc_saved_bullets_mpc_position_unique" UNIQUE("mpc_id","position"),
	CONSTRAINT "mpc_saved_bullets_position_range" CHECK ("mpc_saved_bullets"."position" BETWEEN 1 AND 3)
);
--> statement-breakpoint
ALTER TABLE "mpc_saved_bullets" ADD CONSTRAINT "mpc_saved_bullets_agency_id_agencies_id_fk" FOREIGN KEY ("agency_id") REFERENCES "public"."agencies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mpc_saved_bullets" ADD CONSTRAINT "mpc_saved_bullets_mpc_fk" FOREIGN KEY ("agency_id","mpc_id") REFERENCES "public"."mpcs"("agency_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mpc_saved_bullets" ADD CONSTRAINT "mpc_saved_bullets_fact_fk" FOREIGN KEY ("agency_id","fact_id") REFERENCES "public"."mpc_facts"("agency_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mpc_saved_bullets" ADD CONSTRAINT "mpc_saved_bullets_created_by_member_fk" FOREIGN KEY ("agency_id","created_by") REFERENCES "public"."memberships"("agency_id","user_id") ON DELETE no action ON UPDATE no action;