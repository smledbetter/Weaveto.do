# Relay capacity

What `server/relay.ts` can actually carry, measured. The numbers below decide whether launch is open or invite gated, so this document is written to be argued with: every figure names the machine it came from, and everything I could not measure is called out as unmeasured rather than estimated.

Harness: `tools/loadtest/`. Run it with `npm run loadtest -- --profile=<name>`.

---

## Headline

**Fixed.** The relay now carries 5,000 connections in full rooms with no message loss. The measurements that follow are kept in two parts: what the relay did before the change, because that is the evidence the change was needed, and what it does now.

| At 5,000 connections in full rooms | Before | Now |
|---|---:|---:|
| Messages delivered | 63% | **100%** |
| p95 round trip | 9,468 ms | **1,544 ms** |
| Memory high-water | 463.3 MiB, 45% of a 1 GB machine | **238.2 MiB, 23%** |
| Load where p95 crosses one second | 256 connections | **about 4,301** |
| Load where messages start to drop | 4,301 connections | **not reached in the ramp** |

Three changes together, and the order of importance is not the order anyone expected. Read "What actually fixed it" below before quoting any of this.

### The original finding

**The declared per-connection caps were reachable and cheap. The declared caps taken together were not survivable.**

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

## Ramp: 5,000 connections, fifty members per room (before the fix)

This is the baseline. It ran against the caps as originally declared, with no backpressure. It is the same connection count under the room size those caps allowed. `handleEncrypted` relays each inbound message to every other member, so a 50-member room turns one message into 49.

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

## Ramp: 5,000 connections, full rooms, after the fix

Same profile, same container, same 1 GB and one CPU. `npm run loadtest -- --profile=fanout`. Rooms are filled to `MAX_CLIENTS_PER_ROOM`, which is now 10, so each message is relayed 9 times instead of 49.

| Target | Live | Failed | cgroup | Heap | p50 | p95 | Delivered |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 100 | 100 | 0 | 91.6 MiB | 9.9 MiB | 16.7 ms | 28.2 ms | 500/500 |
| 256 | 256 | 0 | 89.6 MiB | 10.9 MiB | 27.5 ms | 41.6 ms | 1260/1260 |
| 656 | 656 | 0 | 95.9 MiB | 13.7 MiB | 36.8 ms | 68.0 ms | 3260/3260 |
| 1050 | 1050 | 0 | 99.7 MiB | 15.3 MiB | 44.1 ms | 79.4 ms | 5250/5250 |
| 1680 | 1680 | 0 | 105.9 MiB | 15.0 MiB | 66.1 ms | 122.7 ms | 8400/8400 |
| 2688 | 2688 | 0 | 110.6 MiB | 20.0 MiB | 101.1 ms | 192.0 ms | 13430/13430 |
| 4301 | 4301 | 0 | 116.9 MiB | 24.0 MiB | 341.6 ms | 954.3 ms | 21480/21480 |
| 5200 | **5000** | 200 | 129.0 MiB | 27.2 MiB | 596.2 ms | 1544.2 ms | 24860/24860 |

High-water mark: **238.2 MiB**, 23% of the machine, against 463.3 MiB before.

Every connection the cap allows is live at every step. Nothing is dropped anywhere in the ramp. The only closes in the whole run are the 200 connections past `MAX_CONNECTIONS`, refused at upgrade exactly as designed. The old run's knee at 256 connections is gone. p95 first crosses one second at around 4,301 connections, which is 17 times further along.

Throughput at 5,000 connections:

| In | Out | Delivered | p95 |
|---:|---:|---:|---:|
| 1,243/s | 11,187/s | 100% | 380 ms |
| 2,486/s | 22,374/s | 100% | 431 ms |
| 4,972/s | 44,748/s | 100% | 427 ms |
| 9,944/s | 89,496/s | **100%** | 2,124 ms |
| 19,888/s | 178,992/s | 64% | 3,545 ms |

Before the change, 60,760 outbound per second already lost 4% and sat at a 9.2 second p95. Now 89,496 per second is delivered in full. Loss appears between there and 178,992.

## What actually fixed it

Three changes shipped together. Attributing the result to the headline one would be wrong.

