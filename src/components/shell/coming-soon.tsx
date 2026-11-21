import { PageTitle } from "./page-title";

export function ComingSoon({ title }: { title: string }) {
  return (
    <section className="flex flex-col gap-6">
      <PageTitle>{title}</PageTitle>
      <div className="flex flex-col items-start gap-2 rounded-xl border border-line bg-card p-6 md:p-8">
        <p className="text-sm font-semibold uppercase tracking-[0.14em] text-gold">Coming soon</p>
        <p className="max-w-prose text-sm leading-relaxed text-text-soft">
          This area is not built yet. It will appear here when it ships.
        </p>
      </div>
    </section>
  );
}
