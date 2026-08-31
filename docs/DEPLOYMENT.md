# Deployment

How the WebSocket relay gets to production, what it cannot do, and how to tell whether the thing running is the thing you built.

## What is deployed

| Piece | Target | Config |
|-------|--------|--------|
| Client | Vercel, via `@sveltejs/adapter-auto` | `svelte.config.js` |
| Relay | Fly.io app `weaveto-relay`, region `ord` | `fly.toml`, `server/Dockerfile` |

The two are deployed separately. The client reaches the relay over `VITE_RELAY_URL`, which is read at **build time** in `src/lib/room/session.ts`. A client build without that variable falls back to `<current hostname>:3001`, which is correct in dev and wrong in production. Changing the relay hostname therefore needs a client rebuild, not just a relay deploy.

## Deploying the relay

Run from the repository root, because the Docker build context is the root and not `server/`.

```
fly deploy
```

`fly.toml` points the build at `server/Dockerfile`. The image installs production dependencies from `package-lock.json`, adds the pinned `tsx` loader, copies the whole `server/` directory, and runs `tsx server/relay.ts` as the non-root `node` user.

Two details in that image are deliberate and are the reason the relay stopped deploying once before.

**The whole `server/` directory is copied, not one file.** `relay.ts` imports `./vapid.js` and `./push-types.js`. An image built from `relay.ts` alone builds cleanly and then exits at startup with `ERR_MODULE_NOT_FOUND`. Copying the directory means adding a server module cannot reintroduce that failure.

**The TypeScript loader is installed, not fetched.** `tsx` is a devDependency, so the production install drops it. The image reinstalls it into `/opt/tsx` at the version `package-lock.json` pins. The install goes into its own prefix because `npm install tsx` inside `/app` reconciles against the full `package.json` and drags every devDependency back into the image. The previous image ran `npx tsx`, which resolved the loader over the network and floated off the pinned version.

## One machine, always on

**The relay must run on exactly one machine, and that machine must not stop.**

Every piece of relay state lives in process memory. `server/relay.ts` holds the room registry, the push subscription table, and the per-IP connection counts in plain `Map` objects. Nothing is persisted and nothing is shared between processes.

Two constraints follow, and neither is a preference.

**The machine cannot be allowed to stop.** Stopping it destroys every live room and disconnects every member mid-session. `fly.toml` sets `auto_stop_machines = 'off'` and `min_machines_running = 1`. The earlier config had `auto_stop_machines = 'stop'` with `min_machines_running = 0`, which meant an idle period was a mass disconnect.

**The app cannot run more than one machine.** Fly balances connections across machines. Two members of the same room can land on different processes, each holding half a room, each unable to see the other. This failure is silent. Both clients connect successfully and simply never receive each other's messages.

`fly.toml` cannot cap machine count on its own. Hold it at one:

```
fly scale count 1
fly status          # confirm exactly one machine
```

### The ceiling this buys

A single `shared-cpu-1x` machine with 1GB of memory, bounded by the limits in `server/relay.ts`:

| Limit | Value |
|-------|-------|
| Rooms | 10,000 |
| Total connections | 5,000 |
| Clients per room | 50 |
| Connections per IP | 10 |
| Messages per second per connection | 30 |

That is the capacity ceiling until routing changes. **Do not raise the machine count to get past it.** Horizontal scale requires routing every connection for a room ID to the same process, which is not implemented. Adding a second machine does not add capacity, it corrupts room membership.

### Idle memory baseline

The image runs two processes and holds roughly 100 to 105 MiB resident before a single client connects, measured on linux/arm64. Figures move by several MiB between runs.

| Process | Resident |
|---------|----------|
| `node` running the relay | ~85 to 92 MiB |
| esbuild service, used by the tsx loader | ~14 MiB |

Subtract that from the 1GB machine before reading any per-connection number. The relay is started with `node --import` rather than the `tsx` CLI, which would add a resident launcher process of about 55 MiB for nothing. See the comment in `server/Dockerfile` for the measurements and for why the relay is not precompiled to plain JS.

## What a deploy does to live rooms

A deploy replaces the machine, so the process dies and every `Map` goes with it. Concretely, at the moment of deploy:

- Every connected client is disconnected.
- Every room registry entry is destroyed, including the creator identity key and the ephemeral flag.
- Every push subscription registered with the relay is dropped. Clients re-register on reconnect.

Task data survives, because it is event-sourced client-side and the relay only ever routed ciphertext. What is lost is routing state and session continuity. Clients must reconnect and re-establish.

There is no zero-downtime path for this design. A rolling deploy would mean two processes alive at once, which is the split-room failure above. **Treat every relay deploy as a full disconnect of all active sessions.**

### VAPID keys must be set as secrets

`initVapid()` in `server/vapid.ts` reads `VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY`. If either is missing it generates an ephemeral keypair for that process. That is fine in dev and wrong in production, because a new keypair on every deploy invalidates every existing push subscription.

```
fly secrets set VAPID_PUBLIC_KEY=... VAPID_PRIVATE_KEY=...
fly secrets list    # confirm both are present
```

`fly secrets set` restarts the machine, so it carries the same full-disconnect cost as a deploy.

## The `/vapid-key` probe

`GET /vapid-key` is how you tell whether the relay running in production is built from current source.

It works because of a quirk worth stating plainly. The relay answers **every** unmatched path with HTTP 200 and the literal body `OK`. A status-code health check therefore passes against any relay, including one built before the endpoint existed. Only the body distinguishes them.

```
curl -s https://weaveto-relay.fly.dev/vapid-key
```

| Response | Meaning |
|----------|---------|
| `{"publicKey":"B..."}` | The relay is built from source containing the VAPID endpoint. |
| `OK` | The running image predates the endpoint. The deploy did not happen or did not take. |

This probe is the evidence that the relay ran a stale build. The endpoint landed in M16, and production kept answering `OK` long afterward, because nothing in the pipeline ever started the container and looked at it.

The health check in `fly.toml` also requests `/vapid-key`. It catches a relay that died or wedged. It cannot catch a stale build, for the reason above. Only body inspection can.

## Verifying before you deploy

```
npm run verify:container            # build, run, probe
npm run verify:container:selftest   # also prove the check still fails on the known-bad image
```

`scripts/verify-relay-container.mjs` builds the image, starts the container on an ephemeral loopback port, and asserts three things:

1. The container is still running after startup.
2. `GET /vapid-key` returns JSON with a non-empty `publicKey`, and not the catch-all `OK`.
3. A WebSocket upgrade to `/room/{32 hex}` returns `101 Switching Protocols`.

The `--selftest` flag first runs the whole check against an inlined copy of the one-file Dockerfile that caused the outage and requires it to fail. A check nobody has watched fail is not yet evidence of anything, and this one has to keep failing on the case it was written for.

This runs in CI as the **Relay container boots** job on every pull request. It needs Docker, so it is not wired into `npm run gate`, which is expected to run on a machine without a container runtime.

Requires Docker locally. The script cleans up its own container and image, including on failure. Pass `--keep` to leave them up for debugging.
