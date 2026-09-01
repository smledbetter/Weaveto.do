/**
 * Node preload hook for the relay under load test.
 *
 * Loaded with `--import` when the harness spawns the relay. It never edits or
 * imports server/relay.ts. Both behaviours are off unless their environment
 * variable is set, so loading the hook with a clean environment is a no-op.
 *
 * 1. LOADTEST_IP_SPREAD=1
 *    Gives each accepted server socket a distinct synthetic remoteAddress.
 *
 *    Why: relay.ts keys MAX_CONNECTIONS_PER_IP on
 *    `request.socket.remoteAddress`. Every connection from one machine over
 *    loopback carries the same address, so a local harness stops at 10
 *    connections and can never reach MAX_CONNECTIONS. macOS does not route
 *    127.0.0.0/8 to loopback without adding an interface alias, which needs
 *    root and changes host network configuration, so spreading the client's
 *    source address is not available here.
 *
 *    How: net.Socket.prototype.remoteAddress is a non-configurable accessor,
 *    so the hook cannot replace it. Instead it intercepts a net.Server's
 *    "connection" event and defines an own property on each accepted socket.
 *    An own data property shadows the prototype accessor for reads, and it is
 *    fixed per socket, so the increment on connect and the decrement on close
 *    use the same key.
 *
 *    What it costs in validity: the per-IP cap is not exercised during a
 *    spread run, and `connectionsPerIp` holds one entry per synthetic address.
 *    Run the `caps` profile, which turns the hook off, to measure the real
 *    per-IP cap.
 *
 *    LOADTEST_IP_PER_ADDR=N puts N consecutive sockets on one synthetic
 *    address. Default 1, which is the worst case for the connectionsPerIp map
 *    and matches "N users behind N different addresses".
 *
 * 2. LOADTEST_STATUS_PORT=<port>
 *    Serves process.memoryUsage() as JSON on that port, so the harness can
 *    read the relay's own view of memory alongside an external `ps` sample.
 *    GET /?gc=1 runs a full collection first when the process was started with
 *    --expose-gc, which separates retained memory from uncollected garbage.
 *    Sockets belonging to this status server are excluded from the spread.
 *    LOADTEST_STATUS_HOST changes the bind address. It defaults to 127.0.0.1
 *    and is set to 0.0.0.0 only when the relay runs inside a container and the
 *    harness reads the endpoint through a published port.
 */

import net from "node:net";
import http from "node:http";

let handedOut = 0;
let statusServer = null;

/**
 * tsx runs the target script in a child process, so NODE_OPTIONS loads this
 * hook into both the tsx launcher and the process that actually serves the
 * relay. Only the latter should patch sockets or bind the status port.
 *
 * In the serving process argv[1] is the script itself. In the tsx launcher
 * argv[1] is tsx's cli.mjs and the script name is only a later argument, so
 * checking argv[1] alone separates the two.
 */
const isRelayProcess = (process.argv[1] ?? "").endsWith("relay.ts");

if (isRelayProcess && process.env.LOADTEST_IP_SPREAD === "1") {
  const perAddr = Math.max(1, parseInt(process.env.LOADTEST_IP_PER_ADDR || "1", 10) || 1);
  const originalEmit = net.Server.prototype.emit;

  net.Server.prototype.emit = function patchedEmit(event, ...rest) {
    if (event === "connection" && this !== statusServer) {
      const socket = rest[0];
      if (socket && typeof socket === "object") {
        const slot = Math.floor(handedOut / perAddr);
        handedOut += 1;
        Object.defineProperty(socket, "remoteAddress", {
          value: `10.${(slot >> 16) & 0xff}.${(slot >> 8) & 0xff}.${slot & 0xff}`,
          writable: false,
          enumerable: true,
          configurable: true,
        });
      }
    }
    return originalEmit.call(this, event, ...rest);
  };

  process.stderr.write(
    `[relay-hook] address spread on, ${perAddr} connection(s) per synthetic address\n`,
  );
}

const statusPort = parseInt(process.env.LOADTEST_STATUS_PORT || "0", 10);
if (isRelayProcess && statusPort > 0) {
  statusServer = http.createServer((req, res) => {
    if (req.url && req.url.includes("gc=1") && typeof globalThis.gc === "function") {
      globalThis.gc();
    }
    const mem = process.memoryUsage();
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        pid: process.pid,
        uptimeSec: process.uptime(),
        gcAvailable: typeof globalThis.gc === "function",
        syntheticAddressesHandedOut: handedOut,
        memory: {
          rss: mem.rss,
          heapTotal: mem.heapTotal,
          heapUsed: mem.heapUsed,
          external: mem.external,
          arrayBuffers: mem.arrayBuffers,
        },
      }),
    );
  });
  statusServer.unref();
  statusServer.on("error", (err) => {
    // The status endpoint is a measurement convenience. Losing it must not
    // take the relay down, because then the run would measure nothing.
    process.stderr.write(`[relay-hook] status endpoint unavailable: ${err.message}\n`);
  });
  const statusHost = process.env.LOADTEST_STATUS_HOST || "127.0.0.1";
  statusServer.listen(statusPort, statusHost, () => {
    process.stderr.write(
      `[relay-hook] status endpoint on ${statusHost}:${statusPort} (relay pid ${process.pid})\n`,
    );
  });
}

/**
 * 3. LOADTEST_PUSH_STUB=<port>
 *    Answers the relay's outbound push requests from a stub on this host.
 *
 *    Why: the relay refuses a push endpoint that is not https, and refuses any
 *    host resolving to an address that is not publicly routable. That is the
 *    point of the check, and it means the harness can no longer run a plain
 *    HTTP stub on loopback and point subscriptions at it.
 *
 *    How: it replaces `createConnection` on the https global agent, so
 *    requests to one designated hostname get a plain TCP socket to the
 *    harness's stub instead of a TLS socket to the internet. Everything else
 *    connects normally.
 *
 *    Why that seam and not https.request: patching the module does not work.
 *    Named exports of a builtin are snapshotted when an importing module is
 *    instantiated, so `https.default.request = fn` leaves `import * as https`
 *    consumers calling the original, and an ESM namespace object cannot be
 *    assigned to at all. A hook written that way fails silently: the profile
 *    reports zero pushes against a relay that is working. The agent is an
 *    ordinary mutable object that ClientRequest looks up at request time, so
 *    patching it actually takes effect. Verified before it was relied on.
 *
 *    What it costs in validity, stated plainly: the connection is replaced, so
 *    this measures the fan-out decisions — who gets pushed, how often, how
 *    many at once — and NOT the address guard or TLS. The address guard is
 *    pure logic covered by tests/unit/push-endpoint.test.ts. Do not read a
 *    push profile run as evidence that the guard works.
 */
/** The one hostname the push stub answers for. Kept in step with push.ts. */
const PUSH_STUB_HOST = "push-stub.loadtest.example";

const pushStubPort = process.env.LOADTEST_PUSH_STUB;
if (pushStubPort) {
  const https = await import("node:https");
  const net = await import("node:net");
  const agent = https.globalAgent;
  const realCreateConnection = agent.createConnection.bind(agent);

  agent.createConnection = (options, callback) => {
    const host = options?.host ?? options?.hostname ?? options?.servername;
    if (host !== PUSH_STUB_HOST) {
      // Not the stub. Let it connect for real, so an accidental outbound
      // request stays an accidental outbound request rather than being
      // quietly answered by the harness.
      return realCreateConnection(options, callback);
    }
    return net.connect(Number(pushStubPort), "127.0.0.1", callback);
  };
}
