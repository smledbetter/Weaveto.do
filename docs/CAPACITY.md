# Relay capacity

What `server/relay.ts` can actually carry, measured. The numbers below decide whether launch is open or invite gated, so this document is written to be argued with: every figure names the machine it came from, and everything I could not measure is called out as unmeasured rather than estimated.

Harness: `tools/loadtest/`. Run it with `npm run loadtest -- --profile=<name>`.

---

## Headline

**The declared per-connection caps are reachable and cheap. The declared caps taken together are not survivable.**

- 5,000 concurrent connections is real. It costs 130 MiB of a 1 GB machine and the relay stays under 21 ms p95. Memory is nowhere near the limit.
- `MAX_ROOMS = 10_000` can never be reached. A room is deleted the moment its last client leaves, so the live room count is bounded by the live connection count, which is capped at 5,000. The constant reads like a guard rail and is dead.
- Fill rooms to the declared `MAX_CLIENTS_PER_ROOM = 50` and the relay falls over well inside its own caps. At 5,000 connections in 50-member rooms, 31% of messages failed to arrive within 10 seconds, p95 sat at the timeout ceiling, and memory peaked at **463 MiB, 45% of the machine**, from a load every declared cap permits.

The caps are each enforced correctly. The problem is that they multiply, and nothing bounds the product.

---

## Where the numbers come from

Three machines, none of them a fly machine.

| | This laptop | Container | fly target |
|---|---|---|---|
| CPU | Apple M4, 10 cores | 1 core quota (`--cpus=1`) | `shared-cpu-1x`, a shared vCPU |
| Memory | 34.4 GB | 1 GB cgroup limit | 1 GB |
| Kernel / arch | macOS 26.6.2, arm64 | Linux, aarch64 | Linux, x86-64 |
| Page size | 16 KiB | 4 KiB | 4 KiB |
| Node | v22.19.0 | v22.23.2 (`node:22-slim`) | `node:22-slim` |
| Network to relay | loopback | Docker published port | fly proxy, TLS terminated at the edge |

**Read the container column, not the laptop column — and do not compare the two directly.** I have two idle figures for the old three-process image, 230 MiB on the laptop and 106 MiB in the container, and they are different measurements rather than one measurement on two machines. The laptop figure is RSS summed across the three processes, and RSS counts the shared Node binary and its libraries once per process, so summing overstates the footprint. The container figure is the cgroup's `memory.current`, which charges shared pages once. There is no cgroup equivalent on macOS, so that gap cannot be cleanly split between the metric mismatch and 16 KiB pages against 4 KiB, and guessing the split would be inventing a number. Every memory figure quoted below is a container cgroup reading unless it says otherwise.

The same caution applies to this harness. When it starts its own relay, the `treeRss` column sums `ps` RSS across the process tree and carries the same inflation — **do not quote it as a footprint**. Pointed at a container, that column is fed `memory.current` through `--rss-cmd` and is sound. Credit to the deploy agent for catching this class of error in a published baseline, which is what sent me back to my own.

**Latency does not transfer from either.** The container reaches 5,000 connections on one core of an M4, which is faster than a fly shared vCPU, and the harness talks to it through Docker's published port, which adds delay a real client would not see. Treat container latency as a shape, not a value: it shows where degradation starts relative to load, not what a user in Chicago will feel.

The container runs the real `server/Dockerfile` from `p0/relay-container` unmodified. `server/relay.ts` is byte-identical between that branch and `p0/make-gates-real`, so the relay under test is the relay that ships. The earlier `p0/make-gates-real` Dockerfile could not boot at all — it copied only `relay.ts` while the relay imports `./vapid.js` and `./push-types.js`, so the image exited with `ERR_MODULE_NOT_FOUND` on start. Early exploratory runs bind-mounted the two missing files to get past it; every number in this document is from the fixed image, with no bind-mount.

**These figures describe `relay.ts` as of `p0/make-gates-real`.** `p0/relay-hardening` changes connection accounting after this run: half-open sockets reaped on a 30-second heartbeat with their slots released, the per-IP cap keyed on `Fly-Client-IP` behind a trust gate rather than the proxy address, and a draining SIGTERM. Connection-count figures should be re-measured against that branch before they are relied on. The fan-out finding is unaffected — that branch does not touch the `handleEncrypted` loop.

