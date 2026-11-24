import type { Metadata } from "next";
import { PageTitle } from "@/components/shell/page-title";
import { SettingsForm } from "@/components/settings/settings-form";
import { InboxesSection, inboxNotice } from "@/components/settings/inboxes-section";
import { DncSection } from "@/components/settings/dnc-section";
import { TeamSection } from "@/components/settings/team-section";
import { requireMember } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { getSettings } from "@/lib/settings/get";
import { listDnc } from "@/lib/dnc/queries";
import { listInboxes } from "@/lib/inboxes/queries";
import { listTeam } from "@/lib/team/list";

export const metadata: Metadata = { title: "Settings" };

type Props = {
  searchParams: Promise<{ inbox?: string; inbox_error?: string }>;
};

export default async function SettingsPage({ searchParams }: Props) {
  const sp = await searchParams;
  const member = await requireMember();
  const [settings, people, inboxes, dnc] = await Promise.all([
    getSettings(member.agencyId),
    listTeam(member),
    listInboxes(member),
    listDnc(member),
  ]);
  return (
    <div className="flex min-w-0 flex-col gap-6">
      <PageTitle>Settings</PageTitle>
      <InboxesSection
        inboxes={inboxes}
        canConnect={can(member, "inbox.connect")}
        notice={inboxNotice(sp.inbox, sp.inbox_error)}
        timeZone={settings.timeZone}
      />
      <TeamSection people={people} canInvite={can(member, "team.manage")} />
      <DncSection entries={dnc} canEdit={can(member, "dnc.edit")} />
      <SettingsForm settings={settings} canEdit={can(member, "settings.edit")} />
    </div>
  );
}
