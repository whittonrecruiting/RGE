import { AppShell } from "@/components/shell/app-shell";
import { requireMember } from "@/lib/auth";

// Every page in the app group needs a signed-in member of the active agency. requireMember
// redirects to /sign-in or /no-agency otherwise.
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  await requireMember();
  return <AppShell>{children}</AppShell>;
}