### Reproducing

```
docker build -f server/Dockerfile -t weaveto-relay .
docker run -d --name weaveto-relay-lt --memory=1g --memory-swap=1g --cpus=1 \
  -p 3081:3001 -p 4081:4001 \
  -v "$PWD/tools/loadtest/relay-hook.mjs:/app/relay-hook.mjs:ro" \
  -e "NODE_OPTIONS=--import=file:///app/relay-hook.mjs --expose-gc" \
  -e LOADTEST_IP_SPREAD=1 -e LOADTEST_STATUS_PORT=4001 -e LOADTEST_STATUS_HOST=0.0.0.0 \
  weaveto-relay

npm run loadtest -- --profile=full --attach=3081 \
  --status-url=http://127.0.0.1:4081/ \
  --rss-cmd='docker exec weaveto-relay-lt awk "{print int(\$1/1024)}" /sys/fs/cgroup/memory.current' \
  --peak-cmd='docker exec weaveto-relay-lt awk "{print int(\$1/1024)}" /sys/fs/cgroup/memory.peak'
```

Without `--attach` the harness starts its own relay on this host and measures that instead.

---

## The per-IP workaround, and what it costs

`relay.ts` keys `MAX_CONNECTIONS_PER_IP` on `request.socket.remoteAddress`. Every connection from one test machine carries the same address, so an honest local harness stops at 10 connections and can never reach `MAX_CONNECTIONS`. Two ways out were rejected:

- Adding loopback aliases (`ifconfig lo0 alias 127.0.0.2`) needs root and changes host network configuration. macOS does not route `127.0.0.0/8` without them; binding a client to `127.0.0.2` returns `EADDRNOTAVAIL`.
- Editing `relay.ts` to make the cap configurable. Out of bounds, and it would mean measuring a relay that is not the relay.

What the harness does instead: `tools/loadtest/relay-hook.mjs`, attached with `--import` through `NODE_OPTIONS`, gives each accepted socket a distinct synthetic `remoteAddress`. `relay.ts` is neither edited nor imported. The hook does nothing unless `LOADTEST_IP_SPREAD=1` is set.

**What this costs in validity, stated plainly:**

1. **The per-IP cap is not exercised during a spread run.** It is measured separately, with the hook off, by `--profile=caps`. It holds at exactly 10.
2. **One synthetic address per connection is the worst case for `connectionsPerIp`,** which ends up holding 5,000 entries instead of a handful. That inflates the measured memory rather than flattering it.
3. **The hook adds a status HTTP server inside the relay process.** It is one idle listener; its cost is inside the reported idle baseline, not subtracted from it.
4. **Nothing else about the relay changes.** The hook touches `net.Server.prototype.emit` for the `connection` event and nothing else.

A run without the hook confirms the arrangement is not hiding anything structural: it reaches 10 connections and then gets HTTP 429, exactly as the code says it should.

---

## Every declared cap, checked one at a time

`npm run loadtest -- --profile=caps`. Each row is what the relay actually did, not what the constant says.

| Cap | Declared | Observed | |
|---|---|---|---|
| `MAX_CONNECTIONS_PER_IP` | 10 | 10 accepted, 11th refused with HTTP 429 | match |
| `MAX_CLIENTS_PER_ROOM` | 50 | 50 accepted, 51st refused with `room_full` | match |
| `MSG_RATE_LIMIT` | 30/s, close 4029 | 29 messages relayed, then close 4029 | match |
| `MAX_MESSAGE_SIZE` | 131072, close 4001 | 151218-byte frame closed 4001 | match |
| `MAX_CIPHERTEXT_LENGTH` | 65536, close 4003 | 65684-byte frame closed 4003 | match |
| `ROOM_ID_PATTERN` | `/^[a-f0-9]{32}$/`, HTTP 400 | HTTP 400 at upgrade | match |
| `MAX_CONNECTIONS` | 5000, HTTP 503 | 5000 accepted, next 200 refused with 503 | match |

