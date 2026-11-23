import Link from "next/link";
import type { MpcStatus } from "@/lib/mpc/schema";

export type OwnerFilter = "me" | "all";
export type StatusFilter = MpcStatus | undefined;

const OWNERS: { value: OwnerFilter; label: string }[] = [
  { value: "me", label: "Mine" },
  { value: "all", label: "Team" },
];
const STATUSES: { value: StatusFilter; label: string }[] = [
  { value: undefined, label: "All" },
  { value: "draft", label: "Draft" },
  { value: "active", label: "Active" },
  { value: "paused", label: "Paused" },
  { value: "placed", label: "Placed" },
  { value: "removed", label: "Removed" },
];

function href(owner: OwnerFilter, status: StatusFilter) {
  const q = new URLSearchParams();
  if (owner !== "me") q.set("owner", owner);
  if (status) q.set("status", status);
  const s = q.toString();
  return s ? `/mpcs?${s}` : "/mpcs";
}

function Chip({ to, active, children }: { to: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={to}
      aria-current={active ? "true" : undefined}
      className={`inline-flex min-h-11 items-center rounded border px-4 text-xs font-semibold uppercase tracking-[0.14em] ${
        active ? "border-gold bg-hover text-gold" : "border-line text-text-soft hover:bg-hover"
      }`}
    >
      {children}
    </Link>
  );
}

export function ListFilters({ owner, status }: { owner: OwnerFilter; status: StatusFilter }) {
  return (
    <div className="flex flex-col gap-3 md:flex-row md:gap-6">
      <nav aria-label="Owner" className="flex flex-wrap gap-2">
        {OWNERS.map((o) => (
          <Chip key={o.value} to={href(o.value, status)} active={owner === o.value}>
            {o.label}
          </Chip>
        ))}
      </nav>
      <nav aria-label="Status" className="flex flex-wrap gap-2">
        {STATUSES.map((s) => (
          <Chip key={s.label} to={href(owner, s.value)} active={status === s.value}>
            {s.label}
          </Chip>
        ))}
      </nav>
    </div>
  );
}
