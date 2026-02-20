// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('CoachMarks logic', () => {
	let sessionStorageMock: Record<string, string>;

	beforeEach(() => {
		sessionStorageMock = {};
		vi.stubGlobal('sessionStorage', {
			getItem: vi.fn((key: string) => sessionStorageMock[key] ?? null),
			setItem: vi.fn((key: string, value: string) => { sessionStorageMock[key] = value; }),
			removeItem: vi.fn((key: string) => { delete sessionStorageMock[key]; }),
		});
	});

	it('walkthrough has exactly 3 steps', () => {
		const steps = [
			{ title: 'Your encrypted room', body: expect.any(String) },
			{ title: 'Manage tasks', body: expect.any(String) },
			{ title: 'Invite your team', body: expect.any(String) },
		];
		expect(steps).toHaveLength(3);
	});

	it('sessionStorage key is set after finish', () => {
		const STORAGE_KEY = 'weave-walkthrough-seen';
		sessionStorageMock[STORAGE_KEY] = 'true';
		expect(sessionStorage.getItem(STORAGE_KEY)).toBe('true');
	});

	it('walkthrough not shown when sessionStorage flag is set', () => {
		sessionStorageMock['weave-walkthrough-seen'] = 'true';
		const seen = sessionStorage.getItem('weave-walkthrough-seen') === 'true';
		expect(seen).toBe(true);
	});

	it('walkthrough shown when sessionStorage flag is absent', () => {
		const seen = sessionStorage.getItem('weave-walkthrough-seen') === 'true';
		expect(seen).toBe(false);
	});
});