The rate-limit row is worth a second look because it is the check most likely to be wrong by accident. The `join` message counts against the same one-second window, so the relay accepts exactly `MSG_RATE_LIMIT - 1` further messages before closing. The harness predicted 29 before running and observed 29.

### `MAX_ROOMS` is unreachable

Not a match or a mismatch. It cannot fire.

`removeClient()` deletes a room the moment its last client leaves, so a room only exists while it holds at least one connection. Live rooms are therefore bounded by live joined connections, which `MAX_CONNECTIONS` caps at 5,000. `MAX_ROOMS` is 10,000. The check that would enforce it is on a branch that cannot be reached.

Measured rather than only argued: a room is joinable while it is occupied, and the routing entry for it is dropped once its last client disconnects. Since the relay became stateless a join for an unknown room is not refused. It reconstitutes the routing entry and reports `roomExisted: false` so the client can tell the person nobody else is there.

---

## Ramp: 5,000 connections, two members per room

`npm run loadtest -- --profile=full`. Container, 1 GB, 1 CPU. Latency is a client-to-relay-to-client round trip measured on one clock. `cgroup` is `memory.current`, the figure the 1 GB limit is enforced against.

| Target | Live | Failed | cgroup | Heap | p50 | p95 | Delivered |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 100 | 100 | 0 | 57.9 MiB | 9.9 MiB | 4.8 ms | 12.4 ms | 500/500 |
| 410 | 410 | 0 | 62.9 MiB | 11.6 MiB | 9.9 ms | 19.6 ms | 2000/2000 |
| 1050 | 1050 | 0 | 73.9 MiB | 14.5 MiB | 9.2 ms | 21.5 ms | 2000/2000 |
| 1680 | 1680 | 0 | 79.6 MiB | 16.9 MiB | 8.7 ms | 21.6 ms | 2000/2000 |
| 2688 | 2688 | 0 | 82.4 MiB | 19.6 MiB | 7.8 ms | 19.3 ms | 2000/2000 |
| 4301 | 4301 | 0 | 96.8 MiB | 25.5 MiB | 9.1 ms | 19.6 ms | 2000/2000 |
| 5200 | **5000** | 200 | 101.8 MiB | 27.0 MiB | 11.0 ms | 20.7 ms | 2000/2000 |

Idle 64.6 MiB. High-water mark across the whole run: **129.9 MiB**, 12.7% of 1 GB.

There is no knee. Nothing degrades: latency is flat from 100 connections to 5,000, no message is ever dropped, and the only failures are the 200 connections past the cap, refused with HTTP 503 exactly as designed. Memory rises about **10 KiB per connection** and stays linear across the whole range.

Message throughput at 5,000 connections, same shape:

| In | Out | Delivered | p50 | p95 |
|---:|---:|---:|---:|---:|
| 200/s | 200/s | 1000/1000 | 10.7 ms | 18.7 ms |
| 1000/s | 1000/s | 5000/5000 | 9.6 ms | 18.7 ms |
| 2000/s | 2000/s | 10000/10000 | 10.9 ms | 20.8 ms |

### Sensitivity checks

Two runs to see whether the laptop's comfort was doing the work.

- **CPU.** Throttling the container to `--cpus=0.25` still reached 5,000 connections with zero message loss and 157.8 MiB cgroup. Latency became spiky during connection bursts (p95 reached 156 ms mid-ramp) and settled to 15 ms once the ramp stopped. Connection establishment is more CPU-hungry than steady relaying.
- **V8 heap sizing.** V8 picks its heap from host memory, so a 34 GB laptop gives Node a 4144 MiB limit where a 1 GB machine gives it roughly 304-524 MiB. Re-running with `--max-old-space-size=256` moved the serving process from 140.6 to 139.4 MiB and heap from 34.4 to 32.5 MiB. The workload uses ~30 MiB of heap, so heap sizing is not a factor at this scale.

