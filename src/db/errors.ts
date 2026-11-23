/** Postgres SQLSTATE for a CHECK constraint violation. */
const CHECK_VIOLATION = "23514";

/**
 * True when err (or an error it wraps, as Drizzle does with the driver error in `cause`) is a
 * Postgres CHECK constraint violation.
 */
export function isCheckViolation(err: unknown): boolean {
  let e: unknown = err;
  for (let depth = 0; depth < 5 && e && typeof e === "object"; depth++) {
    if ((e as { code?: unknown }).code === CHECK_VIOLATION) return true;
    e = (e as { cause?: unknown }).cause;
  }
  return false;
}
