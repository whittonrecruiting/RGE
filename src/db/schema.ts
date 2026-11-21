import {
  boolean,
  date,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

// Row-level security for every agency-owned table lives in src/db/rls.sql
// (applied as a custom migration). A new agency-owned table must be added there too.

const id = () => uuid("id").primaryKey().defaultRandom();
const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
};
const agencyId = () =>
  uuid("agency_id")
    .notNull()
    .references(() => agencies.id, { onDelete: "cascade" });
const mpcId = () =>
  uuid("mpc_id")
    .notNull()
    .references(() => mpcs.id, { onDelete: "cascade" });

export const membershipRole = pgEnum("membership_role", ["owner", "admin", "recruiter"]);
export const mpcStatus = pgEnum("mpc_status", ["active", "paused", "removed", "placed"]);
export const workMode = pgEnum("work_mode", ["onsite", "hybrid", "remote", "any"]);
export const employerType = pgEnum("employer_type", ["inhouse", "firm", "either"]);
export const factSourceKind = pgEnum("fact_source_kind", ["resume", "notes", "transcript", "web", "manual"]);
export const factStatus = pgEnum("fact_status", ["usable", "interview_only", "confirmed"]);
export const restrictionKind = pgEnum("restriction_kind", [
  "never_say",
  "confidential",
  "excluded_company",
  "region_exclusion",
]);
export const consentMethod = pgEnum("consent_method", ["verbal", "email", "signed_form"]);
export const documentKind = pgEnum("document_kind", ["resume", "notes", "transcript"]);

export const agencies = pgTable("agencies", {
  id: id(),
  clerkOrgId: text("clerk_org_id").notNull().unique(),
  name: text("name").notNull(),
  timeZone: text("time_zone").notNull().default("America/Phoenix"),
  ...timestamps,
});

// Global (no RLS): identity only. Never add agency data here.
export const users = pgTable("users", {
  id: id(),
  clerkUserId: text("clerk_user_id").notNull().unique(),
  email: text("email").notNull(),
  name: text("name").notNull(),
  ...timestamps,
});

export const memberships = pgTable(
  "memberships",
  {
    id: id(),
    agencyId: agencyId(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: membershipRole("role").notNull(),
    ...timestamps,
  },
  (t) => [unique("memberships_agency_user_unique").on(t.agencyId, t.userId)],
);

export const mpcs = pgTable("mpcs", {
  id: id(),
  agencyId: agencyId(),
  ownerUserId: uuid("owner_user_id")
    .notNull()
    .references(() => users.id),
  status: mpcStatus("status").notNull().default("active"),
  pauseReason: text("pause_reason"),
  headlineRole: text("headline_role").notNull(),
  location: text("location").notNull(),
  yearsExperience: integer("years_experience"),
  seniority: text("seniority"),
  specialtyTags: text("specialty_tags").array().notNull().default([]),
  workMode: workMode("work_mode").notNull().default("any"),
  employerType: employerType("employer_type").notNull().default("either"),
  targetCities: text("target_cities").array().notNull().default([]),
  payFloor: integer("pay_floor"),
  payFloorStrict: boolean("pay_floor_strict").notNull().default(false),
  payTarget: integer("pay_target"),
  overlapPriority: integer("overlap_priority").notNull().default(0),
  ...timestamps,
});

export const mpcCredentials = pgTable("mpc_credentials", {
  id: id(),
  agencyId: agencyId(),
  mpcId: mpcId(),
  kind: text("kind").notNull(),
  region: text("region"),
  verified: boolean("verified").notNull().default(false),
  ...timestamps,
});

export const mpcFacts = pgTable("mpc_facts", {
  id: id(),
  agencyId: agencyId(),
  mpcId: mpcId(),
  text: text("text").notNull(),
  sourceKind: factSourceKind("source_kind").notNull(),
  sourceRef: text("source_ref"),
  sourceQuote: text("source_quote"),
  status: factStatus("status").notNull().default("usable"),
  confirmedBy: uuid("confirmed_by").references(() => users.id),
  confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
  ...timestamps,
});

export const mpcRestrictions = pgTable("mpc_restrictions", {
  id: id(),
  agencyId: agencyId(),
  mpcId: mpcId(),
  kind: restrictionKind("kind").notNull(),
  value: text("value").notNull(),
  ...timestamps,
});

export const mpcConsents = pgTable("mpc_consents", {
  id: id(),
  agencyId: agencyId(),
  mpcId: mpcId(),
  givenOn: date("given_on").notNull(),
  method: consentMethod("method").notNull(),
  proofBlobUrl: text("proof_blob_url"),
  recordedBy: uuid("recorded_by")
    .notNull()
    .references(() => users.id),
  ...timestamps,
});

export const mpcDocuments = pgTable("mpc_documents", {
  id: id(),
  agencyId: agencyId(),
  mpcId: mpcId(),
  kind: documentKind("kind").notNull(),
  blobUrl: text("blob_url"),
  filename: text("filename").notNull(),
  text: text("text"),
  createdBy: uuid("created_by")
    .notNull()
    .references(() => users.id),
  ...timestamps,
});

export const agencySettings = pgTable("agency_settings", {
  agencyId: uuid("agency_id")
    .primaryKey()
    .references(() => agencies.id, { onDelete: "cascade" }),
  values: jsonb("values").notNull().default({}),
  ...timestamps,
});