Those last two are the one exception to "container cgroup unless stated": they are laptop `ps` readings of the single serving process. That comparison is sound, and the reason is worth stating because the opposite case bit this workstream twice. A delta between two readings of **one** process is valid — same shape on both sides, shared pages counted once in each. A delta between two **summed** RSS figures whose process counts differ is not, because the double-counted binary and libraries scale with the process count, so part of the "saving" is an artefact of the metric rather than memory anyone gets back. Publish the cgroup measurement of the result, not the delta between two RSS sums.

---

## Ramp: 5,000 connections, fifty members per room

This is the same connection count under the room size the caps allow. `handleEncrypted` relays each inbound message to every other member, so a 50-member room turns one message into 49.

`npm run loadtest -- --profile=fanout`. Half of each room sends, at 10 messages per second per sender.

| Target | Live | cgroup | p50 | p95 | Delivered |
|---:|---:|---:|---:|---:|---:|
| 100 | 100 | 52.7 MiB | 9.6 ms | 37.0 ms | 500/500 |
| 160 | 160 | 55.1 MiB | 36.2 ms | 110.6 ms | 800/800 |
| 256 | 256 | 57.4 MiB | 364.4 ms | 1111.7 ms | 1260/1260 |
| 656 | 656 | 65.3 MiB | 557.7 ms | 1154.9 ms | 3260/3260 |
| 1050 | 1050 | 72.5 MiB | 1089.2 ms | 2768.8 ms | 5250/5250 |
| 1680 | 1680 | 77.5 MiB | 2142.1 ms | 4562.2 ms | 8400/8400 |
| 2688 | 2688 | 88.8 MiB | 3981.5 ms | 7742.0 ms | 13430/13430 |
| 4301 | 4301 | 108.6 MiB | 4484.4 ms | 9458.2 ms | **15888/21480** |
| 5200 | **5000** | 121.2 MiB | 4277.8 ms | 9467.6 ms | **15624/24800** |

High-water mark: **463.3 MiB**, reproduced at 464.6 MiB and 474.4 MiB on repeat runs.

The knee is at **256 connections** — five full rooms. p95 crosses one second there. Message loss starts at 4,301 connections. At 5,000 connections in full rooms, **37% of messages never arrive within 10 seconds**.

Push harder and it gets worse in the way you would expect:

| In | Out | Delivered | p95 |
|---:|---:|---:|---:|
| 1,240/s | 60,760/s | 96% | 9.2 s |
| 2,480/s | 121,520/s | 100% | 6.6 s |
| 4,960/s | 243,040/s | 65% | 9.4 s |
| 9,920/s | 486,080/s | 24% | 9.5 s |
| 19,840/s | 972,160/s | 5% | 9.6 s |

The first two rows are out of order because the sweep starts while the ramp's backlog is still draining. From 4,960/s on, the trend is clean.

### Where the 463 MiB goes

Not the JS heap. Polling the relay's own `process.memoryUsage()` ten times a second through the run:

```
max heapUsed:     29.4 MiB
max arrayBuffers: 100.5 MiB
max external:    104.4 MiB
max rss:         240.3 MiB
```

Heap barely moves while `arrayBuffers` reaches 100 MiB. That is queued outbound WebSocket frames. `handleEncrypted` calls `client.ws.send(serialized)` for every member and never consults `ws.bufferedAmount` — `grep -n "bufferedAmount" server/relay.ts` returns nothing. A member who cannot drain as fast as the room produces gets an unbounded in-memory queue, and there are up to 5,000 of them.

The gap between Node's 240 MiB RSS and the cgroup's 463 MiB is page cache and kernel socket buffers, which the cgroup charges and Node does not see. Both are real against a memory limit.

**Step sampling would have missed this entirely.** The highest per-step reading was 121.2 MiB. The spike lives between samples. Any capacity claim based on periodic sampling alone understates this relay by roughly 4x, which is why the harness now reads `memory.peak` and why this document quotes it.

### What the caps permit versus what the relay delivers

Worst case the declared caps allow: `MAX_CONNECTIONS x MSG_RATE_LIMIT x (MAX_CLIENTS_PER_ROOM - 1)` = 5,000 x 30 x 49 = **7,350,000 outbound messages per second**.

