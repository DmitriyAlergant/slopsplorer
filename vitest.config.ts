import { defineConfig } from "vitest/config";

/**
 * Kept separate from `vite.config.ts`, which roots itself at `src/web` to build
 * the browser bundle. The test suite exercises the Node side, so it needs the
 * repository root instead.
 */
export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
  },
});
