import { defineConfig } from "vitest/config";
import { svelte } from "@sveltejs/vite-plugin-svelte";

export default defineConfig({
  plugins: [svelte({ hot: false })],
  test: {
    include: ["tests/unit/**/*.test.ts"],
    environment: "jsdom",
    coverage: {
      provider: "v8",
      include: ["src/lib/tasks/**"],
      thresholds: { lines: 80, functions: 80, branches: 80 },
    },
  },
  resolve: {
    alias: {
      $lib: "/Users/stevo/Sites/Weave.us/src/lib",
    },
  },
});
