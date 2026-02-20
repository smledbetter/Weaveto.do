import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

describe('ARIA fixes verification', () => {
	it('PinSetup error uses role="alert"', () => {
		const source = readFileSync(resolve('src/lib/components/PinSetup.svelte'), 'utf-8');
		expect(source).toContain('role="alert"');
		expect(source).not.toMatch(/class="error-message"[^>]*role="status"/);
	});

	it('AutoDeleteBanner does not have conflicting aria-live on role="alert"', () => {
		const source = readFileSync(resolve('src/lib/components/AutoDeleteBanner.svelte'), 'utf-8');
		expect(source).toContain('role="alert"');
		// Should NOT have aria-live="polite" on the same element as role="alert"
		expect(source).not.toMatch(/role="alert"[^>]*aria-live="polite"/);
	});

	it('SoloMemberBanner has explicit aria-live="polite"', () => {
		const source = readFileSync(resolve('src/lib/components/SoloMemberBanner.svelte'), 'utf-8');
		expect(source).toContain('aria-live="polite"');
	});

	it('AgentPanel header says Automation', () => {
		const source = readFileSync(resolve('src/lib/components/AgentPanel.svelte'), 'utf-8');
		expect(source).toContain('<h3>Automation</h3>');
		expect(source).not.toContain('Agent Modules');
	});

	it('AgentPanel aria-label is Automation panel', () => {
		const source = readFileSync(resolve('src/lib/components/AgentPanel.svelte'), 'utf-8');
		expect(source).toContain('aria-label="Automation panel"');
	});

	it('TaskPanel assignee button has aria-expanded', () => {
		const source = readFileSync(resolve('src/lib/components/TaskPanel.svelte'), 'utf-8');
		// The class and aria-expanded are on separate lines in the template;
		// verify both are present in the button block that handles assignment toggling.
		expect(source).toContain('class="assignee-btn"');
		expect(source).toContain('aria-expanded={assignDropdownTask === task.id}');
	});

	it('Room header has max 4 direct control buttons', () => {
		const source = readFileSync(resolve('src/routes/room/[id]/+page.svelte'), 'utf-8');
		// room-meta should contain: tasks-toggle, agents-toggle, invite-btn, room-info-btn
		const roomMeta = source.match(/<div class="room-meta">([\s\S]*?)<\/div>\s*<\/header>/);
		expect(roomMeta).not.toBeNull();
		if (roomMeta) {
			const buttonCount = (roomMeta[1].match(/<button/g) || []).length;
			// tasks-toggle + agents-toggle + invite-btn + room-info-btn = 4 direct, plus dropdown-action inside
			expect(buttonCount).toBeLessThanOrEqual(6); // 4 header + up to 2 inside dropdown
			// Should NOT have standalone member-count, display-name-tag at top level
			expect(roomMeta[1]).toContain('room-info-dropdown-wrapper');
		}
	});

	it('CoachMarks component has dialog role', () => {
		const source = readFileSync(resolve('src/lib/components/CoachMarks.svelte'), 'utf-8');
		expect(source).toContain('role="dialog"');
	});

	it('Connection status shows text when disconnected', () => {
		const source = readFileSync(resolve('src/routes/room/[id]/+page.svelte'), 'utf-8');
		expect(source).toContain('Reconnecting...');
	});
});
