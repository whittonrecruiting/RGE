import type { Metadata } from "next";
import { CampaignSections } from "@/components/campaign/campaign-sections";
import { PageTitle } from "@/components/shell/page-title";
import { requireMember } from "@/lib/auth";
import { listInboxes } from "@/lib/inboxes/queries";
import { can } from "@/lib/permissions";
import { getSettings } from "@/lib/settings/get";
import { listSuppressions } from "@/lib/suppressions/queries";

export const metadata: Metadata = { title: "Campaign" };

type Props = { searchParams: Promise<{ q?: string | string[] }> };

export default async function CampaignPage({ searchParams }: Props) {
  const sp = await searchParams;
  const q = (typeof sp.q === "string" ? sp.q : "").trim().slice(0, 200);
  const member = await requireMember();
  const [settings, inboxes, optOuts] = await Promise.all([
    getSettings(member.agencyId),
    listInboxes(member),
    listSuppressions(member, q),
  ]);
  return (
    <div className="flex min-w-0 flex-col gap-6">
      <PageTitle>Campaign</PageTitle>
      <CampaignSections
        inboxes={inboxes}
        optOuts={optOuts}
        canAddOptOut={can(member, "suppression.add")}
        optOutQuery={q}
        timeZone={settings.timeZone}
      />
    </div>
  );
}
