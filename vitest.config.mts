import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  // Native replacement for vite-tsconfig-paths; resolves the `@/*` alias.
  resolve: { tsconfigPaths: true },
  test: {
    globals: true,
    // tests/unit/temp-dir.ts retries for up to ~21s while Windows releases a
    // closed libSQL file; the default 10s would cut that teardown short.
    hookTimeout: 30_000,
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          environment: "jsdom",
          setupFiles: ["./vitest.setup.ts"],
          include: ["tests/unit/**/*.test.{ts,tsx}"],
        },
      },
      {
        extends: true,
        test: {
          name: "integration",
          environment: "node",
          include: ["tests/integration/**/*.test.ts"],
          // One `next dev` for every file, started only when one is selected.
          globalSetup: ["./tests/integration/server.ts"],
        },
      },
    ],
  },
});
