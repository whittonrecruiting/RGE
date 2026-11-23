import { notFound } from "next/navigation";
import { AppShell } from "@/components/shell/app-shell";
import { PageTitle } from "@/components/shell/page-title";
import { AddSources } from "@/components/mpc/AddSources";
import { ReviewPreview } from "./review-preview";
import { DraftBanner, FlagBadge, StatusBadge } from "@/components/mpc/badges";
import { ListFilters } from "@/components/mpc/list-filters";
import { MpcList } from "@/components/mpc/mpc-list";
import { PauseAll } from "@/components/mpc/pause-all";
import { ProfileForm } from "@/components/mpc/profile-form";
import { ProfileReadOnly } from "@/components/mpc/profile-readonly";
import { ComingNextSection, Section } from "@/components/mpc/section";
import type { MpcDetail, MpcRow } from "@/lib/mpc/queries";
import { mpcTitle } from "@/lib/mpc/schema";

// Renders the MPC screens with made-up data and no auth, for layout checks. Not available in production.
const LONG = "Senior Employment and Labor Litigation Associate with Class Action and Appellate Experience Nationwide";
const LONG_LOCATION = "Greater Phoenix Metropolitan Area including Scottsdale, Tempe, Mesa, Chandler, Gilbert and Glendale".slice(0, 90);

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
  {
    id: "c",
    ownerUserId: "u1",
    ownerName: "Sample Recruiter",
    ownerRemoved: false,
    status: "draft",
    headlineRole: null,
    location: LONG_LOCATION,
    yearsExperience: null,
    payTarget: null,
    consentOnFile: false,
    interviewOnlyCount: 0,
    missing: ["headlineRole", "years", "payTarget"],
  },
];

const draftDetail: MpcDetail = {
  id: "c",
  ownerUserId: "u1",
  ownerName: "Sample Recruiter",
  ownerRemoved: false,
  status: "draft",
  pauseReason: null,
  headlineRole: null,
  location: LONG_LOCATION,
  yearsExperience: null,
  seniority: null,
  specialtyTags: [],
  workMode: "any",
  employerType: "either",
  targetCities: [],
  payFloor: null,
  payFloorStrict: false,
  payTarget: null,
  overlapPriority: 0,
  createdAt: new Date(0),
  updatedAt: new Date(0),
};

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

const sampleDocs = [
  { id: "d1", kind: "resume" as const, filename: "jordan-example-resume-with-a-very-long-file-name-2026.pdf", createdAt: "2026-11-20T10:00:00.000Z" },
  { id: "d2", kind: "notes" as const, filename: "Pasted notes", createdAt: "2026-11-21T10:00:00.000Z" },
];

const sampleDraft = {
  fields: { yearsExperience: 8, specialtyTags: ["Commercial litigation", "Appeals"], workMode: "hybrid" as const },
  facts: [
    { text: "Led discovery on a $120M breach of contract matter", sourceKind: "resume" as const, sourceRef: "jordan-example-resume-with-a-very-long-file-name-2026.pdf", sourceQuote: "Led discovery on a $120M breach of contract matter" },
    { text: "Open to relocating to Denver", sourceKind: "notes" as const, sourceRef: "Pasted notes", sourceQuote: "Candidate wants to relocate to Denver within the year." },
  ],
  restrictionsSuggested: [{ kind: "never_say" as const, value: "Do not mention the Acme merger" }],
};

type Props = { searchParams: Promise<{ view?: string }> };

export default async function DevMpcsPage({ searchParams }: Props) {
  if (process.env.NODE_ENV === "production") notFound();
  const { view } = await searchParams;

  if (view === "detail" || view === "readonly" || view === "draft" || view === "draft-readonly") {
    const isDraft = view === "draft" || view === "draft-readonly";
    const mpc = isDraft ? draftDetail : detail;
    const editable = view === "detail" || view === "draft";
    return (
      <AppShell>
        <div className="flex min-w-0 flex-col gap-6">
          <div className="min-w-0 [overflow-wrap:anywhere]">
            <PageTitle>{mpcTitle(mpc.headlineRole)}</PageTitle>
          </div>
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <StatusBadge status={mpc.status} />
            {!isDraft && <FlagBadge>Owner removed</FlagBadge>}
            <span className="text-sm text-text-soft [overflow-wrap:anywhere]">
              {mpc.location ? `${mpc.location} · ` : ""}Owner: {mpc.ownerName}
            </span>
          </div>
          {isDraft && <DraftBanner />}
          <Section title="Profile">
            {editable ? (
              <ProfileForm
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
          <ComingNextSection title="Facts" />
          <Section title="Documents">
            <AddSources mpcId="a" documents={sampleDocs} />
            {view === "detail" && <ReviewPreview draft={sampleDraft} />}
          </Section>
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
