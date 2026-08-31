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

# Register the tsx loader into one node process rather than running the tsx CLI,
# which forks a launcher and leaves it resident for the life of the container.
# Measured in this image on linux/arm64, before any connection. These are summed
# RSS, used here only to compare the two shapes against each other:
#
#   tsx CLI        3 processes, launcher ~55 + relay ~94 + esbuild ~15 = ~165 MiB
#   node --import  2 processes, relay ~85-92 + esbuild ~14 = ~100-105 MiB
#
# Do not read those as the container's footprint, and do not read their
# difference as the size of the win. Summed RSS counts the shared Node binary
# and libraries once per process, so it roughly doubles the truth and inflates
# any gap between two shapes with different process counts. Idle cgroup
# memory.current for the shipped shape is ~56-64 MiB. The tsx CLI shape was
# never measured by cgroup, so the real saving is smaller than these figures
# imply and is not quantified here. See docs/DEPLOYMENT.md, which uses cgroup
# figures throughout.
#
# The win is a whole Node process removed, which is worth having regardless of
# how the bytes are counted. This also makes the relay itself PID 1, so a
# deploy's SIGTERM reaches it directly instead of going through a wrapper.
#
# PID 1 needs care. The kernel delivers a signal from an ancestor namespace to
# PID 1 only if PID 1 has registered a handler, with no default-disposition
# fallback, so a PID 1 that ignores SIGTERM stalls until fly's kill_timeout and
# is then SIGKILLed. That trap does not spring here, because node installs its
# own handlers for SIGINT, SIGTERM and SIGHUP. Measured: `docker stop` against
# this shape returns in ~1.2s, not at the 10s timeout.
#
# What node's default handler does NOT do is drain. It exits at once, so every
# socket dies together with no warning to clients. Graceful shutdown therefore
# depends on a SIGTERM handler in server/relay.ts, which is a separate concern
# owned by that file. Do not remove such a handler on the assumption that PID 1
# will do the right thing by itself. Delivery is handled here. Draining is not.
#
# Precompiling to plain JS would drop esbuild too, but
# server/relay.ts does not typecheck under a standalone strict tsc, and emitting
# with checks disabled would ship something other than the source that dev runs.
CMD ["node", "--import", "/opt/tsx/node_modules/tsx/dist/loader.mjs", "server/relay.ts"]
