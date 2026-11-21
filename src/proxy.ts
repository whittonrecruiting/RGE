import { clerkMiddleware } from "@clerk/nextjs/server";
import { NextResponse, type NextFetchEvent, type NextMiddleware, type NextRequest } from "next/server";
import { CLERK_NOT_CONFIGURED, clerkConfigured } from "@/lib/clerk-config";
import { isPublicPath } from "@/lib/public-paths";

// Next 16 renamed middleware.ts to proxy.ts. Requires sign-in everywhere except the public
// allow-list in src/lib/public-paths.ts. Which agency a user acts in is decided by requireMember().

let clerk: NextMiddleware | undefined;
const clerkProxy = () =>
  (clerk ??= clerkMiddleware(
    async (auth, req) => {
      if (!isPublicPath(req.nextUrl.pathname)) await auth.protect();
    },
    { signInUrl: "/sign-in" },
  ));

export default function proxy(req: NextRequest, event: NextFetchEvent) {
  // The app builds without Clerk keys; requests then fail here with a clear message instead.
  if (!clerkConfigured()) {
    return isPublicPath(req.nextUrl.pathname)
      ? NextResponse.next()
      : new NextResponse(CLERK_NOT_CONFIGURED, { status: 500 });
  }
  return clerkProxy()(req, event);
}

export const config = {
  matcher: [
    // Skip Next.js internals and static files unless found in search params.
    "/((?!_next|[^?]*\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
