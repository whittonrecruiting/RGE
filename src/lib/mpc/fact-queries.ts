import { asc, desc, eq } from "drizzle-orm";
import { mpcConsents, mpcCredentials, mpcRestrictions, users } from "@/db/schema";
import { withAgency } from "@/db/with-agency";
import type { Member } from "@/lib/auth";
import { isUuid } from "./queries";

export type RestrictionKind = "never_say" | "confidential" | "excluded_company" | "region_exclusion";
export type RestrictionRow = { id: string; kind: RestrictionKind; value: string };
export type CredentialRow = { id: string; kind: string; region: string | null; verified: boolean };
export type ConsentMethod = "verbal" | "email" | "signed_form";
export type ConsentRow = {
  id: string;
  givenOn: string;
  method: ConsentMethod;
  recordedBy: string;
  recordedByName: string;
  hasProof: boolean;
  createdAt: Date;
};

export async function listRestrictions(member: Member, mpcId: string): Promise<RestrictionRow[]> {
  if (!isUuid(mpcId)) return [];
  return withAgency(member.agencyId, (tx) =>
    tx
      .select({ id: mpcRestrictions.id, kind: mpcRestrictions.kind, value: mpcRestrictions.value })
      .from(mpcRestrictions)
      .where(eq(mpcRestrictions.mpcId, mpcId))
      .orderBy(asc(mpcRestrictions.createdAt), asc(mpcRestrictions.id)),
  );
}

export async function listCredentials(member: Member, mpcId: string): Promise<CredentialRow[]> {
  if (!isUuid(mpcId)) return [];
  return withAgency(member.agencyId, (tx) =>
    tx
      .select({ id: mpcCredentials.id, kind: mpcCredentials.kind, region: mpcCredentials.region, verified: mpcCredentials.verified })
      .from(mpcCredentials)
      .where(eq(mpcCredentials.mpcId, mpcId))
      .orderBy(asc(mpcCredentials.createdAt), asc(mpcCredentials.id)),
  );
}

/** Consent history for one MPC, latest recorded first. */
export async function listConsents(member: Member, mpcId: string): Promise<ConsentRow[]> {
  if (!isUuid(mpcId)) return [];
  const rows = await withAgency(member.agencyId, (tx) =>
    tx
      .select({
        id: mpcConsents.id,
        givenOn: mpcConsents.givenOn,
        method: mpcConsents.method,
        recordedBy: mpcConsents.recordedBy,
        recordedByName: users.name,
        proofBlobUrl: mpcConsents.proofBlobUrl,
        createdAt: mpcConsents.createdAt,
      })
      .from(mpcConsents)
      .innerJoin(users, eq(users.id, mpcConsents.recordedBy))
      .where(eq(mpcConsents.mpcId, mpcId))
      .orderBy(desc(mpcConsents.createdAt), desc(mpcConsents.id)),
  );
  return rows.map(({ proofBlobUrl, ...r }) => ({ ...r, hasProof: proofBlobUrl !== null }));
}
