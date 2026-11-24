CREATE TYPE "public"."dnc_source" AS ENUM('manual', 'csv');--> statement-breakpoint
CREATE TYPE "public"."inbox_status" AS ENUM('connected', 'needs_reconnect', 'disconnected');--> statement-breakpoint
CREATE TYPE "public"."ledger_event_type" AS ENUM('proposed', 'drafted', 'approved', 'denied', 'sent', 'follow_up_sent', 'received', 'replied_interested', 'replied_declined', 'opted_out', 'bounced', 'out_of_office', 'lead_stage_change', 'agreement_signed');--> statement-breakpoint
CREATE TYPE "public"."ledger_source" AS ENUM('rge', 'gmail', 'import', 'manual');--> statement-breakpoint
CREATE TYPE "public"."suppression_reason" AS ENUM('opted_out', 'bounced', 'manual');--> statement-breakpoint
CREATE TABLE "companies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agency_id" uuid NOT NULL,
	"name" text NOT NULL,
	"is_client" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "companies_agency_id_unique" UNIQUE("agency_id","id")
);
--> statement-breakpoint
CREATE TABLE "company_domains" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agency_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"domain" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "company_domains_agency_domain_unique" UNIQUE("agency_id","domain")
);
--> statement-breakpoint
CREATE TABLE "contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agency_id" uuid NOT NULL,
	"email" text NOT NULL,
	"company_id" uuid,
	"name" text,
	"title" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contacts_agency_email_unique" UNIQUE("agency_id","email"),
	CONSTRAINT "contacts_agency_id_unique" UNIQUE("agency_id","id")
);
--> statement-breakpoint
CREATE TABLE "do_not_contact" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agency_id" uuid NOT NULL,
	"name" text NOT NULL,
	"domains" text[] DEFAULT '{}'::text[] NOT NULL,
	"aliases" text[] DEFAULT '{}'::text[] NOT NULL,
	"source" "dnc_source" NOT NULL,
	"note" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inbox_credentials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agency_id" uuid NOT NULL,
	"inbox_id" uuid NOT NULL,
	"refresh_token_enc" text NOT NULL,
	"scopes" text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inbox_credentials_inbox_unique" UNIQUE("inbox_id")
);
--> statement-breakpoint
CREATE TABLE "inboxes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agency_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"email" text NOT NULL,
	"provider" text DEFAULT 'gmail' NOT NULL,
	"status" "inbox_status" DEFAULT 'connected' NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"signature_html" text,
	"domain_check" jsonb,
	"domain_checked_at" timestamp with time zone,
	"backfill_from" timestamp with time zone NOT NULL,
	"backfill_cursor" jsonb,
	"backfill_done_at" timestamp with time zone,
	"history_id" text,
	"last_synced_at" timestamp with time zone,
	"last_sync_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inboxes_agency_email_unique" UNIQUE("agency_id","email"),
	CONSTRAINT "inboxes_agency_id_unique" UNIQUE("agency_id","id")
);
--> statement-breakpoint
CREATE TABLE "ledger_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agency_id" uuid NOT NULL,
	"type" "ledger_event_type" NOT NULL,
	"email" text,
	"domain" text,
	"contact_id" uuid,
	"company_id" uuid,
	"mpc_id" uuid,
	"user_id" uuid,
	"inbox_id" uuid,
	"gmail_message_id" text,
	"gmail_thread_id" text,
	"occurred_at" timestamp with time zone NOT NULL,
	"source" "ledger_source" NOT NULL,
	"dedupe_key" text NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ledger_events_agency_dedupe_unique" UNIQUE("agency_id","dedupe_key")
);
--> statement-breakpoint
CREATE TABLE "suppressions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agency_id" uuid NOT NULL,
	"email" text NOT NULL,
	"reason" "suppression_reason" NOT NULL,
	"source" "ledger_source" NOT NULL,
	"note" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "suppressions_agency_email_unique" UNIQUE("agency_id","email")
);
--> statement-breakpoint
ALTER TABLE "companies" ADD CONSTRAINT "companies_agency_id_agencies_id_fk" FOREIGN KEY ("agency_id") REFERENCES "public"."agencies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_domains" ADD CONSTRAINT "company_domains_agency_id_agencies_id_fk" FOREIGN KEY ("agency_id") REFERENCES "public"."agencies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_domains" ADD CONSTRAINT "company_domains_company_fk" FOREIGN KEY ("agency_id","company_id") REFERENCES "public"."companies"("agency_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_agency_id_agencies_id_fk" FOREIGN KEY ("agency_id") REFERENCES "public"."agencies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_company_fk" FOREIGN KEY ("agency_id","company_id") REFERENCES "public"."companies"("agency_id","id") ON DELETE SET NULL ("company_id") ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "do_not_contact" ADD CONSTRAINT "do_not_contact_agency_id_agencies_id_fk" FOREIGN KEY ("agency_id") REFERENCES "public"."agencies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "do_not_contact" ADD CONSTRAINT "do_not_contact_created_by_member_fk" FOREIGN KEY ("agency_id","created_by") REFERENCES "public"."memberships"("agency_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbox_credentials" ADD CONSTRAINT "inbox_credentials_agency_id_agencies_id_fk" FOREIGN KEY ("agency_id") REFERENCES "public"."agencies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbox_credentials" ADD CONSTRAINT "inbox_credentials_inbox_fk" FOREIGN KEY ("agency_id","inbox_id") REFERENCES "public"."inboxes"("agency_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inboxes" ADD CONSTRAINT "inboxes_agency_id_agencies_id_fk" FOREIGN KEY ("agency_id") REFERENCES "public"."agencies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inboxes" ADD CONSTRAINT "inboxes_user_member_fk" FOREIGN KEY ("agency_id","user_id") REFERENCES "public"."memberships"("agency_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_events" ADD CONSTRAINT "ledger_events_agency_id_agencies_id_fk" FOREIGN KEY ("agency_id") REFERENCES "public"."agencies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_events" ADD CONSTRAINT "ledger_events_contact_fk" FOREIGN KEY ("agency_id","contact_id") REFERENCES "public"."contacts"("agency_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_events" ADD CONSTRAINT "ledger_events_company_fk" FOREIGN KEY ("agency_id","company_id") REFERENCES "public"."companies"("agency_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_events" ADD CONSTRAINT "ledger_events_mpc_fk" FOREIGN KEY ("agency_id","mpc_id") REFERENCES "public"."mpcs"("agency_id","id") ON DELETE SET NULL ("mpc_id") ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_events" ADD CONSTRAINT "ledger_events_user_member_fk" FOREIGN KEY ("agency_id","user_id") REFERENCES "public"."memberships"("agency_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_events" ADD CONSTRAINT "ledger_events_inbox_fk" FOREIGN KEY ("agency_id","inbox_id") REFERENCES "public"."inboxes"("agency_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suppressions" ADD CONSTRAINT "suppressions_agency_id_agencies_id_fk" FOREIGN KEY ("agency_id") REFERENCES "public"."agencies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suppressions" ADD CONSTRAINT "suppressions_created_by_member_fk" FOREIGN KEY ("agency_id","created_by") REFERENCES "public"."memberships"("agency_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ledger_events_agency_email_idx" ON "ledger_events" USING btree ("agency_id","email","occurred_at");--> statement-breakpoint
CREATE INDEX "ledger_events_agency_company_idx" ON "ledger_events" USING btree ("agency_id","company_id","occurred_at");--> statement-breakpoint
CREATE INDEX "ledger_events_agency_type_idx" ON "ledger_events" USING btree ("agency_id","type","occurred_at");