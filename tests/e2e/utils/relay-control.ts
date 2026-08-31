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

/** Kill every process listening on the relay port and wait for the port to free. */
export async function stopRelay(): Promise<void> {
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
		detached: false,
	});
	await waitFor(isUp, 20_000, "relay to start");
	return child;
}

/**
 * Kill the relay and bring a fresh one up — a deploy, from the client's side.
 * The new process shares nothing with the old one.
 */
export async function restartRelay(): Promise<ChildProcess> {
	await stopRelay();
	return startRelay();
}

/** Stop a relay started by this helper and leave a fresh one serving the suite. */
export async function handBackRelay(child: ChildProcess | null): Promise<void> {
	if (child && !child.killed) {
		child.kill("SIGKILL");
	}
	await stopRelay();
	await startRelay();
}
