import Link from "next/link";
import type { InboxView } from "@/lib/inboxes/queries";

const EMPTY = "Research and sending start once inboxes are connected.";

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

function Pill({ tone, children }: { tone: string; children: React.ReactNode }) {
  return (
    <span className={`inline-block rounded-full border px-3 py-1 text-xs font-semibold ${tone}`}>{children}</span>
  );
}

/** Top of the Campaign tab: how many inboxes are live, which need attention, and whether mail history is still importing. */
export function HealthStrip({ inboxes }: { inboxes: InboxView[] }) {
  const connected = inboxes.filter((i) => i.status === "connected");
  const needReconnect = inboxes.filter((i) => i.status === "needs_reconnect").length;
  const importing = connected.some((i) => i.backfillDoneAt === null);
  const anyInbox = connected.length > 0 || needReconnect > 0;

  return (
    <section aria-label="Campaign health" className="min-w-0 rounded border border-line bg-card p-4 md:p-6">
      {anyInbox ? (
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <Pill tone="border-ok text-ok">{plural(connected.length, "inbox connected", "inboxes connected")}</Pill>
          {needReconnect > 0 && <Pill tone="border-flag text-flag">{needReconnect} need reconnecting</Pill>}
          {importing && <Pill tone="border-line text-text-soft">Importing mail history</Pill>}
          <Link href="/settings#inboxes" className="text-sm text-gold underline underline-offset-2">
            Manage inboxes
          </Link>
        </div>
      ) : (
        <p className="text-sm text-muted">
          {EMPTY}{" "}
          <Link href="/settings#inboxes" className="text-gold underline underline-offset-2">
            Connect an inbox
          </Link>
        </p>
      )}
    </section>
  );
}
