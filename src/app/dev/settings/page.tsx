import { notFound } from "next/navigation";
import { AppShell } from "@/components/shell/app-shell";
import { PageTitle } from "@/components/shell/page-title";
import { SettingsForm } from "@/components/settings/settings-form";
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
  person(1, "owner", "Sample Owner With A Very Long Display Name", "owner.with.a.very.long.address.for.layout.checks@example.test"),
  person(2, "admin", "Sample Admin", "admin@example.test"),
  person(3, "recruiter", "Sample Recruiter", "recruiter@example.test"),
];

type Props = { searchParams: Promise<{ view?: string }> };

export default async function DevSettingsPage({ searchParams }: Props) {
  if (process.env.NODE_ENV === "production") notFound();
  const { view } = await searchParams;
  const readonly = view === "readonly";
  const shown = readonly ? people.map((p) => ({ ...p, canSetRole: false, canRemove: false })) : people;
  return (
    <AppShell>
      <div className="flex min-w-0 flex-col gap-6">
        <PageTitle>Settings</PageTitle>
        <TeamSection people={shown} canInvite={!readonly} />
        <SettingsForm settings={sample} canEdit={!readonly} />
      </div>
    </AppShell>
  );
}