**The cap cuts did nearly all of the work.** `MAX_CLIENTS_PER_ROOM` from 50 to 10 cuts amplification from 49x to 9x, which is a 5.4x reduction in outbound work for one constant. That is the change the numbers above are mostly measuring.

**Backpressure did not fire once in this run.** Not a single socket was terminated for backlog. The harness's clients all drain promptly, so the condition it guards never arose. It is a safety net for a member who cannot keep up, and its coverage here is unit-level, in `tests/unit/relay-backpressure.test.ts`. Do not read the 238 MiB figure as evidence that backpressure works. It is evidence that with the caps cut, the relay never needed it.

**Splitting the rate limit was necessary to make the cap cut shippable at all.** This is the part worth writing down, because taking the original recommendation at face value would have shipped a broken relay.

The recommendation was to cut `MSG_RATE_LIMIT` from 30 to 5, on the reasoning that nothing in a task app needs 30 messages per second. That is true of what a person does. It is not true of what the protocol does. Joining or re-keying sends one `key_share` per member in a tight loop with no pacing, so a client in a full room legitimately emits 9 frames back to back. A limit of 5 disconnects that with close 4029. Key rotation would have broken itself in any room larger than about four people, and every declared cap would still have measured as a match.

`encrypted` is the only type the relay broadcasts, so it is the only type that multiplies. Everything else is routed to one peer. The limit is now two budgets: a loose global one checked before parsing, which has to clear the protocol's own burst, and a tight one on `encrypted` alone, which is what bounds fan-out. `--profile=caps` checks the burst directly, so this cannot regress silently.

**The budget is averaged over four seconds rather than policed each second.** A one second window charges a client for the arrival pattern of its packets. Measured: senders pacing themselves at 4 per second against a 5 per second budget still collected 6,317 disconnects, and they began at exactly the load where the relay's own p95 crossed a second. The relay slowing down is what bunched the sends that then looked like abuse. Real clients bunch for duller reasons, a GC pause or a backgrounded tab. Averaging keeps the sustained rate, and with it the aggregate bound, identical.

### The cap cut also needed a client change

Cutting the room cap exposed something the relay could not fix on its own. The app sent one relay frame per task event, so creating tasks quickly was indistinguishable from a flood. An end-to-end test that creates 55 tasks failed: the client hit the per-connection limit, was disconnected with 4029 partway through, and lost the rest.

Raising the limit is not a fix. Nothing bounds how many tasks someone creates, so any limit can be exceeded by an ordinary user, and the app is about to add uploaded agents that emit task events faster than a person can type. Sending fewer frames is the fix. Task events are now coalesced into one frame every 250ms, which is 4 broadcast frames per second against a budget of 5, and `sendSyncEvents` already used the same shape.

Two things follow from this that are worth keeping:

**A capacity limit is only as good as the client's willingness to live inside it.** Every declared cap measured as a match while the app was still unusable at those caps. Nothing in the caps profile could have caught it, because the caps were all doing exactly what they said.

**The relay ships the configuration that was measured.** Widening the averaging window to 12 seconds was tried first as a way to absorb the burst. It worked, and it was reverted, because every number in this document was measured against four seconds. The client change removes the need for it.

### How the two budgets compose

They are not alternatives. Both are charged, so whichever binds first wins.

A client that fires everything at once is bounded by the global per-second limit, because a budget averaged over four seconds cannot be spent in one instant. One global slot is already taken by the join, so a synchronous burst gets 19 frames relayed and then the socket closes. Measured, and it matches.

A client that spreads its sending never fills the global window, so the averaged broadcast budget is what stops it. That is the case the budget exists for, and it is the one that bounds sustained outbound work.

### Two measurement errors this run caught

Both would have produced a flattering number rather than a failure, which is the harder kind to notice.

The harness kept its own copy of the relay's limits, synchronised by a comment asking for it. Its send interval was hardcoded at 100 ms, which is 10 messages per second. Legal against a 30 per second cap, illegal against 5. The first run after the cap cut showed roughly half the connections surviving and a high-water mark 2.6x better than baseline, and part of that improvement was the relay kicking the senders off. A profile that exceeds a cap is not measuring the thing it names.

