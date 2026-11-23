import type { Metadata } from "next";
import { CampaignSections } from "@/components/campaign/campaign-sections";
import { PageTitle } from "@/components/shell/page-title";
import { requireMember } from "@/lib/auth";

export const metadata: Metadata = { title: "Campaign" };

export default async function CampaignPage() {
  await requireMember();
  return (
    <div className="flex min-w-0 flex-col gap-6">
      <PageTitle>Campaign</PageTitle>
      <CampaignSections />
    </div>
  );
}
