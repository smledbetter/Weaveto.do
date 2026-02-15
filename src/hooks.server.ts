/**
 * SvelteKit server hooks.
 * CSP is handled by SvelteKit's built-in csp config (svelte.config.js)
 * which auto-generates nonces for inline scripts.
 * This file adds additional security headers.
 */

import type { Handle } from "@sveltejs/kit";

export const handle: Handle = async ({ event, resolve }) => {
  const response = await resolve(event);

  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("Referrer-Policy", "no-referrer");
  response.headers.set(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=(), interest-cohort=()",
  );

  return response;
};