The test that was supposed to prevent exactly this compared the harness copy against a third hardcoded copy written inside the test. It caught someone editing the harness. It could not catch someone editing the relay, which is the drift it existed to prevent. Both now read `server/relay.ts` directly, and `tests/unit/loadtest-profiles-legal.test.ts` fails the build if any profile generates load the relay would refuse.

## The caps as they now ship

Ordered by how much each one bought. Every row is what is in `server/relay.ts` today, not a recommendation.

| Constant | Was | Now | Why |
|---|---:|---:|---|
| `MAX_CONNECTIONS` | 5000 | **5000** | Reachable at 238 MiB peak, 23% of the machine. Not measured above 5,000. Raising it needs a new run, not arithmetic. |
| `MAX_ROOMS` | 10000 | **5000** | Was unreachable: a room needs a live client, so live rooms can never exceed live connections. It now equals the number that actually binds, so it means what a reader assumes. |
| `MAX_CLIENTS_PER_ROOM` | 50 | **10** | The dominant term, and the change that did nearly all the work. Amplification drops from 49x to 9x, a 5.4x cut in worst-case outbound work for one constant. A shared to-do list with more than ten people in it is a different product. |
| `MSG_RATE_LIMIT` | 30/s | **20/s** | A cheap pre-parse guard, not the fan-out bound. It has to clear the protocol's own worst burst, which is one `key_share` per member of a full room. Cutting it to 5 as first recommended would have disconnected every key rotation with close 4029. |
| `BROADCAST_RATE_LIMIT` | none | **5/s, averaged over 4s** | New. `encrypted` is the only type the relay multiplies, so it is the only type charged here. This is the constant that bounds the aggregate. |
| `MAX_BUFFERED_BYTES` | none | **8 x MAX_MESSAGE_SIZE** | New. A member whose outbound queue passes this is terminated rather than queued for. |
| `MAX_CONNECTIONS_PER_IP` | 10 | **10** | Verified working. No evidence to change it. |
| `MAX_MESSAGE_SIZE` | 131072 | **131072** | Verified. Rejects before parsing, which is the right order. |
| `MAX_CIPHERTEXT_LENGTH` | 65536 | **65536** | Verified. |

### What is still not bounded

Two things, both stated plainly because the result above is good enough to be quoted carelessly.

**The caps still permit more than the relay delivers cleanly.** Worst case the caps allow is `MAX_CONNECTIONS x BROADCAST_RATE_LIMIT x (MAX_CLIENTS_PER_ROOM - 1)` = 5,000 x 5 x 9 = **225,000 outbound per second**. Measured, 89,496 per second is delivered in full and 178,992 loses a third. So the permitted worst case is roughly 2.5x past the last load with no loss. That is far better than the 30x it was, and it is not a bound.

**Backpressure limits one socket, not the total.** At 8 x 128 KiB per socket and 5,000 sockets, the worst case is still **4.9 GiB on a 1 GB machine**. Backpressure decides who suffers, not how much memory the relay can reach. An honest aggregate bound needs a global outbound budget. Nobody has written one and it has not been measured.

Neither is reached by anything resembling normal use. Both are reachable by someone trying.

### For the launch decision

- **Open launch is supported by measurement.** The condition set out before the change was that the cap cut and backpressure land together and be re-measured as a pair. They have been. 5,000 connections in full rooms now delivers every message at 23% of the machine, and normal usage of small rooms and occasional messages sits several orders of magnitude below the failure region.
- **The two unbounded cases above are the residual risk, and they need an attacker, not a popular room.** That is the difference from the earlier position. Before, 250 ordinary users in five full rooms pushed p95 past a second. That is no longer true.
- **Still per process.** Rooms, push subscriptions and per-IP counts are in-process Maps. A second machine does not add capacity, it splits rooms silently, and two clients in "the same" room never see each other. This is unchanged and it caps the deployment at one machine.

---

## What I could not measure

Stated as gaps, not filled with estimates.

