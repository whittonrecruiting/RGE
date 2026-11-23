import type { MpcStatus } from "@/lib/mpc/schema";

const STATUS_LABEL: Record<MpcStatus, string> = {
  draft: "Draft",
  active: "Active",
  paused: "Paused",
  removed: "Removed",
  placed: "Placed",
};

const STATUS_TONE: Record<MpcStatus, string> = {
  draft: "border-flag text-flag",
  active: "border-ok text-ok",
  paused: "border-line text-text-soft",
  removed: "border-line text-muted",
  placed: "border-gold text-gold",
};

const badge = "inline-block whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-semibold";

export function StatusBadge({ status }: { status: MpcStatus }) {
  return <span className={`${badge} ${STATUS_TONE[status]}`}>{STATUS_LABEL[status]}</span>;
}

/** Amber warning badge. */
export function FlagBadge({ children }: { children: React.ReactNode }) {
  return <span className={`${badge} border-flag text-flag`}>{children}</span>;
}

export function MpcFlags({
  consentOnFile,
  interviewOnlyCount,
  ownerRemoved,
}: {
  consentOnFile: boolean;
  interviewOnlyCount: number;
  ownerRemoved: boolean;
}) {
  return (
    <>
      {ownerRemoved && <FlagBadge>Owner removed</FlagBadge>}
      {!consentOnFile && <FlagBadge>No consent on file</FlagBadge>}
      {interviewOnlyCount > 0 && (
        <FlagBadge>{interviewOnlyCount === 1 ? "1 fact to confirm" : `${interviewOnlyCount} facts to confirm`}</FlagBadge>
      )}
    </>
  );
}

/** Shown at the top of a draft MPC's page. */
export function DraftBanner() {
  return (
    <p role="status" className="rounded border border-flag bg-card p-4 text-sm text-text">
      This MPC is a draft. Add the headline role and location to activate it.
    </p>
  );
}
