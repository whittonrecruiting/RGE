import { createClerkWebhookHandler } from "@/lib/clerk-webhook";

// Clerk organization, membership and user sync. Signature checked with CLERK_WEBHOOK_SIGNING_SECRET.
export const POST = createClerkWebhookHandler();
