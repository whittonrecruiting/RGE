import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  smallint,
  text,
  timestamp,
  unique,
  uuid,
  type AnyPgColumn,
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
const mpcId = () => uuid("mpc_id").notNull();

// Foreign keys are checked without RLS, so a child row must reference its parent through
// (agency_id, ...) composite keys. Otherwise one agency could link rows to another agency's
// MPC (and learn it exists) or name a non-member as owner, recorder or creator.
type AgencyRow = { agencyId: AnyPgColumn };
const sameAgencyMpc = (t: AgencyRow & { mpcId: AnyPgColumn }, name: string) =>
  foreignKey({ name, columns: [t.agencyId, t.mpcId], foreignColumns: [mpcs.agencyId, mpcs.id] }).onDelete("cascade");
const sameAgencyMember = (t: AgencyRow, col: AnyPgColumn, name: string) =>
  foreignKey({ name, columns: [t.agencyId, col], foreignColumns: [memberships.agencyId, memberships.userId] });

export const membershipRole = pgEnum("membership_role", ["owner", "admin", "recruiter"]);
export const membershipStatus = pgEnum("membership_status", ["active", "removed"]);
export const mpcStatus = pgEnum("mpc_status", ["draft", "active", "paused", "removed", "placed"]);
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
export const aiPurpose = pgEnum("ai_purpose", ["extraction", "find_more", "sample_pitch"]);

// The updated_at of the last Clerk event applied to a row. Older (out of order) events are skipped.
const clerkUpdatedAt = () => timestamp("clerk_updated_at", { withTimezone: true });

export const agencies = pgTable("agencies", {
  id: id(),
  clerkOrgId: text("clerk_org_id").notNull().unique(),
  name: text("name").notNull(),
  timeZone: text("time_zone").notNull().default("America/Phoenix"),
  // No self-serve tenants: a new agency stays disabled until the founder enables it by hand.
  // Neither rge_app nor rge_system may change it (column-limited grants in src/db/rls.sql).
  enabled: boolean("enabled").notNull().default(false),
  clerkUpdatedAt: clerkUpdatedAt(),
  ...timestamps,
});

// Global (no agency_id): identity only. RLS limits rge_app to members of the current agency.
export const users = pgTable("users", {
  id: id(),
  clerkUserId: text("clerk_user_id").notNull().unique(),
  email: text("email").notNull(),
  name: text("name").notNull(),
  clerkUpdatedAt: clerkUpdatedAt(),
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
    // Removal is soft: the row stays so MPCs, consents and facts keep their member references.
    status: membershipStatus("status").notNull().default("active"),
    clerkUpdatedAt: clerkUpdatedAt(),
    ...timestamps,
  },
  (t) => [unique("memberships_agency_user_unique").on(t.agencyId, t.userId)],
);

export const mpcs = pgTable(
  "mpcs",
  {
    id: id(),
    agencyId: agencyId(),
    ownerUserId: uuid("owner_user_id").notNull(),
    status: mpcStatus("status").notNull().default("active"),
    pauseReason: text("pause_reason"),
    // Null only while the MPC is a draft (mpcs_required_unless_draft).
    headlineRole: text("headline_role"),
    location: text("location"),
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
  },
  (t) => [
    unique("mpcs_agency_id_unique").on(t.agencyId, t.id),
    sameAgencyMember(t, t.ownerUserId, "mpcs_owner_member_fk"),
    // Compared as text: the enum value 'draft' is added in the same migration transaction, and a
    // new enum value cannot be used as an enum literal until that transaction commits.
    check(
      "mpcs_required_unless_draft",
      sql`${t.status}::text IN ('draft', 'removed') OR (${t.headlineRole} IS NOT NULL AND ${t.location} IS NOT NULL)`,
    ),
  ],
);

export const mpcCredentials = pgTable(
  "mpc_credentials",
  {
    id: id(),
    agencyId: agencyId(),
    mpcId: mpcId(),
    kind: text("kind").notNull(),
    region: text("region"),
    verified: boolean("verified").notNull().default(false),
    ...timestamps,
  },
  (t) => [sameAgencyMpc(t, "mpc_credentials_mpc_fk")],
);