Measured: loss begins above roughly **240,000/s**, and p95 crosses one second at roughly **60,000/s**.

The declared caps permit about 30x more than the relay can deliver at all, and about 120x more than it can deliver at a latency anyone would call working.

---

## Recommended caps

Ordered by how much each one buys.

| Constant | Now | Recommend | Why |
|---|---:|---:|---|
| `MAX_CONNECTIONS` | 5000 | **5000** | Measured reachable at 130 MiB peak, 13% of the machine, flat latency. No evidence to change it. Not measured above 5,000; raising it needs a new run, not arithmetic. |
| `MAX_ROOMS` | 10000 | **5000** | Currently unreachable. Setting it to `MAX_CONNECTIONS` makes it mean what a reader assumes it means. Deleting it and documenting that `MAX_CONNECTIONS` bounds rooms is equally correct. |
| `MAX_CLIENTS_PER_ROOM` | 50 | **10** | The dominant term. Drops amplification from 49x to 9x, a 5.4x cut in worst-case outbound work for one constant. A shared to-do list with more than ten people in it is a different product. |
| `MSG_RATE_LIMIT` | 30/s | **5/s** | Nothing in a task app needs 30 messages per second per client. With a room cap of 10 this brings the worst case to 5,000 x 5 x 9 = 225,000/s, which is at the measured loss threshold rather than 30x past it. |
| `MAX_CONNECTIONS_PER_IP` | 10 | **10** | Verified working. No evidence to change it. |
| `MAX_MESSAGE_SIZE` | 131072 | **131072** | Verified. Rejects before parsing, which is the right order. |
| `MAX_CIPHERTEXT_LENGTH` | 65536 | **65536** | Verified. |

**Caps alone do not make this safe, and the recommended set should not be read as if they do.** Even the tightened numbers permit 225,000 outbound messages per second against a measured ceiling near 240,000. The caps multiply and nothing bounds the product.

The change that reduces it is a backpressure check in `handleEncrypted`: disconnect a member whose `ws.bufferedAmount` exceeds a threshold. That converts the failure from "the relay accumulates hundreds of megabytes and stops delivering for everyone" into "the worst offenders are dropped." It is a few lines, it is in `server/relay.ts`, and it is not mine to write — flagging it, not doing it. The relay agent has designed it (branch `p0/relay-hardening`) and reached the same conclusion independently, with two refinements worth recording here:

- **`terminate()`, not `close()`.** A peer that has not drained 1 MiB will not drain a close frame either. `close()` queues the frame behind the backlog and leaves the memory pinned, which is the thing being fixed.
- **Disconnect, not silent skip.** `docs/THREAT-MODEL.md` lists silent message suppression as an undefended threat. Skipping would make the relay perform that attack on itself. A disconnect is visible and the client can reconnect and re-sync.

**A per-connection ceiling still does not bound the aggregate, and this is the part that changes the launch decision.** With a 1 MiB per-socket allowance, the worst case is `MAX_CONNECTIONS x 1 MiB` = **5 GiB on a 1 GB machine**. Backpressure decides *who* suffers, not *how much* memory the relay can reach. Only the cap values bound the total, which is why the two changes are a pair: backpressure without the cap cuts still permits a 5x overshoot of the machine. With `MAX_CLIENTS_PER_ROOM` at 10 the same arithmetic is unchanged in the worst case — the honest bound comes from a global outbound budget, which nobody has written and which I have not measured.

### For the launch decision

- **Open launch, if `MAX_CLIENTS_PER_ROOM` comes down and backpressure lands, and only after the pair is re-measured together.** 5,000 connections is genuinely comfortable in 1 GB, and normal usage — small rooms, occasional messages — never approaches the failure region. But neither change has been measured, and the 5 GiB aggregate above says the two are not independently sufficient. Re-run `--profile=fanout` against the hardened relay before treating this bullet as satisfied.
- **Invite gate, if the caps ship as declared.** Not because 5,000 users is too many. Because 250 users arranged into five full rooms is enough to push p95 past a second, and 5,000 in full rooms drops a third of all messages while using 45% of the machine. That does not need an attacker, only a popular room.

