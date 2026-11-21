export function PageTitle({ children }: { children: React.ReactNode }) {
  return (
    <h1 className="text-xl font-semibold uppercase tracking-[0.18em] text-text md:text-2xl">
      {children}
    </h1>
  );
}
