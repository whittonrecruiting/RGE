import { notFound } from "next/navigation";
import { AppShell } from "@/components/shell/app-shell";
import { PageTitle } from "@/components/shell/page-title";
import { BuildProfile } from "@/components/mpc/BuildProfile";
import { Section } from "@/components/mpc/section";
import { ReviewFailurePreview } from "./review-failure";

// Renders the Add MPC screen with no auth, for layout checks. Not available in production.
// ?review=fail shows the step after Build profile when the extraction is rate limited.
type Props = { searchParams: Promise<{ review?: string }> };

export default async function Page({ searchParams }: Props) {
  if (process.env.NODE_ENV === "production") notFound();
  const { review } = await searchParams;
  return (
    <AppShell>
      <div className="flex min-w-0 flex-col gap-6">
        <PageTitle>Add MPC</PageTitle>
        {review === "fail" ? (
          <ReviewFailurePreview />
        ) : (
          <Section title="Start from documents">
            <BuildProfile />
          </Section>
        )}
      </div>
    </AppShell>
  );
}
