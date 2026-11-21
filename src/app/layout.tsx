import type { Metadata, Viewport } from "next";
import { cookies } from "next/headers";
import { ClerkProvider } from "@clerk/nextjs";
import { Montserrat, Playfair_Display } from "next/font/google";
import { clerkConfigured } from "@/lib/clerk-config";
import { THEME_COOKIE, parseTheme } from "@/lib/theme";
import "./globals.css";

const montserrat = Montserrat({
  variable: "--font-montserrat",
  subsets: ["latin"],
  display: "swap",
});

const playfair = Playfair_Display({
  variable: "--font-playfair",
  subsets: ["latin"],
  style: ["italic"],
  display: "swap",
});

export const metadata: Metadata = {
  title: { default: "Recruiter Growth Engine", template: "%s | RGE" },
  description: "Candidate-led MPC outreach for recruiting agencies.",
  icons: { icon: "/brand/RGE-favicon.ico" },
};

export const viewport: Viewport = {
  themeColor: "#0A0A0A",
  width: "device-width",
  initialScale: 1,
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const theme = parseTheme((await cookies()).get(THEME_COOKIE)?.value);
  const page = (
    <html
      lang="en"
      data-theme={theme}
      className={`${montserrat.variable} ${playfair.variable}`}
      suppressHydrationWarning
    >
      <body className="min-h-dvh font-sans antialiased">{children}</body>
    </html>
  );
  // Without Clerk keys the app still builds and the public dev routes render; sign-in pages
  // and the proxy report the missing configuration instead.
  return clerkConfigured() ? <ClerkProvider signInUrl="/sign-in">{page}</ClerkProvider> : page;
}