1. **The fly machine itself.** No deploy, no `shared-cpu-1x`. A shared vCPU is weaker than the dedicated M4 core the container had, so container latency is a floor, not a prediction. The memory figures should carry across better than the latency ones — same kernel family, same page size, same Node image — but x86-64 versus aarch64 is untested.
2. **Anything above 5,000 connections.** The relay refuses the 5,001st. Finding the real ceiling means raising `MAX_CONNECTIONS`, which is a change to `server/relay.ts`. Memory rises about 10 KiB per connection across the measured range and that number is real, but I am not multiplying it out to a capacity claim.
3. **Real network conditions.** Loopback and a Docker published port. No TLS handshake, no packet loss, no mobile radio, no reconnect storms. `fly.toml` terminates TLS at the edge so the relay should not pay for it, but that is read from configuration, not measured.
4. **The file descriptor limit on a fly machine.** 5,000 connections needs 5,000 descriptors. Comfortable here; unverified there.
5. **Sustained load.** The longest run is a few minutes. No answer on slow leaks over hours or days. The teardown check does show heap returning to 8.6 MiB after every connection closes, so nothing obvious retains per-connection state.
6. **Realistic message mix.** Every probe is an `encrypted` frame with a 1 KiB ciphertext. Real traffic includes `key_share` during joins, which is routed to one target rather than broadcast, and larger task payloads.
7. ~~**Push notification fan-out.**~~ Measured. See "The other fan-out" below.

---

## The other fan-out

`handleEncrypted` has a second amplifying path, and it is the one that leaves the machine. After relaying to every connected member it fires one outbound HTTPS request per subscribed member who is absent.

Every figure above this section was measured with that path **dormant**. No load test had ever created a push subscription, so the code never executed. `npm run loadtest -- --profile=push` now drives it against a stub push service on this host, so the cost is real without depending on a third party.

### What was wrong

| | Before |
|---|---|
| Subscriptions per room | Unbounded. Keyed by identity, so it grew with every identity that had ever subscribed while the room lived, not with the member count. `MAX_CLIENTS_PER_ROOM` did not bound it. |
| Push rate | The message rate multiplied by the absent subscribers. No limit of any kind. |
| Requests in flight | Unbounded. Fire-and-forget fetches that nothing awaited and nothing counted. |

The push also carries no payload. `sendPushNotification` posts an empty body, so twenty messages produced twenty identical contentless notifications: twenty outbound HTTPS requests to tell one person the same thing once.

### What it does now

| Constant | Value | Why |
|---|---:|---|
| `MAX_PUSH_SUBS_PER_ROOM` | `MAX_CLIENTS_PER_ROOM` | A subscription is only useful to a member, and a room can never hold more members than that at once. Full means evict the oldest, not refuse the newest: refusing hands every slot to identities that already left. |
| `PUSH_COOLDOWN_MS` | 30,000 | Bounds the push rate independently of the message rate. This is the property that matters, because without it one busy room is an unbounded outbound request rate against a third party. |
| `MAX_PUSH_IN_FLIGHT` | 64 | Push is best-effort, so shedding past the ceiling is correct rather than a compromise. |

### Measured

`npm run loadtest -- --profile=push`. The relay is started by the harness on this host, because the stub push service has to be reachable from it.

| Check | Expected | Observed |
|---|---:|---:|
| Pushes to one absent subscriber over 12 messages in 3 seconds | 1 | **1** |
| Subscriptions surviving after 15 identities subscribe to one room | 10 | **10** |
| Peak concurrent push requests with 80 due at once | at most 64 | **64** |
| Pushes to a subscription the service reported 410 Gone | 1 | **1** |

The in-flight figure is worth reading carefully. 80 requests were due and the stub held each response open for 1.5 seconds, so the load was well past the ceiling and the ceiling is what stopped it. A lower number would have meant the probe was too weak to reach it.

### One behaviour worth knowing

Push subscriptions do not survive an empty room. A room is deleted the moment its last client disconnects, and `deleteRoomState` takes its subscriptions with it. So a room everyone has left notifies nobody when the next message arrives, which cannot happen anyway because there is no one there to send it.

This is a consequence of the relay holding no state, not a defect, but it does mean push only works while at least one member is connected. It also cost a probe: the first version of the subscription-cap check had its subscribers leave an empty room, so every subscription was deleted and the check measured zero pushes against a working relay.

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
