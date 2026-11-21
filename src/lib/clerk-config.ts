/**
 * Clerk keys are read at request time only, so the app builds without them. Anything that
 * needs Clerk calls assertClerkConfigured() and fails with this message when keys are missing.
 */
export function clerkConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY && process.env.CLERK_SECRET_KEY);
}

export const CLERK_NOT_CONFIGURED =
  "Clerk is not configured: set NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY and CLERK_SECRET_KEY in .env.local.";

export function assertClerkConfigured(): void {
  if (!clerkConfigured()) throw new Error(CLERK_NOT_CONFIGURED);
}
