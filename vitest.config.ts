import { defineConfig } from "vitest/config";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import path from "path";

export default defineConfig({
  plugins: [svelte({ hot: false })],
  test: {
    include: ["tests/unit/**/*.test.ts"],
    environment: "jsdom",
    coverage: {
      provider: "v8",
      include: [
        "src/lib/tasks/**",
        "src/lib/agents/**",
        "src/lib/room/**",
        "src/lib/qr/**",
        "src/lib/pin/**",
      ],
      thresholds: { lines: 75, functions: 73, branches: 73 },
    },
  },
  resolve: {
    alias: {
      $lib: path.resolve(__dirname, "src/lib"),
    },
  },
});
