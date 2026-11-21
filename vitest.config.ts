import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    include: ["src/**/*.test.ts", "tests/unit/**/*.test.ts"],
    exclude: ["tests/e2e/**", "node_modules/**"],
    // Every database test boots PGlite and runs all migrations, which is slow under load.
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // Cap parallel PGlite instances so a busy machine does not starve them into timeouts.
    maxWorkers: 4,
  },
});
