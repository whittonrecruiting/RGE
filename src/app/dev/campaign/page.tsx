import { notFound } from "next/navigation";
import { CampaignSections } from "@/components/campaign/campaign-sections";
import { AppShell } from "@/components/shell/app-shell";
import { PageTitle } from "@/components/shell/page-title";
import type { InboxView } from "@/lib/inboxes/queries";
import type { SuppressionRow } from "@/lib/suppressions/queries";

// Renders the Campaign page without auth, for layout checks. Not available in production.
// ?view=empty shows the empty states; ?q= filters the sample list the way the real page does.
const base: InboxView = {
  id: "i1",
  email: "healthy.primary@example.com",
  ownerName: "Sample Owner",
  isMine: true,
  status: "connected",
  isPrimary: true,
  hasSignature: true,
  domainCheck: null,
  backfillFrom: new Date("2025-11-24T17:00:00Z"),
  backfillDoneAt: new Date("2025-11-25T17:00:00Z"),
  lastSyncedAt: new Date("2026-11-24T16:05:00Z"),
  lastSyncError: null,
  canManage: true,
};
const inboxes: InboxView[] = [
  base,
  { ...base, id: "i2", email: "reconnect.needed@example.com", status: "needs_reconnect", isPrimary: false },
  { ...base, id: "i3", email: "importing@example.com", isPrimary: false, backfillDoneAt: null },
];

const REASONS: SuppressionRow["reason"][] = ["opted_out", "bounced", "manual"];
const optOuts: SuppressionRow[] = [
  ...Array.from({ length: 40 }, (_, i): SuppressionRow => ({
    email: `sample.person.${i + 1}@example.com`,
    reason: REASONS[i % 3]!,
    source: i % 3 === 2 ? "manual" : "gmail",
    createdAt: new Date(Date.UTC(2026, 10, 24 - (i % 20), 17, 0, 0)),
  })),
  {
    email: "x".repeat(70) + "@" + "y".repeat(40) + ".example.org",
    reason: "bounced",
    source: "gmail",
    createdAt: new Date("2026-11-01T17:00:00Z"),
  },
];

type Props = { searchParams: Promise<{ view?: string; q?: string }> };

export default async function DevCampaignPage({ searchParams }: Props) {
  if (process.env.NODE_ENV === "production") notFound();
  const { view, q } = await searchParams;
  const empty = view === "empty";
  const query = (q ?? "").trim();
  const shown = empty ? [] : optOuts.filter((r) => r.email.toLowerCase().includes(query.toLowerCase()));
  return (
    <AppShell>
      <div className="flex min-w-0 flex-col gap-6">
        <PageTitle>Campaign</PageTitle>
        <CampaignSections
          inboxes={empty ? [] : inboxes}
          optOuts={shown}
          canAddOptOut
          optOutQuery={query}
          timeZone="America/Phoenix"
        />
      </div>
    </AppShell>
  );
}
