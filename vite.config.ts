import { sveltekit } from "@sveltejs/kit/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [sveltekit()],
  optimizeDeps: {
    exclude: ["vodozemac-wasm-bindings"],
  },
  server: {
    fs: {
      allow: ["node_modules/vodozemac-wasm-bindings"],
    },
  },
});
