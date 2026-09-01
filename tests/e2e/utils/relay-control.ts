import { spawn, execSync, type ChildProcess } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const RELAY_PORT = 3001;

/**
 * Start and stop the relay process during a test.
 *
 * The relay holds rooms in a single in-process Map, so "what happens on a
 * deploy" is only answerable by actually restarting it. Playwright's webServer
 * starts one for the suite and never restarts it, so these tests take the port
 * over for their own duration and hand it back.
 *
 * Only safe in a project that owns the relay — see the `relay-restart` project
 * in playwright.config.ts, which runs with a single worker.
 */

/** Return the pids currently listening on the relay port. */
function pidsOnPort(port = RELAY_PORT): number[] {
	try {
		const out = execSync(`lsof -ti tcp:${port} -sTCP:LISTEN`, {
			encoding: "utf8",
			stdio: ["ignore", "pipe", "ignore"],
		});
		return out.split("\n").filter(Boolean).map(Number);
	} catch {
		return []; // lsof exits non-zero when nothing is listening
	}
}

/** True once the relay answers its HTTP health path. */
async function isUp(port = RELAY_PORT): Promise<boolean> {
	try {
		const res = await fetch(`http://localhost:${port}/`, {
			signal: AbortSignal.timeout(1_000),
		});
		return res.ok;
	} catch {
		return false;
	}
}

async function waitFor(
	predicate: () => Promise<boolean>,
	timeoutMs: number,
	label: string,
): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (await predicate()) return;
		await new Promise((r) => setTimeout(r, 150));
	}
	throw new Error(`timed out after ${timeoutMs}ms waiting for ${label}`);
}

/**
 * Every relay this module has started and not yet stopped.
 *
 * handBackRelay used to start one and throw the handle away, so each run left
 * a relay listening on the port forever. Playwright could not clean it up
 * either: its own webServer relay is the one the first test kills, so by the
 * end there is nothing left for it to stop. Tracking them is what makes the
 * teardown below able to assert it left nothing behind.
 */
const started: ChildProcess[] = [];

/** Kill every process listening on the relay port and wait for the port to free. */
export async function stopRelay(): Promise<void> {
	// Kill the process groups this module started first. `tsx` runs the relay in
	// a grandchild, so killing the direct child leaves the grandchild holding
	// the port. Killing the group takes both.
	while (started.length > 0) {
		const child = started.pop()!;
		try {
			if (child.pid !== undefined) process.kill(-child.pid, "SIGKILL");
		} catch {
			// already gone, or never became a group leader
		}
	}

	// Then sweep the port, which catches anything started outside this module.
	for (const pid of pidsOnPort()) {
		try {
			process.kill(pid, "SIGKILL"); // SIGKILL: we are simulating a hard loss
		} catch {
			// already gone
		}
	}
	await waitFor(async () => !(await isUp()), 10_000, "relay port to free");
}

/** Start a relay and wait until it serves. Returns the child for cleanup. */
export async function startRelay(): Promise<ChildProcess> {
	const child = spawn("npx", ["tsx", "server/relay.ts"], {
		cwd: ROOT,
		env: { ...process.env, PORT: String(RELAY_PORT) },
		stdio: "ignore",
		// Its own process group, so stopRelay can take the tsx grandchild with
		// it rather than orphaning the process that actually holds the port.
		detached: true,
	});
	child.unref();
	started.push(child);
	await waitFor(isUp, 20_000, "relay to start");
	return child;
}

/**
 * Stop everything this module started and prove the port is free.
 *
 * Throws rather than warns. A leaked relay is silent and outlives the run, and
 * the next run then tests whatever code that stale process was started from.
 * The staleness guard now catches that, but only after someone has spent a
 * while confused, so it is cheaper to fail here.
 */
export async function releaseRelay(): Promise<void> {
	await stopRelay();
	if (await isUp()) {
		throw new Error(
			`a relay is still serving on ${RELAY_PORT} after teardown. ` +
				"Something started one without going through startRelay.",
		);
	}
}

/**
 * Kill the relay and bring a fresh one up — a deploy, from the client's side.
 * The new process shares nothing with the old one.
 */
export async function restartRelay(): Promise<ChildProcess> {
	await stopRelay();
	return startRelay();
}

/**
 * Stop a relay started by this helper and leave a fresh one serving the suite.
 *
 * The relay it starts is tracked, so releaseRelay can stop it when the file is
 * done. Every test after the first needs one to connect to, which is why this
 * cannot simply leave the port empty.
 */
export async function handBackRelay(child: ChildProcess | null): Promise<void> {
	if (child && !child.killed) {
		child.kill("SIGKILL");
	}
	await stopRelay();
	await startRelay();
}
