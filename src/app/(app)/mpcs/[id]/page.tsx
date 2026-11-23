import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AddSources, DocumentList } from "@/components/mpc/AddSources";
import { BuildReview } from "@/components/mpc/BuildReview";
import { StatusBadge } from "@/components/mpc/badges";
import { ConsentCard } from "@/components/mpc/ConsentCard";
import { FactList } from "@/components/mpc/FactList";
import { FindMore } from "@/components/mpc/FindMore";
import { SamplePitch } from "@/components/mpc/SamplePitch";
import { CredentialsEditor, RestrictionsEditor } from "@/components/mpc/RestrictionsEditor";
import { ProfileForm } from "@/components/mpc/profile-form";
import { ProfileReadOnly } from "@/components/mpc/profile-readonly";
import { ReassignControl } from "@/components/mpc/reassign-control";
import { Section } from "@/components/mpc/section";
import { StatusControls } from "@/components/mpc/status-controls";
import { DraftBanner, FlagBadge, PitchReadyBadge } from "@/components/mpc/badges";
import { PageTitle } from "@/components/shell/page-title";
import { requireMember } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { listDocuments, listFacts } from "@/lib/mpc/document-queries";
import { listConsents, listCredentials, listRestrictions } from "@/lib/mpc/fact-queries";
import { getMpc, getPitchReadiness, listActiveMembers, listSavedBullets } from "@/lib/mpc/queries";
import { strongFactsMessage } from "@/lib/mpc/pitch-guard";
import { mpcTitle } from "@/lib/mpc/schema";

export const metadata: Metadata = { title: "MPC" };

type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ review?: string }> };

export default async function MpcPage({ params, searchParams }: Props) {
  const member = await requireMember();
  const { id } = await params;
  const { review } = await searchParams;
  const mpc = await getMpc(member, id);
  if (!mpc) notFound();

  const canEdit = can(member, "mpc.edit", { ownerUserId: mpc.ownerUserId });
  const canReassign = can(member, "team.manage");
  const members = canReassign ? await listActiveMembers(member) : [];
  const [documents, facts, restrictions, credentials, consents, readiness, savedBullets] = await Promise.all([
    listDocuments(member, mpc.id),
    listFacts(member, mpc.id),
    listRestrictions(member, mpc.id),
    listCredentials(member, mpc.id),
    listConsents(member, mpc.id),
    getPitchReadiness(member, mpc.id),
    listSavedBullets(member, mpc.id),
  ]);
  const isDraft = mpc.status === "draft";
  const factItems = facts.map((f) => ({
    id: f.id,
    text: f.text,
    sourceKind: f.sourceKind,
    sourceRef: f.sourceRef,
    status: f.status,
    edited: f.editedAt !== null,
  }));
  const latestConsent = consents[0]
    ? {
        id: consents[0].id,
        givenOn: consents[0].givenOn,
        method: consents[0].method,
        recordedByName: consents[0].recordedByName,
        hasProof: consents[0].hasProof,
      }
    : null;
  const documentItems = documents.map((d) => ({
    id: d.id,
    kind: d.kind,
    filename: d.filename,
    createdAt: d.createdAt.toISOString(),
  }));

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <div className="min-w-0">
        <Link href="/mpcs" className="text-xs font-semibold uppercase tracking-[0.14em] text-text-soft hover:text-gold">
          Back to MPCs
        </Link>
        <div className="mt-2 [overflow-wrap:anywhere]">
          <PageTitle>{mpcTitle(mpc.headlineRole)}</PageTitle>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <StatusBadge status={mpc.status} />
          {!isDraft && <PitchReadyBadge ready={readiness.pitchReady} />}
          {mpc.ownerRemoved && <FlagBadge>Owner removed</FlagBadge>}
          <span className="text-sm text-text-soft [overflow-wrap:anywhere]">
            {mpc.location ? `${mpc.location} · ` : ""}Owner: {mpc.ownerName}
          </span>
        </div>
        {mpc.status === "paused" && mpc.pauseReason && (
          <p className="mt-2 text-sm text-text-soft [overflow-wrap:anywhere]">Paused: {mpc.pauseReason}</p>
        )}
      </div>

      {isDraft && <DraftBanner />}

      {/* Straight after Build profile: read the documents and open the review here, at the top. Always
          mounted for editors so a later revalidation (no ?review) cannot close an open review. */}
      {canEdit && <BuildReview key={mpc.id} mpcId={mpc.id} autoStart={review === "1" && documents.length > 0} />}

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
            draft={isDraft}
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

      <Section title="Facts">
        <FactList mpcId={mpc.id} canEdit={canEdit} facts={factItems} />
        {canEdit && (
          <div className="mt-4">
            <FindMore mpcId={mpc.id} />
          </div>
        )}
      </Section>
      <Section title="Sample pitch">
        <SamplePitch
          mpcId={mpc.id}
          canEdit={canEdit}
          isDraft={isDraft}
          pitchReady={readiness.pitchReady}
          reason={readiness.pitchReady ? null : strongFactsMessage(readiness.strongFactCount)}
          saved={savedBullets}
        />
      </Section>
      <Section title="Restrictions">
        <RestrictionsEditor
          key={restrictions.map((r) => r.id).join(",")}
          mpcId={mpc.id}
          canEdit={canEdit}
          restrictions={restrictions.map((r) => ({ kind: r.kind, value: r.value }))}
        />
      </Section>
      <Section title="Credentials">
        <CredentialsEditor
          key={credentials.map((c) => c.id).join(",")}
          mpcId={mpc.id}
          canEdit={canEdit}
          credentials={credentials.map((c) => ({ kind: c.kind, region: c.region ?? "", verified: c.verified }))}
        />
      </Section>
      <Section title="Consent">
        <ConsentCard mpcId={mpc.id} canEdit={canEdit} latest={latestConsent} />
      </Section>
      <Section title="Documents">
        {canEdit ? (
          <AddSources mpcId={mpc.id} documents={documentItems} />
        ) : (
          <DocumentList documents={documentItems} />
        )}
      </Section>
    </div>
  );
}
