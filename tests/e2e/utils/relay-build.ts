import {
	computeRelayBuildId,
	RELAY_BUILD_HEADER,
} from "../../../server/build-id";

/**
 * Refuse to run the E2E suite against a relay that is not built from the
 * working tree.
 *
 * Playwright reuses an existing server on port 3001 for every local run, and
 * the relay has no hot reload. A relay started before an edit keeps serving
 * the old code, so the suite measures a build nobody changed and reports the
 * result as green. That happened. A rate-limit change broke bulk task
 * creation and 270 local tests passed anyway.
 *
 * `reuseExistingServer: false` would fix the relay Playwright starts and
 * nothing else. It cannot see a relay someone started by hand in another
 * terminal, or one left behind by tests/e2e/relay-restart.spec.ts, and those
 * are the ones that survive across edits. Comparing fingerprints covers every
 * case, because it asks the relay what it is running instead of assuming.
 */

/**
 * Where the relay serves. Kept equal to the relay webServer entry in
 * playwright.config.ts by a structural assertion in
 * tests/unit/relay-build-id.test.ts, so the guard cannot end up probing a port
 * the suite does not use.
 */
export const RELAY_URL = "http://localhost:3001";

/** How long to keep asking, in case the health path is a moment behind. */
const PROBE_TIMEOUT_MS = 5_000;
const PROBE_INTERVAL_MS = 250;

export type RelayFreshness =
	| { current: true; buildId: string }
	| { current: false; reason: string; detail: string };

/** Short form for a message. The full digest is noise in a terminal. */
function short(buildId: string): string {
	return buildId.slice(0, 12);
}

/** The build id the relay reports, or null if it reports none. */
async function servedBuildId(url: string): Promise<string | null> {
	const res = await fetch(url, { signal: AbortSignal.timeout(2_000) });
	// Read and discard the body so the socket closes rather than being held
	// open by an unconsumed stream.
	await res.text();
	return res.headers.get(RELAY_BUILD_HEADER);
}

/**
 * Compare the running relay against the working tree.
 *
 * Returns a result and never throws, so a test can assert on the failing case
 * without taking the process down with it.
 */
export async function checkRelayIsCurrent(
	url: string = RELAY_URL,
): Promise<RelayFreshness> {
	const expected = computeRelayBuildId();

	let served: string | null = null;
	let answered = false;
	let lastError = "";
	const deadline = Date.now() + PROBE_TIMEOUT_MS;
	while (Date.now() < deadline) {
		try {
			served = await servedBuildId(url);
			answered = true;
			break;
		} catch (err) {
			lastError = err instanceof Error ? err.message : String(err);
			await new Promise((r) => setTimeout(r, PROBE_INTERVAL_MS));
		}
	}

	if (!answered) {
		return {
			current: false,
			reason: `the relay at ${url} did not answer`,
			detail:
				`Last error: ${lastError}\n` +
				"The suite cannot run without a relay, and it must not run against\n" +
				"one it cannot identify.",
		};
	}

	if (served === null) {
		return {
			current: false,
			reason: `the relay at ${url} reports no ${RELAY_BUILD_HEADER} header`,
			detail:
				"Every relay built from this tree sends one. A relay without it was\n" +
				"started from source that predates the header, so it is stale by\n" +
				"definition.\n\n" +
				stopInstructions(url),
		};
	}

	if (served !== expected) {
		return {
			current: false,
			reason: `the relay at ${url} is running code that is no longer on disk`,
			detail:
				`  serving  ${short(served)}\n` +
				`  on disk  ${short(expected)}\n\n` +
				"The relay has no hot reload, so this run would exercise the old\n" +
				"relay and pass. A rate-limit regression shipped that way once:\n" +
				"270 local tests green against a relay started before the change.\n\n" +
				stopInstructions(url),
		};
	}

	return { current: true, buildId: expected };
}

function stopInstructions(url: string): string {
	const port = new URL(url).port || "80";
	return (
		"Stop it and let Playwright start a fresh one:\n\n" +
		`  kill $(lsof -ti tcp:${port} -sTCP:LISTEN)`
	);
}

/** Throw a readable failure when the relay is not built from this tree. */
export async function assertRelayIsCurrent(
	url: string = RELAY_URL,
): Promise<void> {
	const result = await checkRelayIsCurrent(url);
	if (result.current) return;
	throw new Error(
		`Stale relay: ${result.reason}.\n\n${result.detail}\n`,
	);
}
