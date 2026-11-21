import { notFound } from "next/navigation";
import { AppShell } from "@/components/shell/app-shell";
import { ComingSoon } from "@/components/shell/coming-soon";

// Renders AppShell without auth for tests. Not available in production.
export default function DevShellPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return (
    <AppShell>
      <ComingSoon title="Shell preview" />
    </AppShell>
  );
}
