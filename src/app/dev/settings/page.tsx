import { notFound } from "next/navigation";
import { AppShell } from "@/components/shell/app-shell";
import { PageTitle } from "@/components/shell/page-title";
import { SettingsForm } from "@/components/settings/settings-form";
import { InboxesSection, inboxNotice } from "@/components/settings/inboxes-section";
import type { InboxView } from "@/lib/inboxes/queries";
import { DncSection } from "@/components/settings/dnc-section";
import { ImportSection } from "@/components/settings/import-section";
import type { DncEntry } from "@/lib/dnc/queries";
import { TeamSection, type TeamPerson } from "@/components/settings/team-section";
import { DEFAULT_SETTINGS, type Settings } from "@/lib/settings-defaults";

// Renders the settings page with made-up data and no auth, for layout checks. Not available in production.
const firms = Array.from({ length: 60 }, (_, i) => `Sample Large Law Firm Number ${i + 1} LLP and Associates`);
firms.push("A".repeat(110));

const sample: Settings = {
  ...DEFAULT_SETTINGS,
  largeFirmList: firms,
  postalAddress:
    "1234 North Extraordinarily Long Boulevard Suite 5600, Building C, Phoenix, Arizona 85001, United States of America, c/o Registered Agent Services",
  averageFee: 24000,
  repeatWindowDays: 45,
};

const person = (n: number, role: TeamPerson["role"], name: string, email: string): TeamPerson => ({
  membershipId: `m${n}`,
  userId: `u${n}`,
  role,
  name,
  email,
  isMe: n === 1,
  canSetRole: role !== "owner",
  canRemove: n !== 1,
});

const people: TeamPerson[] = [
  person(
    1,
    "owner",
    "Sample Owner With A Very Long Display Name",
    "owner.with.a.very.long.address.for.layout.checks@example.test",
  ),
  person(2, "admin", "Sample Admin", "admin@example.test"),
  person(3, "recruiter", "Sample Recruiter", "recruiter@example.test"),
];

const okCheck = { ok: true, found: "v=ok", fix: null };
const base: InboxView = {
  id: "i1",
  email: "healthy.primary@example.com",
  ownerName: "Sample Owner",
  isMine: true,
  status: "connected",
  isPrimary: true,
  hasSignature: true,
  domainCheck: { spf: okCheck, dkim: okCheck, dmarc: okCheck },
  backfillFrom: new Date("2025-11-24T17:00:00Z"),
  backfillDoneAt: new Date("2025-11-25T17:00:00Z"),
  lastSyncedAt: new Date("2026-11-24T16:05:00Z"),
  lastSyncError: null,
  canManage: true,
};
const LONG_EMAIL = "a".repeat(67) + "@example.com"; // 80 characters, no break points
const inboxes: InboxView[] = [
  base,
  {
    ...base,
    id: "i2",
    email: "reconnect.needed@example.com",
    ownerName: "Sample Admin",
    isMine: true,
    status: "needs_reconnect",
    isPrimary: false,
    domainCheck: {
      spf: okCheck,
      dkim: {
        ok: false,
        found: null,
        fix: "Turn on DKIM signing in Google Admin (Apps > Google Workspace > Gmail > Authenticate email) and publish the record.",
      },
      dmarc: okCheck,
    },
    lastSyncError: "Google rejected the saved connection.",
  },
  { ...base, id: "i3", email: LONG_EMAIL, isPrimary: false },
  {
    ...base,
    id: "i5",
    email: "teammate.reconnect@example.com",
    ownerName: "Sample Teammate",
    isMine: false,
    status: "needs_reconnect",
    isPrimary: false,
  },
  {
    ...base,
    id: "i4",
    email: "importing@example.com",
    isPrimary: false,
    backfillDoneAt: null,
    lastSyncedAt: null,
  },
];

const dncEntries: DncEntry[] = [
  ...Array.from({ length: 30 }, (_, i): DncEntry => ({
    id: `d${i}`,
    name: `Sample Marketplace Client Number ${i + 1}`,
    domains: [`sample-client-${i + 1}.example.com`, `mail.sample-client-${i + 1}.example.org`],
    aliases: [`Sample Parent ${i + 1} Holdings`, `Sample Subsidiary ${i + 1}`],
    source: i % 2 === 0 ? "manual" : "csv",
  })),
  {
    id: "dlong",
    name: "B".repeat(100),
    domains: Array.from({ length: 14 }, (_, i) => `${"long-domain-".repeat(3)}${i + 1}.example.net`),
    aliases: ["C".repeat(90), ...Array.from({ length: 8 }, (_, i) => `Another Long Subsidiary Name Number ${i + 1}`)],
    source: "csv",
  },
];

const importPreview = {
  rows: 4321,
  newEvents: 4100,
  newSuppressions: 12,
  dncAdded: 3,
  dncMerged: 1,
  skipped: Array.from({ length: 25 }, (_, i) => ({
    line: i + 2,
    reason: i === 0 ? `status ${"x".repeat(100)} not imported` : "Date or time not recognized",
  })),
};

type Props = {
  searchParams: Promise<{
    view?: string;
    inbox?: string;
    inbox_error?: string;
  }>;
};

export default async function DevSettingsPage({ searchParams }: Props) {
  if (process.env.NODE_ENV === "production") notFound();
  const { view, inbox, inbox_error } = await searchParams;
  const readonly = view === "readonly";
  const shown = readonly ? people.map((p) => ({ ...p, canSetRole: false, canRemove: false })) : people;
  return (
    <AppShell>
      <div className="flex min-w-0 flex-col gap-6">
        <PageTitle>Settings</PageTitle>
        <InboxesSection
          inboxes={inboxes}
          canConnect
          notice={inboxNotice(inbox, inbox_error)}
          timeZone={sample.timeZone}
        />
        <TeamSection people={shown} canInvite={!readonly} />
        <DncSection entries={dncEntries} canEdit={!readonly} />
        {!readonly && <ImportSection initial={{ mode: "preview", summary: importPreview }} />}
        <SettingsForm settings={sample} canEdit={!readonly} />
      </div>
    </AppShell>
  );
}
