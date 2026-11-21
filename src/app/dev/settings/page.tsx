import { notFound } from "next/navigation";
import { AppShell } from "@/components/shell/app-shell";
import { PageTitle } from "@/components/shell/page-title";
import { SettingsForm } from "@/components/settings/settings-form";
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

type Props = { searchParams: Promise<{ view?: string }> };

export default async function DevSettingsPage({ searchParams }: Props) {
  if (process.env.NODE_ENV === "production") notFound();
  const { view } = await searchParams;
  return (
    <AppShell>
      <div className="flex min-w-0 flex-col gap-6">
        <PageTitle>Settings</PageTitle>
        <SettingsForm settings={sample} canEdit={view !== "readonly"} />
      </div>
    </AppShell>
  );
}
