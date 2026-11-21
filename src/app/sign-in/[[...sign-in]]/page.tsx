import { SignIn } from "@clerk/nextjs";
import { clerkConfigured, CLERK_NOT_CONFIGURED } from "@/lib/clerk-config";

export const metadata = { title: "Sign in" };

export default function SignInPage() {
  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-10">
      {clerkConfigured() ? <SignIn /> : <p role="alert">{CLERK_NOT_CONFIGURED}</p>}
    </main>
  );
}
