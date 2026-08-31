# Relay runtime image. Fly builds this with the repo root as the build context,
# so every COPY path below is relative to the repository root, not to server/.

FROM node:22-slim

WORKDIR /app

# Runtime dependencies only. The relay needs `ws` and nothing else from the
# dependency tree. Installing devDependencies here would put vite, svelte and
# playwright inside an internet-facing image, and would quietly widen the
# surface that the audit:prod gate exists to keep narrow.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts

# tsx is the TypeScript loader, and it lives in devDependencies, so the install
# above drops it. Reinstall the loader at the version the lockfile pins, which
# keeps package-lock.json the single source of truth for it.
#
# This replaces `npx tsx`, which resolved the loader over the network. The
# previous image happened to boot from a build-time npx cache entry; on a cache
# miss it would have reached the registry during container start, and it floated
# to whatever tsx version was newest at build time rather than the pinned one.
#
# The install goes into its own prefix, not back into /app. `npm install tsx`
# inside /app reconciles against the full package.json and drags every
# devDependency in behind it, which puts vite, svelte and playwright back in the
# image. tsx registers a process-wide loader hook, so running it from elsewhere
# is fine: relay.ts still resolves `ws` from /app/node_modules.
RUN mkdir -p /opt/tsx \
 && cd /opt/tsx \
 && npm install --no-package-lock --loglevel=error \
      "tsx@$(node -p "require('/app/package-lock.json').packages['node_modules/tsx'].version")"

# The whole server directory, not a single file. relay.ts imports ./vapid.js and
# ./push-types.js. Copying relay.ts alone produced an image that could not
# resolve its own imports and exited with ERR_MODULE_NOT_FOUND at startup, which
# is why the relay silently ran a pre-M16 build in production. Copying the
# directory means adding a server module cannot reintroduce that failure.
COPY server ./server

# tsconfig.json is deliberately not copied. It extends .svelte-kit/tsconfig.json,
# a generated file that is gitignored and therefore absent from the image, and it
# is written for the browser bundle rather than for the relay. tsx resolves the
# relay's ESM `.js` specifiers to their `.ts` sources without it.

ENV NODE_ENV=production

# The relay holds no state on disk and needs no write access to its own code.
USER node

EXPOSE 3001

# Invoke the pinned binary directly. `npx` would re-resolve on every boot.
CMD ["/opt/tsx/node_modules/.bin/tsx", "server/relay.ts"]
