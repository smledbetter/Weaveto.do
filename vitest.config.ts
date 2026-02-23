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
        "src/lib/components/**",
      ],
      thresholds: {
        "src/lib/tasks/**": { lines: 75, functions: 73, branches: 73 },
        "src/lib/agents/**": { lines: 74, functions: 73, branches: 70 },
        "src/lib/room/**": { lines: 40, functions: 40, branches: 30 },
        "src/lib/qr/**": { lines: 75, functions: 73, branches: 73 },
        "src/lib/pin/**": { lines: 75, functions: 73, branches: 73 },
        "src/lib/components/**": { lines: 0, functions: 0, branches: 0 },
      },
    },
  },
  resolve: {
    conditions: ["browser"],
    alias: {
      $lib: path.resolve(__dirname, "src/lib"),
      $app: path.resolve(__dirname, "tests/unit/helpers/app-mock"),
    },
  },
});
