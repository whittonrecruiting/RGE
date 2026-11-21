import { defineConfig } from "drizzle-kit";

// Migrations run as the database owner over the direct (unpooled) connection. The app itself uses
// DATABASE_URL (pooled, a runtime role with no table grants); see README "Database roles".
const url = process.env.DATABASE_URL_UNPOOLED;
if (!url) {
  throw new Error(
    "DATABASE_URL_UNPOOLED is not set. Set it to the direct (unpooled) connection string for the database owner role; migrations never use DATABASE_URL.",
  );
}

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dbCredentials: { url },
});
