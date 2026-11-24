import { Section } from "@/components/mpc/section";
import type { InboxView } from "@/lib/inboxes/queries";
import type { SuppressionRow } from "@/lib/suppressions/queries";
import { HealthStrip } from "./health-strip";
import { OptOuts } from "./opt-outs";

const EMPTY = {
  performance: "Pitch, follow-up and reply numbers appear here once outreach starts.",
  activity: "Every pitch and follow-up RGE sends will be listed here with its status.",
  errors: "Anything that fails to send or research will show here with the reason.",
} as const;

function Empty({ children }: { children: string }) {
  return <p className="text-sm text-muted">{children}</p>;
}

type Props = {
  inboxes: InboxView[];
  optOuts: SuppressionRow[];
  canAddOptOut: boolean;
  /** The current ?q= search, already trimmed. */
  optOutQuery?: string;
  timeZone: string;
};

/** Campaign tab: health strip, Performance, Activity, Opt-outs and bounces, Errors. */
export function CampaignSections({ inboxes, optOuts, canAddOptOut, optOutQuery = "", timeZone }: Props) {
  return (
    <div className="flex min-w-0 flex-col gap-6">
      <HealthStrip inboxes={inboxes} />
      <Section title="Performance">
        <Empty>{EMPTY.performance}</Empty>
      </Section>
      <Section title="Activity">
        <Empty>{EMPTY.activity}</Empty>
      </Section>
      <OptOuts rows={optOuts} query={optOutQuery} canAdd={canAddOptOut} timeZone={timeZone} />
      <Section title="Errors">
        <Empty>{EMPTY.errors}</Empty>
      </Section>
    </div>
  );
}
