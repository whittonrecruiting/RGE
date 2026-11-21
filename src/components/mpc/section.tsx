export function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex min-w-0 flex-col gap-4 rounded border border-line bg-card p-4 md:p-6">
      <h2 className="text-sm font-semibold uppercase tracking-[0.14em] text-text">{title}</h2>
      {children}
    </section>
  );
}

/** Read-only stand-in until the section is built (Tasks 6 to 8). */
export function ComingNextSection({ title }: { title: string }) {
  return (
    <Section title={title}>
      <p className="text-sm text-muted">Coming next</p>
    </Section>
  );
}
