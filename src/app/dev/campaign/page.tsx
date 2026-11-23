import { notFound } from "next/navigation";
import { CampaignSections } from "@/components/campaign/campaign-sections";
import { AppShell } from "@/components/shell/app-shell";
import { PageTitle } from "@/components/shell/page-title";

// Renders the Campaign page without auth, for layout checks. Not available in production.
export default function DevCampaignPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return (
    <AppShell>
      <div className="flex min-w-0 flex-col gap-6">
        <PageTitle>Campaign</PageTitle>
        <CampaignSections />
      </div>
    </AppShell>
  );
}
