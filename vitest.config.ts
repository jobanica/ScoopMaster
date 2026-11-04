import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: { environment: "node", include: ["tests/**/*.test.ts"], fileParallelism: false, testTimeout: 60000,
    env: { DATABASE_URL: process.env.TEST_DATABASE_URL ?? "postgresql://scoop:scoop@localhost:5432/scoopmaster_test?schema=public", DIRECT_URL: process.env.TEST_DATABASE_URL ?? "postgresql://scoop:scoop@localhost:5432/scoopmaster_test?schema=public" } },
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
});
