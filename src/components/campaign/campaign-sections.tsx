import { Section } from "@/components/mpc/section";

const EMPTY = {
  health: "Research and sending start once inboxes are connected.",
  performance: "Pitch, follow-up and reply numbers appear here once outreach starts.",
  activity: "Every pitch and follow-up RGE sends will be listed here with its status.",
  optOuts: "People who opt out or bounce are listed here and never emailed again.",
  errors: "Anything that fails to send or research will show here with the reason.",
} as const;

function Empty({ children }: { children: string }) {
  return <p className="text-sm text-muted">{children}</p>;
}

/** Campaign tab: health strip, Performance, Activity, Opt-outs and bounces, Errors. Empty states until outreach exists. */
export function CampaignSections() {
  return (
    <div className="flex min-w-0 flex-col gap-6">
      <section aria-label="Campaign health" className="min-w-0 rounded border border-line bg-card p-4 md:p-6">
        <Empty>{EMPTY.health}</Empty>
      </section>
      <Section title="Performance">
        <Empty>{EMPTY.performance}</Empty>
      </Section>
      <Section title="Activity">
        <Empty>{EMPTY.activity}</Empty>
      </Section>
      <div id="opt-outs" className="scroll-mt-20 md:scroll-mt-6">
        <Section title="Opt-outs and bounces">
          <Empty>{EMPTY.optOuts}</Empty>
        </Section>
      </div>
      <Section title="Errors">
        <Empty>{EMPTY.errors}</Empty>
      </Section>
    </div>
  );
}
