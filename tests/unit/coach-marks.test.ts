// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/svelte';
import CoachMarks from '$lib/components/CoachMarks.svelte';

describe('CoachMarks', () => {
	beforeEach(() => {
		localStorage.clear();
	});

	afterEach(() => {
		cleanup();
		localStorage.clear();
	});

	it('renders 3 steps when usingTempIdentity is false', () => {
		const { container } = render(CoachMarks, { props: { usingTempIdentity: false } });
		const dots = container.querySelectorAll('.step-dot');
		expect(dots).toHaveLength(3);
	});

	it('renders 4 steps when usingTempIdentity is true', () => {
		const { container } = render(CoachMarks, { props: { usingTempIdentity: true } });
		const dots = container.querySelectorAll('.step-dot');
		expect(dots).toHaveLength(4);
	});

	it('step 1 mentions keys living in tab', () => {
		const { container } = render(CoachMarks, { props: {} });
		const scope = within(container);
		expect(scope.getByText(/keys live in this tab/i)).toBeTruthy();
	});

	it('shows temp identity step when usingTempIdentity is true', async () => {
		const { container } = render(CoachMarks, { props: { usingTempIdentity: true } });
		const scope = within(container);
		const nextBtn = scope.getByText('Next');
		await fireEvent.click(nextBtn);
		expect(scope.getByText('Temporary identity')).toBeTruthy();
	});

	it('does not show temp identity step when usingTempIdentity is false', async () => {
		const { container } = render(CoachMarks, { props: { usingTempIdentity: false } });
		const scope = within(container);
		await fireEvent.click(scope.getByText('Next'));
		expect(scope.getByText('Manage tasks')).toBeTruthy();
		expect(scope.queryByText('Temporary identity')).toBeNull();
	});

	it('shows solo member text in invite step when isSoloMember is true', async () => {
		const { container } = render(CoachMarks, {
			props: { isSoloMember: true, usingTempIdentity: false }
		});
		const scope = within(container);
		// Step 0 -> 1 (Manage tasks) -> 2 (Invite)
		await fireEvent.click(scope.getByText('Next'));
		await fireEvent.click(scope.getByText('Next'));
		expect(scope.getByText(/You're the only one here/)).toBeTruthy();
	});

	it('shows generic invite text when isSoloMember is false', async () => {
		const { container } = render(CoachMarks, {
			props: { isSoloMember: false, usingTempIdentity: false }
		});
		const scope = within(container);
		// Step 0 -> 1 (Manage tasks) -> 2 (Invite)
		await fireEvent.click(scope.getByText('Next'));
		await fireEvent.click(scope.getByText('Next'));
		expect(scope.queryByText(/You're the only one here/)).toBeNull();
		expect(scope.getByText(/Click Invite to share a link/)).toBeTruthy();
	});

	it('calls oncomplete when walkthrough is finished', async () => {
		const oncomplete = vi.fn();
		const { container } = render(CoachMarks, {
			props: { usingTempIdentity: false, oncomplete }
		});
		const scope = within(container);
		// Step 0 -> 1 (Manage tasks)
		await fireEvent.click(scope.getByText('Next'));
		// Step 1 -> 2 (Invite) — button reads 'Next' still
		await fireEvent.click(scope.getByText('Next'));
		// Step 2 is last — button reads 'Got it'
		await fireEvent.click(scope.getByText('Got it'));
		expect(oncomplete).toHaveBeenCalledOnce();
	});

	it('sets localStorage flag on finish', async () => {
		const { container } = render(CoachMarks, { props: { usingTempIdentity: false } });
		const scope = within(container);
		await fireEvent.click(scope.getByText('Next'));
		await fireEvent.click(scope.getByText('Next'));
		await fireEvent.click(scope.getByText('Got it'));
		expect(localStorage.getItem('weave-walkthrough-seen')).toBe('true');
	});

	it('does not render when localStorage flag is set', () => {
		localStorage.setItem('weave-walkthrough-seen', 'true');
		const { container } = render(CoachMarks, { props: {} });
		expect(container.querySelector('[role="dialog"]')).toBeNull();
	});
});
