import { notFound } from "next/navigation";
import { AppShell } from "@/components/shell/app-shell";
import { PageTitle } from "@/components/shell/page-title";
import { BuildProfile } from "@/components/mpc/BuildProfile";
import { Section } from "@/components/mpc/section";

// Renders the Add MPC screen with no auth, for layout checks. Not available in production.
// The step after Build profile has its own fixture: /dev/build-review.
export default async function Page() {
  if (process.env.NODE_ENV === "production") notFound();
  return (
    <AppShell>
      <div className="flex min-w-0 flex-col gap-6">
        <PageTitle>Add MPC</PageTitle>
        <Section title="Start from documents">
          <BuildProfile />
        </Section>
      </div>
    </AppShell>
  );
}
