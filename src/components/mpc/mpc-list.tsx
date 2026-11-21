import Link from "next/link";
import type { MpcRow } from "@/lib/mpc/queries";
import { MpcFlags, StatusBadge } from "./badges";

const MISSING_LABEL = { years: "years of experience", payTarget: "pay target" } as const;

function missingText(row: MpcRow) {
  if (row.missing.length === 0) return null;
  return `Missing ${row.missing.map((m) => MISSING_LABEL[m]).join(" and ")}`;
}

export function MpcList({ rows, showOwner }: { rows: MpcRow[]; showOwner: boolean }) {
  return (
    <>
      {/* Phone: cards */}
      <ul className="flex flex-col gap-3 md:hidden">
        {rows.map((r) => (
          <li key={r.id} className="rounded border border-line bg-card p-4">
            <div className="flex items-start justify-between gap-3">
              <Link
                href={`/mpcs/${r.id}`}
                className="min-w-0 [overflow-wrap:anywhere] text-sm font-semibold text-text hover:text-gold"
              >
                {r.headlineRole}
              </Link>
              <StatusBadge status={r.status} />
            </div>
            <p className="mt-1 [overflow-wrap:anywhere] text-sm text-text-soft">{r.location}</p>
            {showOwner && <p className="mt-1 [overflow-wrap:anywhere] text-xs text-muted">Owner: {r.ownerName}</p>}
            {missingText(r) && <p className="mt-1 text-xs text-muted">{missingText(r)}</p>}
            <div className="mt-3 flex flex-wrap gap-2 empty:hidden">
              <MpcFlags
                consentOnFile={r.consentOnFile}
                interviewOnlyCount={r.interviewOnlyCount}
                ownerRemoved={r.ownerRemoved}
              />
            </div>
          </li>
        ))}
      </ul>

      {/* Desktop: table */}
      <div className="hidden overflow-hidden rounded border border-line md:block">
        <table className="w-full table-fixed text-left text-sm">
          <thead className="bg-surface text-xs uppercase tracking-[0.14em] text-muted">
            <tr>
              <th className="w-[32%] px-4 py-3 font-semibold">Headline role</th>
              <th className="w-[16%] px-4 py-3 font-semibold">Location</th>
              {showOwner && <th className="w-[14%] px-4 py-3 font-semibold">Owner</th>}
              <th className="w-[10%] px-4 py-3 font-semibold">Status</th>
              <th className="px-4 py-3 font-semibold">Flags</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line bg-card">
            {rows.map((r) => (
              <tr key={r.id} className="align-top">
                <td className="[overflow-wrap:anywhere] px-4 py-3">
                  <Link href={`/mpcs/${r.id}`} className="font-semibold text-text hover:text-gold">
                    {r.headlineRole}
                  </Link>
                  {missingText(r) && <p className="mt-1 text-xs text-muted">{missingText(r)}</p>}
                </td>
                <td className="[overflow-wrap:anywhere] px-4 py-3 text-text-soft">{r.location}</td>
                {showOwner && <td className="[overflow-wrap:anywhere] px-4 py-3 text-text-soft">{r.ownerName}</td>}
                <td className="px-4 py-3">
                  <StatusBadge status={r.status} />
                </td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-2">
                    <MpcFlags
                      consentOnFile={r.consentOnFile}
                      interviewOnlyCount={r.interviewOnlyCount}
                      ownerRemoved={r.ownerRemoved}
                    />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
