import type { Metadata } from "next";
import Link from "next/link";
import { PageTitle } from "@/components/shell/page-title";
import { ProfileForm } from "@/components/mpc/profile-form";
import { Section } from "@/components/mpc/section";
import { requireMember } from "@/lib/auth";

export const metadata: Metadata = { title: "Add MPC" };

export default async function NewMpcPage() {
  await requireMember();
  return (
    <div className="flex min-w-0 flex-col gap-6">
      <div>
        <Link href="/mpcs" className="text-xs font-semibold uppercase tracking-[0.14em] text-text-soft hover:text-gold">
          Back to MPCs
        </Link>
        <div className="mt-2">
          <PageTitle>Add MPC</PageTitle>
        </div>
      </div>
      <Section title="Profile">
        <ProfileForm />
      </Section>
    </div>
  );
}
