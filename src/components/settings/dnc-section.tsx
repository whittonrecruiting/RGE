import { Section } from "@/components/mpc/section";
import type { DncEntry } from "@/lib/dnc/queries";
import { DncAddForm, DncRemoveButton, DncUpload } from "./dnc-controls";

const HELP = "RGE never researches or emails these companies, their domains or their aliases.";

function Chips({ label, items }: { label: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className="text-xs text-muted">{label}</span>
      <ul className="flex min-w-0 flex-wrap gap-1.5" aria-label={label}>
        {items.map((item) => (
          <li
            key={item}
            className="max-w-full rounded border border-line px-2 py-0.5 text-xs text-text-soft [overflow-wrap:anywhere]"
          >
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Companies the agency never contacts. Managers edit; recruiters see the list read-only. */
export function DncSection({ entries, canEdit }: { entries: DncEntry[]; canEdit: boolean }) {
  return (
    <div id="do-not-contact" className="scroll-mt-20 md:scroll-mt-6">
      <Section title="Do-not-contact companies">
        <p className="text-sm text-text-soft">{HELP}</p>

        {canEdit && (
          <div className="flex min-w-0 flex-col gap-3">
            <DncAddForm />
            <DncUpload />
          </div>
        )}

        {entries.length === 0 ? (
          <p className="text-sm text-muted">No companies on the list yet.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {entries.map((e) => (
              <li key={e.id} className="flex min-w-0 flex-col gap-3 rounded border border-line bg-surface p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <p className="min-w-0 text-sm font-semibold text-text [overflow-wrap:anywhere]">{e.name}</p>
                  {canEdit && <DncRemoveButton id={e.id} name={e.name} />}
                </div>
                <Chips label="Domains" items={e.domains} />
                <Chips label="Aliases" items={e.aliases} />
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}
