import { Section } from "@/components/mpc/section";
import { primaryButton } from "@/components/mpc/ui";
import type { InboxView } from "@/lib/inboxes/queries";
import { inboxErrorMessage } from "@/lib/inboxes/connect-errors";
import { InboxActions } from "./inbox-actions";

export const OAUTH_START = "/api/google/oauth/start";

export type InboxNotice = { tone: "ok" | "error"; text: string } | null;

/** Turns the ?inbox and ?inbox_error query values into a notice. Errors render only through fixed copy. */
export function inboxNotice(inbox: string | undefined, inboxError: string | undefined): InboxNotice {
  if (inboxError !== undefined) {
    const text = inboxErrorMessage(inboxError);
    return text ? { tone: "error", text } : null;
  }
  if (inbox === "connected") return { tone: "ok", text: "Gmail connected." };
  return null;
}

const EMPTY_COPY =
  "Connect the Gmail inbox you send candidate introductions from. RGE reads your sent and received mail so it never emails someone twice by mistake, and sends only what you approve.";

const STATUS: Record<InboxView["status"], { label: string; tone: string }> = {
  connected: { label: "Connected", tone: "border-ok text-ok" },
  needs_reconnect: { label: "Reconnect needed", tone: "border-flag text-flag" },
  disconnected: { label: "Disconnected", tone: "border-line text-muted" },
};

function Badge({ tone, children }: { tone: string; children: React.ReactNode }) {
  return (
    <span className={`inline-block whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-semibold ${tone}`}>
      {children}
    </span>
  );
}

const dateFmt = (tz: string) =>
  new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    month: "short",
    day: "numeric",
    year: "numeric",
  });
const timeFmt = (tz: string) =>
  new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour: "numeric",
    minute: "2-digit",
  });

function Check({ label, result }: { label: string; result: { ok: boolean; fix: string | null } }) {
  return result.ok ? (
    <li className="flex gap-2 text-sm text-text-soft">
      <span aria-hidden="true" className="text-ok">
        &#10003;
      </span>
      <span>
        {label}
        <span className="sr-only"> passes</span>
      </span>
    </li>
  ) : (
    <li className="flex gap-2 text-sm text-flag">
      <span aria-hidden="true">!</span>
      <span className="min-w-0 [overflow-wrap:anywhere]">
        <span className="font-semibold">{label}</span>
        {result.fix ? `: ${result.fix}` : " needs attention."}
      </span>
    </li>
  );
}

function InboxCard({ inbox, timeZone }: { inbox: InboxView; timeZone: string }) {
  const status = STATUS[inbox.status];
  const history = inbox.backfillDoneAt
    ? `History imported.${inbox.lastSyncedAt ? ` Last synced ${timeFmt(timeZone).format(inbox.lastSyncedAt)}.` : ""}`
    : `Importing mail history since ${dateFmt(timeZone).format(inbox.backfillFrom)}`;
  return (
    <li className="rounded border border-line bg-surface p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-text [overflow-wrap:anywhere]">{inbox.email}</p>
          {!inbox.isMine && <p className="text-xs text-muted [overflow-wrap:anywhere]">{inbox.ownerName}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {inbox.isPrimary && <Badge tone="border-gold text-gold">Primary</Badge>}
          <Badge tone={status.tone}>{status.label}</Badge>
        </div>
      </div>

      {inbox.domainCheck && (
        <ul className="mt-3 flex flex-col gap-1" aria-label="Domain checks">
          <Check label="SPF" result={inbox.domainCheck.spf} />
          <Check label="DKIM" result={inbox.domainCheck.dkim} />
          <Check label="DMARC" result={inbox.domainCheck.dmarc} />
        </ul>
      )}

      <p className="mt-3 text-sm text-text-soft">{history}</p>
      {inbox.lastSyncError && <p className="mt-1 text-sm text-deny [overflow-wrap:anywhere]">{inbox.lastSyncError}</p>}

      {inbox.canManage && (
        <div className="mt-3">
          <InboxActions
            inboxId={inbox.id}
            email={inbox.email}
            status={inbox.status}
            isPrimary={inbox.isPrimary}
            oauthStart={OAUTH_START}
          />
        </div>
      )}
    </li>
  );
}

/** Connected Gmail inboxes in Settings. Dates render in the agency time zone. */
export function InboxesSection({
  inboxes,
  canConnect,
  notice,
  timeZone,
}: {
  inboxes: InboxView[];
  canConnect: boolean;
  notice: InboxNotice;
  timeZone: string;
}) {
  return (
    <div id="inboxes" className="scroll-mt-20 md:scroll-mt-6">
      <Section title="Inboxes">
        {notice &&
          (notice.tone === "ok" ? (
            <p role="status" className="text-sm text-ok">
              {notice.text}
            </p>
          ) : (
            <p role="alert" className="text-sm text-deny">
              {notice.text}
            </p>
          ))}

        {inboxes.length === 0 ? (
          <p className="text-sm text-text-soft">{EMPTY_COPY}</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {inboxes.map((i) => (
              <InboxCard key={i.id} inbox={i} timeZone={timeZone} />
            ))}
          </ul>
        )}

        {canConnect && (
          <div>
            <a href={OAUTH_START} className={`${primaryButton} inline-flex items-center`}>
              Connect Gmail
            </a>
          </div>
        )}
      </Section>
    </div>
  );
}
