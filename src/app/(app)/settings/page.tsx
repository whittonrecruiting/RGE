import type { Metadata } from "next";
import { PageTitle } from "@/components/shell/page-title";
import { SettingsForm } from "@/components/settings/settings-form";
import { TeamSection } from "@/components/settings/team-section";
import { requireMember } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { getSettings } from "@/lib/settings/get";
import { listTeam } from "@/lib/team/list";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage() {
  const member = await requireMember();
  const [settings, people] = await Promise.all([getSettings(member.agencyId), listTeam(member)]);
  return (
    <div className="flex min-w-0 flex-col gap-6">
      <PageTitle>Settings</PageTitle>
      <TeamSection people={people} canInvite={can(member, "team.manage")} />
      <SettingsForm settings={settings} canEdit={can(member, "settings.edit")} />
    </div>
  );
}
