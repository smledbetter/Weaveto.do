# Deployment

How the WebSocket relay gets to production, what it cannot do, and how to tell whether the thing running is the thing you built.

## What is deployed

| Piece | Target | Config |
|-------|--------|--------|
| Client | Vercel, via `@sveltejs/adapter-auto` | `svelte.config.js` |
| Relay | Fly.io app `weaveto-relay`, region `ord` | `fly.toml`, `server/Dockerfile` |

The two are deployed separately. The client reaches the relay over `VITE_RELAY_URL`, which is read at **build time** in `src/lib/room/session.ts`. A client build without that variable falls back to `<current hostname>:3001`, which is correct in dev and wrong in production. Changing the relay hostname therefore needs a client rebuild, not just a relay deploy.

## Deploying the client

The Vercel project is connected to this repository, so a merge to `main` builds and promotes to production on its own. There is nothing to run by hand.

That connection is worth stating because it was absent for months and nobody noticed. The project had been created with `vercel link` and deployed once from a laptop, so the live site sat frozen at that build while `main` moved on. Every symptom pointed elsewhere: the site loaded, rooms opened, messages sent.

**The two halves can drift apart, and the relay is the half that moves first.** A relay deploy takes effect immediately for every connected client, while a client change reaches people only as their browser picks up a new build. So a protocol change has to be backward compatible with the client that is already out there, in that direction specifically. Display names moved into the encrypted key share this way: the relay stopped sending `displayName` in `member_list` while the deployed client still read that field, which shows other members with no name until the client catches up.

If the site looks stale, check that a deployment exists for the commit before assuming a build problem. A Vercel deployment appears on the repository as a GitHub deployment and as a check on the pull request. No deployment and no check means the integration is not connected, which is a different fault from a failed build and is fixed in Project, Settings, Git.

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
| Rooms | 5,000 | Bounded by connections in practice. `removeClient()` deletes a room when its last client leaves, so live rooms can never exceed live connections. Set to the number that actually binds. |
| Total connections | 5,000 | Real. Enforced exactly. Connection 5,001 gets HTTP 503. |
| Clients per room | 10 | Real, and the number that decides everything below. Each message is relayed to the other 9. |
| Connections per IP | 10 | Real. Verified against the deployed relay, not just locally. |
| Messages per second per connection | 20 | Real. A cheap guard checked before parsing. It has to clear the protocol's own burst: re-keying sends one `key_share` per member with no pacing. |
| Broadcast messages per second | 5, averaged over 4s | Real. `encrypted` is the only type the relay multiplies, so it is the only type charged here. This is the constant that bounds fan-out. |

That is the capacity ceiling until routing changes. **Do not raise the machine count to get past it.** Horizontal scale requires routing every connection for a room ID to the same process, which is not implemented. Adding a second machine does not add capacity, it corrupts room membership.

Full method, caveats and per-scenario numbers are in `docs/CAPACITY.md`. The summary that matters for deployment is below.

### Fan-out was the constraint, and it was fixed

This section used to say the relay collapsed inside its own caps: at 5,000 connections in 50-member rooms, 37% of messages never arrived and memory peaked at 463 MiB, 45% of the machine. `handleEncrypted()` called `ws.send()` once per member without ever checking `ws.bufferedAmount`, so outbound frames queued without bound.

Measured now, same container, same 1 GB and one CPU:

| At 5,000 connections in full rooms | Before | Now |
|---|---:|---:|
| Messages delivered | 63% | **100%** |
| p95 round trip | 9,468 ms | **1,544 ms** |
| Memory high-water | 463 MiB | **238 MiB** |

**Read the attribution before quoting this.** Cutting clients per room from 50 to 10 did nearly all of it, because it drops amplification from 49x to 9x. Backpressure never fired in that run at all: the harness's clients drain promptly, so the condition it guards never arose. It is a safety net for a slow member, covered by unit tests rather than by these numbers.

Two things are still not bounded, and both are in `docs/CAPACITY.md` rather than implied away. The caps permit 225,000 outbound messages per second against a measured clean ceiling near 89,000. And a per-socket backlog allowance times 5,000 sockets is 4.9 GiB on a 1 GB machine, because backpressure decides who suffers rather than how much memory the relay can reach.

Neither is reached by anything resembling normal use. Both are reachable by someone trying.

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

The relay runs as PID 1. Linux delivers a signal from an ancestor namespace to PID 1 only if PID 1 registered a handler, with no default-disposition fallback. Bare node registers nothing until JS calls `process.on()`, which is the reason `tini` and `docker run --init` exist.

**That trap is live in this image, and the SIGTERM handler in `server/relay.ts` is what avoids it.** Measured with an explicit timeout:

| Shape | `docker stop -t 10` | Exit code |
|---|---|---|
| Bare node as PID 1, no handler | 10.18s | 137 (SIGKILLed at the timeout) |
| Shipped CMD with the `relay.ts` handler | 2.51s | 0 (handler exited cleanly) |

The image and the handler are a pair. This Dockerfile supplies a container that boots; `server/relay.ts` supplies the drain. Ship the image without that handler and every deploy stalls for the full `kill_timeout` and then hard-kills every socket — the mass disconnect this configuration exists to avoid.

**Always pass an explicit `-t` when re-checking.** Docker Desktop's default stop timeout is about a second, so both shapes return in roughly 1.2s and the comparison tells you nothing. An earlier revision of this document drew the wrong conclusion from exactly that, and then attributed the result to node, and then to tsx. Neither was right.

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
