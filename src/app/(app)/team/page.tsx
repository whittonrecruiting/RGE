import type { Metadata } from "next";
import { asc, eq } from "drizzle-orm";
import { memberships, users } from "@/db/schema";
import { withAgency } from "@/db/with-agency";
import { PageTitle } from "@/components/shell/page-title";
import { requireMember, type Role } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { InviteForm, MemberActions } from "./team-controls";

export const metadata: Metadata = { title: "Team" };

const ROLE_LABEL: Record<Role, string> = { owner: "Owner", admin: "Admin", recruiter: "Recruiter" };
const ROLE_ORDER: Record<Role, number> = { owner: 0, admin: 1, recruiter: 2 };

function RoleBadge({ role }: { role: Role }) {
  const tone = role === "owner" ? "border-gold text-gold" : "border-line text-text-soft";
  return (
    <span className={`inline-block rounded-full border px-2.5 py-0.5 text-xs font-semibold ${tone}`}>
      {ROLE_LABEL[role]}
    </span>
  );
}

export default async function TeamPage() {
  const me = await requireMember();
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
  const people = rows
    .map((r) => ({
      ...r,
      isMe: r.userId === me.userId,
      canSetRole: can(me, "team.setRole", { targetRole: r.role }),
      canRemove: r.userId !== me.userId && can(me, "team.remove", { targetRole: r.role }),
    }))
    .sort((a, b) => ROLE_ORDER[a.role] - ROLE_ORDER[b.role] || a.name.localeCompare(b.name));

  const actions = (p: (typeof people)[number]) => (
    <MemberActions
      membershipId={p.membershipId}
      name={p.name}
      role={p.role}
      canSetRole={p.canSetRole}
      canRemove={p.canRemove}
    />
  );

  return (
    <div className="flex flex-col gap-6">
      <PageTitle>Team</PageTitle>
      {can(me, "team.manage") && <InviteForm />}

      {/* Phone: stacked cards */}
      <ul className="flex flex-col gap-3 md:hidden">
        {people.map((p) => (
          <li key={p.membershipId} className="rounded border border-line bg-card p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-text">
                  {p.name}
                  {p.isMe && <span className="ml-2 text-xs font-normal text-muted">You</span>}
                </p>
                <p className="truncate text-sm text-text-soft">{p.email}</p>
              </div>
              <RoleBadge role={p.role} />
            </div>
            {(p.canSetRole || p.canRemove) && <div className="mt-3">{actions(p)}</div>}
          </li>
        ))}
      </ul>

      {/* Desktop: table */}
      <div className="hidden overflow-hidden rounded border border-line md:block">
        <table className="w-full text-left text-sm">
          <thead className="bg-surface text-xs uppercase tracking-[0.14em] text-muted">
            <tr>
              <th className="px-4 py-3 font-semibold">Name</th>
              <th className="px-4 py-3 font-semibold">Email</th>
              <th className="px-4 py-3 font-semibold">Role</th>
              <th className="px-4 py-3 font-semibold">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line bg-card">
            {people.map((p) => (
              <tr key={p.membershipId}>
                <td className="px-4 py-3 font-semibold text-text">
                  {p.name}
                  {p.isMe && <span className="ml-2 text-xs font-normal text-muted">You</span>}
                </td>
                <td className="px-4 py-3 text-text-soft">{p.email}</td>
                <td className="px-4 py-3">
                  <RoleBadge role={p.role} />
                </td>
                <td className="px-4 py-3">{actions(p)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
