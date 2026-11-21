import { OrganizationList, SignOutButton } from "@clerk/nextjs";
import { agencyAwaitingApproval } from "@/lib/auth";
import { clerkConfigured, CLERK_NOT_CONFIGURED } from "@/lib/clerk-config";

export const metadata = { title: "No agency" };

// Agencies are created by the founder, not self-serve: hide Clerk's "Create organization" action.
// (Also turn off "Allow users to create organizations" in the Clerk dashboard.)
const NO_CREATE = { elements: { organizationListCreateOrganizationActionButton: { display: "none" } } };

// requireMember() sends signed-in users here when no active agency maps to a membership, or when
// their agency is not enabled yet.
export default async function NoAgencyPage() {
  if (!clerkConfigured()) {
    return (
      <main className="flex min-h-dvh items-center justify-center px-4 py-10">
        <p role="alert">{CLERK_NOT_CONFIGURED}</p>
      </main>
    );
  }
  const waiting = await agencyAwaitingApproval();
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-6 px-4 py-10 text-center">
      {waiting ? (
        <>
          <h1 className="text-xl font-semibold">Almost there</h1>
          <p>Your agency is waiting for approval.</p>
        </>
      ) : (
        <>
          <h1 className="text-xl font-semibold">Choose your agency</h1>
          <p>
            Your account is not active in an agency yet. Pick one below, or ask your agency owner for an
            invite. If you just joined, give it a moment and refresh.
          </p>
          <OrganizationList hidePersonal afterSelectOrganizationUrl="/approvals" appearance={NO_CREATE} />
        </>
      )}
      <SignOutButton>
        <button type="button" className="underline">
          Sign out
        </button>
      </SignOutButton>
    </main>
  );
}
