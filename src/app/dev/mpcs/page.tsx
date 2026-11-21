import { notFound } from "next/navigation";
import { AppShell } from "@/components/shell/app-shell";
import { PageTitle } from "@/components/shell/page-title";
import { FlagBadge, StatusBadge } from "@/components/mpc/badges";
import { ListFilters } from "@/components/mpc/list-filters";
import { MpcList } from "@/components/mpc/mpc-list";
import { PauseAll } from "@/components/mpc/pause-all";
import { ProfileForm } from "@/components/mpc/profile-form";
import { ProfileReadOnly } from "@/components/mpc/profile-readonly";
import { ComingNextSection, Section } from "@/components/mpc/section";
import type { MpcDetail, MpcRow } from "@/lib/mpc/queries";

// Renders the MPC screens with made-up data and no auth, for layout checks. Not available in production.
const LONG = "Senior Employment and Labor Litigation Associate with Class Action and Appellate Experience Nationwide";

const rows: MpcRow[] = [
  {
    id: "a",
    ownerUserId: "u1",
    ownerName: "Sample Recruiter",
    ownerRemoved: false,
    status: "active",
    headlineRole: LONG.slice(0, 90),
    location: "Phoenix, AZ",
    yearsExperience: null,
    payTarget: null,
    consentOnFile: false,
    interviewOnlyCount: 3,
    missing: ["years", "payTarget"],
  },
  {
    id: "b",
    ownerUserId: "u2",
    ownerName: "Another Teammate",
    ownerRemoved: true,
    status: "paused",
    headlineRole: "Litigation Associate",
    location: "Scottsdale, AZ",
    yearsExperience: 6,
    payTarget: 175000,
    consentOnFile: true,
    interviewOnlyCount: 0,
    missing: [],
  },
];

const detail: MpcDetail = {
  id: "a",
  ownerUserId: "u1",
  ownerName: "Sample Recruiter",
  ownerRemoved: false,
  status: "active",
  pauseReason: null,
  headlineRole: LONG.slice(0, 90),
  location: "Phoenix, AZ",
  yearsExperience: 9,
  seniority: "Senior",
  specialtyTags: ["Employment", "Litigation"],
  workMode: "hybrid",
  employerType: "firm",
  targetCities: ["Phoenix", "Tucson"],
  payFloor: 150000,
  payFloorStrict: true,
  payTarget: 185000,
  overlapPriority: 2,
  createdAt: new Date(0),
  updatedAt: new Date(0),
};

type Props = { searchParams: Promise<{ view?: string }> };

export default async function DevMpcsPage({ searchParams }: Props) {
  if (process.env.NODE_ENV === "production") notFound();
  const { view } = await searchParams;

  if (view === "detail" || view === "readonly") {
    return (
      <AppShell>
        <div className="flex min-w-0 flex-col gap-6">
          <div className="min-w-0 [overflow-wrap:anywhere]">
            <PageTitle>{detail.headlineRole}</PageTitle>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status="active" />
            <FlagBadge>Owner removed</FlagBadge>
          </div>
          <Section title="Profile">
            {view === "detail" ? (
              <ProfileForm
                mpcId={detail.id}
                initial={{
                  headlineRole: detail.headlineRole,
                  location: detail.location,
                  yearsExperience: detail.yearsExperience,
                  seniority: detail.seniority,
                  specialtyTags: detail.specialtyTags,
                  workMode: detail.workMode,
                  employerType: detail.employerType,
                  targetCities: detail.targetCities,
                  payFloor: detail.payFloor,
                  payFloorStrict: detail.payFloorStrict,
                  payTarget: detail.payTarget,
                  overlapPriority: detail.overlapPriority,
                }}
              />
            ) : (
              <ProfileReadOnly mpc={detail} />
            )}
          </Section>
          <ComingNextSection title="Facts" />
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="flex min-w-0 flex-col gap-6">
        <div>
          <PageTitle>MPCs</PageTitle>
          <p className="mt-2 text-sm text-text-soft">{rows.length} MPCs</p>
        </div>
        <ListFilters owner="all" status={undefined} />
        <PauseAll canPauseAgency />
        <MpcList rows={rows} showOwner />
      </div>
    </AppShell>
  );
}
