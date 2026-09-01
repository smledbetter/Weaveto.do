import { assertRelayIsCurrent } from "./utils/relay-build";

/**
 * Runs once per Playwright invocation, after the web servers are up and before
 * any test. Playwright starts webServer entries as plugins, and plugin setup
 * runs ahead of globalSetup, so the relay is already serving here.
 *
 * The only job is to refuse a run that would measure a stale relay. Failing
 * here costs one HTTP request and stops the suite before it can report a green
 * result about code that is not on disk.
 */
export default async function globalSetup(): Promise<void> {
	await assertRelayIsCurrent();
}
