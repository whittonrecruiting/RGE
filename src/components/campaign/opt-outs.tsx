import Link from "next/link";
import { Section } from "@/components/mpc/section";
import { fieldClass, quietButton } from "@/components/mpc/ui";
import type { SuppressionRow } from "@/lib/suppressions/queries";
import { AddOptOutForm } from "./add-opt-out-form";

export const OPT_OUT_EMPTY = "People who opt out or bounce are listed here and never emailed again.";
const FOOTER = "People on this list are never emailed again. It cannot be undone in RGE.";
const REASON: Record<SuppressionRow["reason"], string> = {
  opted_out: "Opted out",
  bounced: "Bounced",
  manual: "Added by hand",
};
const SHOWN_LIMIT = 500;

const dateFmt = (tz: string) =>
  new Intl.DateTimeFormat("en-US", { timeZone: tz, month: "short", day: "numeric", year: "numeric" });

/** The permanent opt-out and bounce list. Search is a plain GET form (?q=), filtered in SQL by the page. */
export function OptOuts({
  rows,
  query,
  canAdd,
  timeZone,
}: {
  rows: SuppressionRow[];
  query: string;
  canAdd: boolean;
  timeZone: string;
}) {
  const fmt = dateFmt(timeZone);
  const searching = query !== "";
  const countText = searching
    ? `${rows.length === 1 ? "1 address matches" : `${rows.length} addresses match`} "${query}"`
    : rows.length === 1
      ? "1 address"
      : `${rows.length} addresses`;

  return (
    <div id="opt-outs" className="scroll-mt-20 md:scroll-mt-6">
      <Section title="Opt-outs and bounces">
        {canAdd && <AddOptOutForm />}

        {rows.length === 0 && !searching ? (
          <p className="text-sm text-muted">{OPT_OUT_EMPTY}</p>
        ) : (
          <>
            <form
              method="get"
              action="#opt-outs"
              role="search"
              className="flex min-w-0 flex-col gap-2 md:flex-row md:items-end"
            >
              <label className="flex min-w-0 flex-1 flex-col gap-1 text-xs text-muted">
                Search by email
                <input
                  name="q"
                  type="search"
                  defaultValue={query}
                  autoComplete="off"
                  maxLength={200}
                  className={fieldClass}
                />
              </label>
              <div className="flex gap-2">
                <button type="submit" className={quietButton}>
                  Search
                </button>
                {searching && (
                  <Link href="?#opt-outs" className={`${quietButton} inline-flex items-center`}>
                    Clear
                  </Link>
                )}
              </div>
            </form>

            <p role="status" className="text-sm text-text-soft [overflow-wrap:anywhere]">
              {countText}
              {rows.length >= SHOWN_LIMIT && ` Showing the newest ${SHOWN_LIMIT}.`}
            </p>

            {rows.length > 0 && (
              <ul className="divide-y divide-line rounded border border-line">
                {rows.map((r) => (
                  <li
                    key={r.email}
                    className="flex min-w-0 flex-col gap-1 px-4 py-3 md:flex-row md:items-center md:justify-between md:gap-4"
                  >
                    <span className="min-w-0 text-sm font-semibold text-text [overflow-wrap:anywhere]">{r.email}</span>
                    <span className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 text-sm text-text-soft">
                      <span>{REASON[r.reason]}</span>
                      <span className="text-muted">{fmt.format(r.createdAt)}</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}

        <p className="text-sm text-text-soft">{FOOTER}</p>
      </Section>
    </div>
  );
}