export const mpcFacts = pgTable(
  "mpc_facts",
  {
    id: id(),
    agencyId: agencyId(),
    mpcId: mpcId(),
    text: text("text").notNull(),
    sourceKind: factSourceKind("source_kind").notNull(),
    sourceRef: text("source_ref"),
    sourceQuote: text("source_quote"),
    status: factStatus("status").notNull().default("usable"),
    confirmedBy: uuid("confirmed_by"),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    // The stored document an extracted fact came from. source_ref keeps the display name.
    sourceDocumentId: uuid("source_document_id"),
    // Who last changed the wording by hand, and when.
    editedBy: uuid("edited_by"),
    editedAt: timestamp("edited_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    // Target of same-agency foreign keys from saved bullets.
    unique("mpc_facts_agency_id_unique").on(t.agencyId, t.id),
    sameAgencyMpc(t, "mpc_facts_mpc_fk"),
    sameAgencyMember(t, t.confirmedBy, "mpc_facts_confirmed_by_member_fk"),
    sameAgencyMember(t, t.editedBy, "mpc_facts_edited_by_member_fk"),
    // The migration narrows this to ON DELETE SET NULL (source_document_id): agency_id stays.
    foreignKey({
      name: "mpc_facts_source_document_fk",
      columns: [t.agencyId, t.sourceDocumentId],
      foreignColumns: [mpcDocuments.agencyId, mpcDocuments.id],
    }).onDelete("set null"),
  ],
);

// The recruiter's preferred three pitch bullets ("Use these bullets"), one per position. A bullet
// goes with its fact: deleting the fact cascades, and editing it clears the bullet (fact-actions).
export const mpcSavedBullets = pgTable(
  "mpc_saved_bullets",
  {
    id: id(),
    agencyId: agencyId(),
    mpcId: mpcId(),
    factId: uuid("fact_id").notNull(),
    position: smallint("position").notNull(),
    text: text("text").notNull(),
    createdBy: uuid("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    sameAgencyMpc(t, "mpc_saved_bullets_mpc_fk"),
    foreignKey({
      name: "mpc_saved_bullets_fact_fk",
      columns: [t.agencyId, t.factId],
      foreignColumns: [mpcFacts.agencyId, mpcFacts.id],
    }).onDelete("cascade"),
    sameAgencyMember(t, t.createdBy, "mpc_saved_bullets_created_by_member_fk"),
    unique("mpc_saved_bullets_mpc_position_unique").on(t.mpcId, t.position),
    check("mpc_saved_bullets_position_range", sql`${t.position} BETWEEN 1 AND 3`),
  ],
);

export const mpcRestrictions = pgTable(
  "mpc_restrictions",
  {
    id: id(),
    agencyId: agencyId(),
    mpcId: mpcId(),
    kind: restrictionKind("kind").notNull(),
    value: text("value").notNull(),
    ...timestamps,
  },
  (t) => [sameAgencyMpc(t, "mpc_restrictions_mpc_fk")],
);

export const mpcConsents = pgTable(
  "mpc_consents",
  {
    id: id(),
    agencyId: agencyId(),
    mpcId: mpcId(),
    givenOn: date("given_on").notNull(),
    method: consentMethod("method").notNull(),
    proofBlobUrl: text("proof_blob_url"),
    recordedBy: uuid("recorded_by").notNull(),
    ...timestamps,
  },
  (t) => [
    sameAgencyMpc(t, "mpc_consents_mpc_fk"),
    sameAgencyMember(t, t.recordedBy, "mpc_consents_recorded_by_member_fk"),
  ],
);

export const mpcDocuments = pgTable(
  "mpc_documents",
  {
    id: id(),
    agencyId: agencyId(),
    mpcId: mpcId(),
    kind: documentKind("kind").notNull(),
    blobUrl: text("blob_url"),
    filename: text("filename").notNull(),
    text: text("text"),
    createdBy: uuid("created_by").notNull(),
    ...timestamps,
  },
  (t) => [
    unique("mpc_documents_agency_id_unique").on(t.agencyId, t.id),
    sameAgencyMpc(t, "mpc_documents_mpc_fk"),
    sameAgencyMember(t, t.createdBy, "mpc_documents_created_by_member_fk"),
  ],
);

export const agencySettings = pgTable("agency_settings", {
  agencyId: uuid("agency_id")
    .primaryKey()
    .references(() => agencies.id, { onDelete: "cascade" }),
  values: jsonb("values").notNull().default({}),
  ...timestamps,
});

// One row per paid AI call (success or failure), for metering and rate limits.
export const aiUsage = pgTable(
  "ai_usage",
  {
    id: id(),
    agencyId: agencyId(),
    userId: uuid("user_id").notNull(),
    purpose: aiPurpose("purpose").notNull(),
    model: text("model").notNull(),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    webSearches: integer("web_searches").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    sameAgencyMember(t, t.userId, "ai_usage_user_member_fk"),
    index("ai_usage_agency_created_idx").on(t.agencyId, t.createdAt),
    index("ai_usage_agency_user_created_idx").on(t.agencyId, t.userId, t.createdAt),
  ],
);
