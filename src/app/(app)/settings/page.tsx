import type { Metadata } from "next";
import { PageTitle } from "@/components/shell/page-title";
import { SettingsForm } from "@/components/settings/settings-form";
import { requireMember } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { getSettings } from "@/lib/settings/get";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage() {
  const member = await requireMember();
  const settings = await getSettings(member.agencyId);
  return (
    <div className="flex min-w-0 flex-col gap-6">
      <PageTitle>Settings</PageTitle>
      <SettingsForm settings={settings} canEdit={can(member, "settings.edit")} />
    </div>
  );
}
