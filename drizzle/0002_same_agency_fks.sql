ALTER TABLE "mpc_consents" DROP CONSTRAINT "mpc_consents_mpc_id_mpcs_id_fk";
--> statement-breakpoint
ALTER TABLE "mpc_consents" DROP CONSTRAINT "mpc_consents_recorded_by_users_id_fk";
--> statement-breakpoint
ALTER TABLE "mpc_credentials" DROP CONSTRAINT "mpc_credentials_mpc_id_mpcs_id_fk";
--> statement-breakpoint
ALTER TABLE "mpc_documents" DROP CONSTRAINT "mpc_documents_mpc_id_mpcs_id_fk";
--> statement-breakpoint
ALTER TABLE "mpc_documents" DROP CONSTRAINT "mpc_documents_created_by_users_id_fk";
--> statement-breakpoint
ALTER TABLE "mpc_facts" DROP CONSTRAINT "mpc_facts_mpc_id_mpcs_id_fk";
--> statement-breakpoint
ALTER TABLE "mpc_facts" DROP CONSTRAINT "mpc_facts_confirmed_by_users_id_fk";
--> statement-breakpoint
ALTER TABLE "mpc_restrictions" DROP CONSTRAINT "mpc_restrictions_mpc_id_mpcs_id_fk";
--> statement-breakpoint
ALTER TABLE "mpcs" DROP CONSTRAINT "mpcs_owner_user_id_users_id_fk";
--> statement-breakpoint
-- Unique key must exist before the composite FKs that reference it.
ALTER TABLE "mpcs" ADD CONSTRAINT "mpcs_agency_id_unique" UNIQUE("agency_id","id");--> statement-breakpoint
ALTER TABLE "mpc_consents" ADD CONSTRAINT "mpc_consents_mpc_fk" FOREIGN KEY ("agency_id","mpc_id") REFERENCES "public"."mpcs"("agency_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mpc_consents" ADD CONSTRAINT "mpc_consents_recorded_by_member_fk" FOREIGN KEY ("agency_id","recorded_by") REFERENCES "public"."memberships"("agency_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mpc_credentials" ADD CONSTRAINT "mpc_credentials_mpc_fk" FOREIGN KEY ("agency_id","mpc_id") REFERENCES "public"."mpcs"("agency_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mpc_documents" ADD CONSTRAINT "mpc_documents_mpc_fk" FOREIGN KEY ("agency_id","mpc_id") REFERENCES "public"."mpcs"("agency_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mpc_documents" ADD CONSTRAINT "mpc_documents_created_by_member_fk" FOREIGN KEY ("agency_id","created_by") REFERENCES "public"."memberships"("agency_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mpc_facts" ADD CONSTRAINT "mpc_facts_mpc_fk" FOREIGN KEY ("agency_id","mpc_id") REFERENCES "public"."mpcs"("agency_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mpc_facts" ADD CONSTRAINT "mpc_facts_confirmed_by_member_fk" FOREIGN KEY ("agency_id","confirmed_by") REFERENCES "public"."memberships"("agency_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mpc_restrictions" ADD CONSTRAINT "mpc_restrictions_mpc_fk" FOREIGN KEY ("agency_id","mpc_id") REFERENCES "public"."mpcs"("agency_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mpcs" ADD CONSTRAINT "mpcs_owner_member_fk" FOREIGN KEY ("agency_id","owner_user_id") REFERENCES "public"."memberships"("agency_id","user_id") ON DELETE no action ON UPDATE no action;