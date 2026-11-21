/** Paths the proxy lets through without a signed-in user. Everything else requires sign-in. */
const PUBLIC_PREFIXES = ["/sign-in", "/api/webhooks/", "/brand/"];
const PUBLIC_EXACT = ["/manifest.webmanifest"];

const under = (pathname: string, prefix: string) =>
  prefix.endsWith("/") ? pathname.startsWith(prefix) : pathname === prefix || pathname.startsWith(`${prefix}/`);

export function isPublicPath(pathname: string, nodeEnv: string | undefined = process.env.NODE_ENV): boolean {
  if (PUBLIC_EXACT.includes(pathname)) return true;
  if (PUBLIC_PREFIXES.some((p) => under(pathname, p))) return true;
  // /dev/* renders the shell without auth for local and e2e testing (the routes 404 in production).
  return nodeEnv !== "production" && under(pathname, "/dev");
}
