// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent, cleanup, within } from '@testing-library/svelte';
import MobileNav from '$lib/components/MobileNav.svelte';

describe('MobileNav', () => {
	afterEach(() => {
		cleanup();
	});

	it('renders 3 navigation items', () => {
		const { container } = render(MobileNav, { props: {} });
		const scope = within(container);
		expect(scope.getByText('Chat')).toBeTruthy();
		expect(scope.getByText('Tasks')).toBeTruthy();
		expect(scope.getByText('Auto')).toBeTruthy();
	});

	it('highlights active view with aria-current="page"', () => {
		const { container } = render(MobileNav, { props: { activeView: 'tasks' } });
		const scope = within(container);
		const tasksBtn = scope.getByText('Tasks').closest('button');
		const chatBtn = scope.getByText('Chat').closest('button');
		expect(tasksBtn?.getAttribute('aria-current')).toBe('page');
		expect(chatBtn?.getAttribute('aria-current')).toBeNull();
	});

	it('shows task count badge when taskCount > 0', () => {
		const { container } = render(MobileNav, { props: { taskCount: 5 } });
		const scope = within(container);
		expect(scope.getByText('5')).toBeTruthy();
	});

	it('does not show task badge when taskCount is 0', () => {
		const { container } = render(MobileNav, { props: { taskCount: 0 } });
		const scope = within(container);
		expect(scope.queryByText('0')).toBeNull();
	});

	it('shows agent count badge when agentCount > 0', () => {
		const { container } = render(MobileNav, { props: { agentCount: 2 } });
		const scope = within(container);
		expect(scope.getByText('2')).toBeTruthy();
	});

	it('fires onnavigate when Tasks is clicked', async () => {
		const onnavigate = vi.fn();
		const { container } = render(MobileNav, { props: { onnavigate } });
		const scope = within(container);
		await fireEvent.click(scope.getByText('Tasks').closest('button')!);
		expect(onnavigate).toHaveBeenCalledWith('tasks');
	});

	it('fires onnavigate with "chat" when Chat is clicked', async () => {
		const onnavigate = vi.fn();
		const { container } = render(MobileNav, { props: { onnavigate } });
		const scope = within(container);
		await fireEvent.click(scope.getByText('Chat').closest('button')!);
		expect(onnavigate).toHaveBeenCalledWith('chat');
	});

	it('fires onnavigate with "automation" when Auto is clicked', async () => {
		const onnavigate = vi.fn();
		const { container } = render(MobileNav, { props: { onnavigate } });
		const scope = within(container);
		await fireEvent.click(scope.getByText('Auto').closest('button')!);
		expect(onnavigate).toHaveBeenCalledWith('automation');
	});
});
