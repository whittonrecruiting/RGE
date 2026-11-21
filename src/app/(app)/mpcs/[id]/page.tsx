import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { StatusBadge } from "@/components/mpc/badges";
import { ProfileForm } from "@/components/mpc/profile-form";
import { ProfileReadOnly } from "@/components/mpc/profile-readonly";
import { ReassignControl } from "@/components/mpc/reassign-control";
import { ComingNextSection, Section } from "@/components/mpc/section";
import { StatusControls } from "@/components/mpc/status-controls";
import { FlagBadge } from "@/components/mpc/badges";
import { PageTitle } from "@/components/shell/page-title";
import { requireMember } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { getMpc, listActiveMembers } from "@/lib/mpc/queries";

export const metadata: Metadata = { title: "MPC" };

type Props = { params: Promise<{ id: string }> };

export default async function MpcPage({ params }: Props) {
  const member = await requireMember();
  const { id } = await params;
  const mpc = await getMpc(member, id);
  if (!mpc) notFound();

  const canEdit = can(member, "mpc.edit", { ownerUserId: mpc.ownerUserId });
  const canReassign = can(member, "team.manage");
  const members = canReassign ? await listActiveMembers(member) : [];

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <div className="min-w-0">
        <Link href="/mpcs" className="text-xs font-semibold uppercase tracking-[0.14em] text-text-soft hover:text-gold">
          Back to MPCs
        </Link>
        <div className="mt-2 [overflow-wrap:anywhere]">
          <PageTitle>{mpc.headlineRole}</PageTitle>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <StatusBadge status={mpc.status} />
          {mpc.ownerRemoved && <FlagBadge>Owner removed</FlagBadge>}
          <span className="text-sm text-text-soft [overflow-wrap:anywhere]">
            {mpc.location} · Owner: {mpc.ownerName}
          </span>
        </div>
        {mpc.status === "paused" && mpc.pauseReason && (
          <p className="mt-2 text-sm text-text-soft [overflow-wrap:anywhere]">Paused: {mpc.pauseReason}</p>
        )}
      </div>

      {!canEdit && (
        <p className="rounded border border-line bg-card p-4 text-sm text-text-soft">
          This MPC belongs to {mpc.ownerName}. You can view it but only the owner, an Admin or the Owner can edit it.
        </p>
      )}

      <Section title="Profile">
        {canEdit ? (
          <ProfileForm
            key={mpc.updatedAt.toISOString()}
            mpcId={mpc.id}
            initial={{
              headlineRole: mpc.headlineRole,
              location: mpc.location,
              yearsExperience: mpc.yearsExperience,
              seniority: mpc.seniority,
              specialtyTags: mpc.specialtyTags,
              workMode: mpc.workMode,
              employerType: mpc.employerType,
              targetCities: mpc.targetCities,
              payFloor: mpc.payFloor,
              payFloorStrict: mpc.payFloorStrict,
              payTarget: mpc.payTarget,
              overlapPriority: mpc.overlapPriority,
            }}
          />
        ) : (
          <ProfileReadOnly mpc={mpc} />
        )}
      </Section>

      {canEdit && (
        <Section title="Status">
          <StatusControls mpcId={mpc.id} status={mpc.status} />
        </Section>
      )}

      {canReassign && (
        <Section title="Owner">
          <ReassignControl
            key={mpc.ownerUserId}
            mpcId={mpc.id}
            ownerUserId={mpc.ownerUserId}
            members={members.map((m) => ({ userId: m.userId, name: m.name }))}
          />
        </Section>
      )}

      <ComingNextSection title="Facts" />
      <ComingNextSection title="Restrictions" />
      <ComingNextSection title="Credentials" />
      <ComingNextSection title="Consent" />
      <ComingNextSection title="Documents" />
    </div>
  );
}
