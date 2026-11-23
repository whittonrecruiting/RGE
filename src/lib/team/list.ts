import { asc, eq } from "drizzle-orm";
import { memberships, users } from "@/db/schema";
import { withAgency } from "@/db/with-agency";
import type { Member } from "@/lib/auth";
import { can } from "@/lib/permissions";
import type { TeamPerson } from "@/components/settings/team-section";

const ROLE_ORDER = { owner: 0, admin: 1, recruiter: 2 } as const;

/** Active members of the caller's agency with what the caller may do to each. */
export async function listTeam(me: Member): Promise<TeamPerson[]> {
  const rows = await withAgency(me.agencyId, (tx) =>
    tx
      .select({
        membershipId: memberships.id,
        userId: memberships.userId,
        role: memberships.role,
        name: users.name,
        email: users.email,
      })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(eq(memberships.status, "active"))
      .orderBy(asc(users.name)),
  );
  return rows
    .map((r) => ({
      ...r,
      isMe: r.userId === me.userId,
      canSetRole: can(me, "team.setRole", { targetRole: r.role }),
      canRemove: r.userId !== me.userId && can(me, "team.remove", { targetRole: r.role }),
    }))
    .sort((a, b) => ROLE_ORDER[a.role] - ROLE_ORDER[b.role] || a.name.localeCompare(b.name));
}
