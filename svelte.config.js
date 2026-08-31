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
          // Hash of the inline theme script in src/app.html. Kept in sync by
          // `npm run csp:hash:write`; CI fails if it drifts. Do not hand-edit.
          "sha256-Mz6+g81mrxYafkDnimrpP9cGOS0YzsFEO+xqMgAbvmQ=",
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
