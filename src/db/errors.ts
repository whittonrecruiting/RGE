/** Postgres SQLSTATE for a CHECK constraint violation. */
const CHECK_VIOLATION = "23514";

/**
 * True when err (or an error it wraps, as Drizzle does with the driver error in `cause`) is a
 * Postgres CHECK constraint violation. With constraint, the error must also name that constraint
 * when the driver reports one.
 */
export function isCheckViolation(err: unknown, constraint?: string): boolean {
  let e: unknown = err;
  for (let depth = 0; depth < 5 && e && typeof e === "object"; depth++) {
    const { code, constraint: named } = e as { code?: unknown; constraint?: unknown };
    if (code === CHECK_VIOLATION) return !constraint || typeof named !== "string" || named === constraint;
    e = (e as { cause?: unknown }).cause;
  }
  return false;
}
