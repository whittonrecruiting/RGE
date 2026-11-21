CREATE TYPE "public"."consent_method" AS ENUM('verbal', 'email', 'signed_form');--> statement-breakpoint
CREATE TYPE "public"."document_kind" AS ENUM('resume', 'notes', 'transcript');--> statement-breakpoint
CREATE TYPE "public"."employer_type" AS ENUM('inhouse', 'firm', 'either');--> statement-breakpoint
CREATE TYPE "public"."fact_source_kind" AS ENUM('resume', 'notes', 'transcript', 'web', 'manual');--> statement-breakpoint
CREATE TYPE "public"."fact_status" AS ENUM('usable', 'interview_only', 'confirmed');--> statement-breakpoint
CREATE TYPE "public"."membership_role" AS ENUM('owner', 'admin', 'recruiter');--> statement-breakpoint
CREATE TYPE "public"."mpc_status" AS ENUM('active', 'paused', 'removed', 'placed');--> statement-breakpoint
CREATE TYPE "public"."restriction_kind" AS ENUM('never_say', 'confidential', 'excluded_company', 'region_exclusion');--> statement-breakpoint
CREATE TYPE "public"."work_mode" AS ENUM('onsite', 'hybrid', 'remote', 'any');--> statement-breakpoint
CREATE TABLE "agencies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clerk_org_id" text NOT NULL,
	"name" text NOT NULL,
	"time_zone" text DEFAULT 'America/Phoenix' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agencies_clerk_org_id_unique" UNIQUE("clerk_org_id")
);
--> statement-breakpoint
CREATE TABLE "agency_settings" (
	"agency_id" uuid PRIMARY KEY NOT NULL,
	"values" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "memberships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agency_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "membership_role" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "memberships_agency_user_unique" UNIQUE("agency_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "mpc_consents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agency_id" uuid NOT NULL,
	"mpc_id" uuid NOT NULL,
	"given_on" date NOT NULL,
	"method" "consent_method" NOT NULL,
	"proof_blob_url" text,
	"recorded_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mpc_credentials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agency_id" uuid NOT NULL,
	"mpc_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"region" text,
	"verified" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mpc_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agency_id" uuid NOT NULL,
	"mpc_id" uuid NOT NULL,
	"kind" "document_kind" NOT NULL,
	"blob_url" text,
	"filename" text NOT NULL,
	"text" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mpc_facts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agency_id" uuid NOT NULL,
	"mpc_id" uuid NOT NULL,
	"text" text NOT NULL,
	"source_kind" "fact_source_kind" NOT NULL,
	"source_ref" text,
	"source_quote" text,
	"status" "fact_status" DEFAULT 'usable' NOT NULL,
	"confirmed_by" uuid,
	"confirmed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mpc_restrictions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agency_id" uuid NOT NULL,
	"mpc_id" uuid NOT NULL,
	"kind" "restriction_kind" NOT NULL,
	"value" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mpcs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agency_id" uuid NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"status" "mpc_status" DEFAULT 'active' NOT NULL,
	"pause_reason" text,
	"headline_role" text NOT NULL,
	"location" text NOT NULL,
	"years_experience" integer,
	"seniority" text,
	"specialty_tags" text[] DEFAULT '{}' NOT NULL,
	"work_mode" "work_mode" DEFAULT 'any' NOT NULL,
	"employer_type" "employer_type" DEFAULT 'either' NOT NULL,
	"target_cities" text[] DEFAULT '{}' NOT NULL,
	"pay_floor" integer,
	"pay_floor_strict" boolean DEFAULT false NOT NULL,
	"pay_target" integer,
	"overlap_priority" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clerk_user_id" text NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_clerk_user_id_unique" UNIQUE("clerk_user_id")
);
--> statement-breakpoint
ALTER TABLE "agency_settings" ADD CONSTRAINT "agency_settings_agency_id_agencies_id_fk" FOREIGN KEY ("agency_id") REFERENCES "public"."agencies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_agency_id_agencies_id_fk" FOREIGN KEY ("agency_id") REFERENCES "public"."agencies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mpc_consents" ADD CONSTRAINT "mpc_consents_agency_id_agencies_id_fk" FOREIGN KEY ("agency_id") REFERENCES "public"."agencies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mpc_consents" ADD CONSTRAINT "mpc_consents_mpc_id_mpcs_id_fk" FOREIGN KEY ("mpc_id") REFERENCES "public"."mpcs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mpc_consents" ADD CONSTRAINT "mpc_consents_recorded_by_users_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mpc_credentials" ADD CONSTRAINT "mpc_credentials_agency_id_agencies_id_fk" FOREIGN KEY ("agency_id") REFERENCES "public"."agencies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mpc_credentials" ADD CONSTRAINT "mpc_credentials_mpc_id_mpcs_id_fk" FOREIGN KEY ("mpc_id") REFERENCES "public"."mpcs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mpc_documents" ADD CONSTRAINT "mpc_documents_agency_id_agencies_id_fk" FOREIGN KEY ("agency_id") REFERENCES "public"."agencies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mpc_documents" ADD CONSTRAINT "mpc_documents_mpc_id_mpcs_id_fk" FOREIGN KEY ("mpc_id") REFERENCES "public"."mpcs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mpc_documents" ADD CONSTRAINT "mpc_documents_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mpc_facts" ADD CONSTRAINT "mpc_facts_agency_id_agencies_id_fk" FOREIGN KEY ("agency_id") REFERENCES "public"."agencies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mpc_facts" ADD CONSTRAINT "mpc_facts_mpc_id_mpcs_id_fk" FOREIGN KEY ("mpc_id") REFERENCES "public"."mpcs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mpc_facts" ADD CONSTRAINT "mpc_facts_confirmed_by_users_id_fk" FOREIGN KEY ("confirmed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mpc_restrictions" ADD CONSTRAINT "mpc_restrictions_agency_id_agencies_id_fk" FOREIGN KEY ("agency_id") REFERENCES "public"."agencies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mpc_restrictions" ADD CONSTRAINT "mpc_restrictions_mpc_id_mpcs_id_fk" FOREIGN KEY ("mpc_id") REFERENCES "public"."mpcs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mpcs" ADD CONSTRAINT "mpcs_agency_id_agencies_id_fk" FOREIGN KEY ("agency_id") REFERENCES "public"."agencies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mpcs" ADD CONSTRAINT "mpcs_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;