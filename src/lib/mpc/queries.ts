import { and, count, desc, eq, inArray, ne } from "drizzle-orm";
import { memberships, mpcConsents, mpcFacts, mpcs, users } from "@/db/schema";
import { withAgency } from "@/db/with-agency";
import type { Role, Member } from "@/lib/auth";
import type { MpcStatus } from "./schema";

export type MpcFilter = {
  owner: "me" | "all";
  /** Omitted: every status except removed. Pass 'removed' to see removed MPCs. */
  status?: MpcStatus;
};

/** Profile gaps, most important first. Only a draft can miss its headline role or location. */
export type Missing = "headlineRole" | "location" | "years" | "payTarget";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: unknown): v is string => typeof v === "string" && UUID.test(v);

// The owner's name and membership state come from the same agency's rows: the composite foreign
// key guarantees the membership exists, and row-level security keeps both sides in this agency.
const ownerColumns = {
  ownerName: users.name,
  ownerStatus: memberships.status,
};

const mpcColumns = {
  id: mpcs.id,
  ownerUserId: mpcs.ownerUserId,
  status: mpcs.status,
  pauseReason: mpcs.pauseReason,
  headlineRole: mpcs.headlineRole,
  location: mpcs.location,
  yearsExperience: mpcs.yearsExperience,
  seniority: mpcs.seniority,
  specialtyTags: mpcs.specialtyTags,
  workMode: mpcs.workMode,
  employerType: mpcs.employerType,
  targetCities: mpcs.targetCities,
  payFloor: mpcs.payFloor,
  payFloorStrict: mpcs.payFloorStrict,
  payTarget: mpcs.payTarget,
  overlapPriority: mpcs.overlapPriority,
  createdAt: mpcs.createdAt,
  updatedAt: mpcs.updatedAt,
};

export type MpcRow = {
  id: string;
  ownerUserId: string;
  ownerName: string;
  ownerRemoved: boolean;
  status: MpcStatus;
  /** Null only while the MPC is a draft. */
  headlineRole: string | null;
  location: string | null;
  yearsExperience: number | null;
  payTarget: number | null;
  consentOnFile: boolean;
  interviewOnlyCount: number;
  missing: Missing[];
};

/** MPCs of the member's agency with the flags the list needs. Row-level security scopes the agency. */
export async function listMpcs(member: Member, filter: MpcFilter): Promise<MpcRow[]> {
  return withAgency(member.agencyId, async (tx) => {
    const rows = await tx
      .select({ ...mpcColumns, ...ownerColumns })
      .from(mpcs)
      .innerJoin(
        memberships,
        and(eq(memberships.agencyId, mpcs.agencyId), eq(memberships.userId, mpcs.ownerUserId)),
      )
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(
        and(
          filter.owner === "me" ? eq(mpcs.ownerUserId, member.userId) : undefined,
          filter.status ? eq(mpcs.status, filter.status) : ne(mpcs.status, "removed"),
        ),
      )
      .orderBy(desc(mpcs.updatedAt), desc(mpcs.createdAt));
    if (rows.length === 0) return [];

    const ids = rows.map((r) => r.id);
    const consented = new Set(
      (await tx.select({ mpcId: mpcConsents.mpcId }).from(mpcConsents).where(inArray(mpcConsents.mpcId, ids))).map(
        (r) => r.mpcId,
      ),
    );
    const interviewOnly = new Map(
      (
        await tx
          .select({ mpcId: mpcFacts.mpcId, n: count() })
          .from(mpcFacts)
          .where(and(inArray(mpcFacts.mpcId, ids), eq(mpcFacts.status, "interview_only")))
          .groupBy(mpcFacts.mpcId)
      ).map((r) => [r.mpcId, r.n]),
    );

    return rows.map((r) => {
      const missing: Missing[] = [];
      if (r.headlineRole === null) missing.push("headlineRole");
      if (r.location === null) missing.push("location");
      if (r.yearsExperience === null) missing.push("years");
      if (r.payTarget === null) missing.push("payTarget");
      return {
        id: r.id,
        ownerUserId: r.ownerUserId,
        ownerName: r.ownerName,
        ownerRemoved: r.ownerStatus === "removed",
        status: r.status,
        headlineRole: r.headlineRole,
        location: r.location,
        yearsExperience: r.yearsExperience,
        payTarget: r.payTarget,
        consentOnFile: consented.has(r.id),
        interviewOnlyCount: interviewOnly.get(r.id) ?? 0,
        missing,
      };
    });
  });
}

export type MpcDetail = {
  id: string;
  ownerUserId: string;
  ownerName: string;
  ownerRemoved: boolean;
  status: MpcStatus;
  pauseReason: string | null;
  /** Null only while the MPC is a draft. */
  headlineRole: string | null;
  location: string | null;
  yearsExperience: number | null;
  seniority: string | null;
  specialtyTags: string[];
  workMode: "onsite" | "hybrid" | "remote" | "any";
  employerType: "inhouse" | "firm" | "either";
  targetCities: string[];
  payFloor: number | null;
  payFloorStrict: boolean;
  payTarget: number | null;
  overlapPriority: number;
  createdAt: Date;
  updatedAt: Date;
};

/** One MPC of the member's agency, or null when it does not exist (or belongs to another agency). */
export async function getMpc(member: Member, id: string): Promise<MpcDetail | null> {
  if (!isUuid(id)) return null;
  const [row] = await withAgency(member.agencyId, (tx) =>
    tx
      .select({ ...mpcColumns, ...ownerColumns })
      .from(mpcs)
      .innerJoin(
        memberships,
        and(eq(memberships.agencyId, mpcs.agencyId), eq(memberships.userId, mpcs.ownerUserId)),
      )
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(eq(mpcs.id, id)),
  );
  if (!row) return null;
  const { ownerStatus, ...rest } = row;
  return { ...rest, ownerRemoved: ownerStatus === "removed" } as MpcDetail;
}

export type TeamMemberOption = { userId: string; name: string; role: Role };

/** Active members of the agency, for choosing an MPC owner. */
export async function listActiveMembers(member: Member): Promise<TeamMemberOption[]> {
  const rows = await withAgency(member.agencyId, (tx) =>
    tx
      .select({ userId: memberships.userId, name: users.name, role: memberships.role })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(eq(memberships.status, "active")),
  );
  return rows.sort((a, b) => a.name.localeCompare(b.name));
}
