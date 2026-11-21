import { defineConfig } from "drizzle-kit";

// Migrations must run as the database owner role (not rge_app).
// Prefer the direct (unpooled) connection for migrations when available.
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dbCredentials: {
    url: process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL ?? "",
  },
});
