import adapter from "@sveltejs/adapter-auto";

/** @type {import('@sveltejs/kit').Config} */
const config = {
  kit: {
    adapter: adapter(),
    csp: {
      directives: {
        "default-src": ["self"],
        "script-src": ["self", "wasm-unsafe-eval"],
        "style-src": ["self", "unsafe-inline"],
        "connect-src": ["self", "ws://localhost:3001", "wss://weave.us:3001"],
        "img-src": ["self", "data:"],
        "font-src": ["self"],
        "object-src": ["none"],
        "base-uri": ["self"],
        "form-action": ["self"],
        "frame-ancestors": ["none"],
      },
    },
  },
};

export default config;
