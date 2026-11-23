import { Section } from "@/components/mpc/section";
import type { Role } from "@/lib/auth";
import { InviteForm, MemberActions } from "./team-controls";

export type TeamPerson = {
  membershipId: string;
  userId: string;
  role: Role;
  name: string;
  email: string;
  isMe: boolean;
  canSetRole: boolean;
  canRemove: boolean;
};

const ROLE_LABEL: Record<Role, string> = { owner: "Owner", admin: "Admin", recruiter: "Recruiter" };

function RoleBadge({ role }: { role: Role }) {
  const tone = role === "owner" ? "border-gold text-gold" : "border-line text-text-soft";
  return (
    <span className={`inline-block rounded-full border px-2.5 py-0.5 text-xs font-semibold ${tone}`}>
      {ROLE_LABEL[role]}
    </span>
  );
}

/** Team list inside Settings. Recruiters see it read-only: canInvite and the per-row flags come from can(). */
export function TeamSection({ people, canInvite }: { people: TeamPerson[]; canInvite: boolean }) {
  const actions = (p: TeamPerson) => (
    <MemberActions
      membershipId={p.membershipId}
      name={p.name}
      role={p.role}
      canSetRole={p.canSetRole}
      canRemove={p.canRemove}
    />
  );

  return (
    <div id="team" className="scroll-mt-20 md:scroll-mt-6">
      <Section title="Team">
        {canInvite && <InviteForm />}

        {/* Phone: stacked cards */}
        <ul className="flex flex-col gap-3 md:hidden">
          {people.map((p) => (
            <li key={p.membershipId} className="rounded border border-line bg-surface p-4">
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
          <table className="w-full table-fixed text-left text-sm">
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
                  <td className="px-4 py-3 font-semibold text-text [overflow-wrap:anywhere]">
                    {p.name}
                    {p.isMe && <span className="ml-2 text-xs font-normal text-muted">You</span>}
                  </td>
                  <td className="px-4 py-3 text-text-soft [overflow-wrap:anywhere]">{p.email}</td>
                  <td className="px-4 py-3">
                    <RoleBadge role={p.role} />
                  </td>
                  <td className="px-4 py-3">{actions(p)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
    </div>
  );
}
