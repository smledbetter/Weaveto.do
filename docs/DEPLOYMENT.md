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

A single `shared-cpu-1x` machine with 1GB of memory. These are the limits declared in `server/relay.ts`. **Declared is not the same as reachable, and not the same as safe.**

| Limit | Declared | Reality |
|-------|----------|---------|
| Rooms | 10,000 | Unreachable. `removeClient()` deletes a room when its last client leaves, so live rooms are bounded by live connections, which cap at 5,000. This limit is dead code. |
| Total connections | 5,000 | Real. Enforced exactly. Connection 5,001 gets HTTP 503. |
| Clients per room | 50 | Declared, but not safe at scale. See below. |
| Connections per IP | 10 | Real. |
| Messages per second per connection | 30 | Real. |

That is the capacity ceiling until routing changes. **Do not raise the machine count to get past it.** Horizontal scale requires routing every connection for a room ID to the same process, which is not implemented. Adding a second machine does not add capacity, it corrupts room membership.

Full method, caveats and per-scenario numbers are in `docs/CAPACITY.md`. The summary that matters for deployment is below.

### Memory is not the constraint. Fan-out is.

At 5,000 connections with 2 members per room the relay is comfortable. Steady cgroup memory is about 102 MiB, peak about 130 MiB, p95 latency about 21 ms, and no messages are lost.

Fill rooms to the declared 50 clients each and it collapses inside its own caps. At 5,000 connections **37% of messages fail to arrive within 10 seconds**, p95 pins at the timeout, and cgroup memory peaks at about 463 MiB, which is 45% of the machine. Reproduced three times.

The cause is in `handleEncrypted()`. It calls `ws.send()` once per room member and never checks `ws.bufferedAmount`, so outbound frames queue without bound. The evidence that it is queued frames rather than application state is that `arrayBuffers` reached 100.5 MiB while the JS heap stayed at 29.4 MiB.

**Treat 50 clients per room as a declared limit that the relay cannot currently serve.** Fixing it means backpressure in `server/relay.ts`, which is not a deployment change.

### Idle memory baseline

Measured on the image this repo builds, on linux/arm64, in a 1GB cgroup with one CPU, before any client connects:

| Source | Idle |
|--------|------|
| `memory.current` for the cgroup | ~56 to 64 MiB |
| Summed RSS of the two processes | ~100 to 105 MiB |

**Use the cgroup figure.** Summed RSS roughly doubles the real number because the relay process and the esbuild service share the Node binary and its libraries, and RSS counts those shared pages once per process. The cgroup counts them once.

Subtract the cgroup figure, not the RSS figure, before reading any per-connection number.

### Do not quote a sampled memory figure

Periodic sampling understates this relay by about four times. During the fan-out test the highest per-step sample was 121 MiB while the true peak was 463 MiB. The relay allocates outbound queues in bursts that a sampling interval walks straight past.

**`memory.peak` for the cgroup is the honest source.** Any alert threshold or capacity figure derived from `memory.current` polling, `docker stats`, or a per-step reading is wrong in the unsafe direction. This applies to the numbers in this document too, which is why the ones above are cgroup peaks rather than samples.

## What a deploy does to live rooms

A deploy replaces the machine, so the process dies and every `Map` goes with it. Concretely, at the moment of deploy:

- Every connected client is disconnected.
- Every room registry entry is destroyed, including the creator identity key and the ephemeral flag.
- Every push subscription registered with the relay is dropped. Clients re-register on reconnect.

Task data survives, because it is event-sourced client-side and the relay only ever routed ciphertext. What is lost is routing state and session continuity. Clients must reconnect and re-establish.

There is no zero-downtime path for this design. A rolling deploy would mean two processes alive at once, which is the split-room failure above. **Treat every relay deploy as a full disconnect of all active sessions.**

### How the shutdown itself behaves

The disconnect is unavoidable. Whether it is abrupt or orderly depends on two things that live in different files, and it is worth knowing which supplies which.

**Signal delivery is settled by the image.** The container runs `node` as PID 1. Linux delivers a signal from an ancestor namespace to PID 1 only if PID 1 registered a handler, with no default-disposition fallback, so a PID 1 that ignores SIGTERM stalls until `kill_timeout` and is then SIGKILLed. That trap does not apply here, because node installs its own handlers for SIGINT, SIGTERM and SIGHUP. Measured against this image, `docker stop` returns in about 1.2 seconds rather than stalling to the timeout.

**Draining is not.** Node's default handler exits immediately. It does not stop accepting, warn clients, or let in-flight frames finish, so every socket dies at once. An orderly drain requires a SIGTERM handler in `server/relay.ts`. Do not remove such a handler on the assumption that PID 1 handles it. Delivery and draining are different problems, and only the first is solved here.

`fly.toml` sets no `kill_timeout`, so the Fly default of 5 seconds applies. **If you ever set it, keep it comfortably above the drain.** A drain that takes longer than `kill_timeout` is cut off mid-flight and you are back to a hard kill, having paid for the drain logic and not received it.

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
