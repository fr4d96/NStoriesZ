import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
    include: ["**/*.test.{ts,tsx}"],
    // tests/integration/** hits a real Supabase project and is intentionally
    // excluded from the default run — see `npm run test:rls`.
    exclude: ["node_modules/**", ".next/**", "e2e/**", "tests/integration/**"],
  },
});