One more constraint from `fly.toml`, and it is not a capacity number so much as a correctness one: rooms, push subscriptions and per-IP counts are all in-process `Map`s. Every figure here is **per process**. A second machine does not add capacity; it splits rooms silently, and two clients in "the same" room never see each other.

---

## What I could not measure

Stated as gaps, not filled with estimates.

1. **The fly machine itself.** No deploy, no `shared-cpu-1x`. A shared vCPU is weaker than the dedicated M4 core the container had, so container latency is a floor, not a prediction. The memory figures should carry across better than the latency ones — same kernel family, same page size, same Node image — but x86-64 versus aarch64 is untested.
2. **Anything above 5,000 connections.** The relay refuses the 5,001st. Finding the real ceiling means raising `MAX_CONNECTIONS`, which is a change to `server/relay.ts`. Memory rises about 10 KiB per connection across the measured range and that number is real, but I am not multiplying it out to a capacity claim.
3. **Real network conditions.** Loopback and a Docker published port. No TLS handshake, no packet loss, no mobile radio, no reconnect storms. `fly.toml` terminates TLS at the edge so the relay should not pay for it, but that is read from configuration, not measured.
4. **The file descriptor limit on a fly machine.** 5,000 connections needs 5,000 descriptors. Comfortable here; unverified there.
5. **Sustained load.** The longest run is a few minutes. No answer on slow leaks over hours or days. The teardown check does show heap returning to 8.6 MiB after every connection closes, so nothing obvious retains per-connection state.
6. **Realistic message mix.** Every probe is an `encrypted` frame with a 1 KiB ciphertext. Real traffic includes `key_share` during joins, which is routed to one target rather than broadcast, and larger task payloads.
7. **Push notification fan-out.** `handleEncrypted` fires `sendPushNotification` for every subscribed member who is offline. No subscriptions existed in any run, so that path never ran. It is an outbound HTTPS request per absent member per message, and on the numbers above it deserves its own measurement.

---

## The harness

```
tools/loadtest/
  metrics.ts         percentiles, frame parsing, close-code tally, ps parsing, ramp planning, stop rule
  protocol.ts        room ids, identity keys, join and probe builders, and a second reading of the relay's rules
  worker.ts          one forked process holding a share of the virtual clients
  run.ts             the driver: ramp, sample, probe, report
  caps.ts            one targeted check per declared cap
  profiles.ts        smoke, small, full, fanout
  relay-hook.mjs     the preload hook (address spread, memory status endpoint)
```

Profiles: `smoke` (40 connections, proves the harness works), `small` (500), `full` (5,200, overshooting the cap on purpose), `fanout` (5,200 in 50-member rooms), `caps` (the per-cap checks).

Sender and receiver of every latency probe live in the same worker process, so both timestamps come from one clock and no skew correction is needed. Workers own disjoint room ranges, so no two ever share a room.

### Its own tests

`tests/unit/loadtest-metrics.test.ts`, 56 tests, in `npm run test:unit`. It covers percentile arithmetic, relay frame classification, close-code tallying, `ps` output parsing, ramp planning, the stop rule, and — most importantly — that every identifier and message the harness puts on the wire satisfies the relay's own validation rules.

That last group is not ceremony. **The test caught a real bug in the harness before any number here was trusted.** Identity keys were padded to a key-like length with zeros, so `ltid0x1` and `ltid0x10` padded to the same string. Colliding identity keys make `handleJoin` close the older socket with code 4005, which would have shown up in the report as the relay shedding load. The padding now carries a terminator, and the test asserts 10,000 distinct keys across five workers.

Verified against deliberately broken versions, since a test that passes on a broken implementation guards nothing. Nineteen mutations, one at a time — nearest-rank percentiles instead of interpolated, `ps` kibibytes read as bytes, a dead process reported as zero memory instead of null, `room_full` misread as `server_full`, a 503 refusal blamed on the per-IP cap, a ramp that never reaches its maximum, a stop rule that ignores latency blowouts, an unclamped ciphertext, `RELAY_LIMITS` drifting from the relay's constants, and the identity-key collision above. **19 of 19 were caught.**
