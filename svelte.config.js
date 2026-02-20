import adapter from "@sveltejs/adapter-auto";

/** @type {import('@sveltejs/kit').Config} */
const config = {
  kit: {
    adapter: adapter(),
    csp: {
      directives: {
        "default-src": ["self"],
        "script-src": [
          "self",
          "wasm-unsafe-eval",
          "sha256-94yTjVcb5wUAs+UjAs3xcZX3TtmUCmw2go8N7mk2g3Q=",
        ],
        "style-src": ["self", "unsafe-inline"],
        "connect-src": ["self", "ws://localhost:3001", "wss://weaveto.do:3001", "wss://weaveto-relay.fly.dev"],
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
