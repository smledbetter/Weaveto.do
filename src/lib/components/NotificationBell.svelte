<script lang="ts">
	interface Props {
		enabled: boolean;
		quietStart: string;
		quietEnd: string;
		onToggle: (enabled: boolean) => void;
		onQuietHoursChange: (start: string, end: string) => void;
		pushSupported?: boolean;
		pushEnabled?: boolean;
		onPushToggle?: (enabled: boolean) => void;
	}

	let {
		enabled,
		quietStart,
		quietEnd,
		onToggle,
		onQuietHoursChange,
		pushSupported = false,
		pushEnabled = false,
		onPushToggle,
	}: Props = $props();

	let open = $state(false);
	let bellBtn: HTMLButtonElement | null = $state(null);
	let popover: HTMLDivElement | null = $state(null);

	function toggleOpen() {
		open = !open;
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape' && open) {
			e.stopPropagation();
			open = false;
			bellBtn?.focus();
		}
	}

	function handleClickOutside(e: MouseEvent) {
		if (!open) return;
		const target = e.target as Node;
		if (bellBtn && bellBtn.contains(target)) return;
		if (popover && popover.contains(target)) return;
		open = false;
	}

	function handleToggleChange(e: Event) {
		const checkbox = e.target as HTMLInputElement;
		onToggle(checkbox.checked);
	}

	function handleStartChange(e: Event) {
		const input = e.target as HTMLInputElement;
		onQuietHoursChange(input.value, quietEnd);
	}

	function handleEndChange(e: Event) {
		const input = e.target as HTMLInputElement;
		onQuietHoursChange(quietStart, input.value);
	}
</script>

<svelte:window onclick={handleClickOutside} onkeydown={handleKeydown} />

<div class="bell-wrapper">
	<button
		bind:this={bellBtn}
		class="bell-btn"
		onclick={toggleOpen}
		aria-label={enabled ? 'Notification settings (notifications on)' : 'Notification settings (notifications off)'}
		aria-expanded={open}
		title="Notification settings"
	>
		{enabled ? '🔔' : '🔕'}
	</button>

	{#if open}
		<div
			bind:this={popover}
			class="bell-popover"
			role="dialog"
			aria-label="Notification settings"
		>
			<div class="setting-row">
				<label class="setting-label" for="notif-toggle">Notifications</label>
				<label class="toggle-switch" aria-label="Toggle notifications">
					<input
						id="notif-toggle"
						type="checkbox"
						checked={enabled}
						onchange={handleToggleChange}
					/>
					<span class="toggle-slider"></span>
				</label>
			</div>

			<div class="setting-row quiet-hours-section">
				<span class="setting-label">Quiet hours</span>
			</div>
			<div class="quiet-hours-inputs">
				<label class="time-label" for="quiet-start">From</label>
				<input
					id="quiet-start"
					type="time"
					class="time-input"
					value={quietStart}
					onchange={handleStartChange}
					aria-label="Quiet hours start"
				/>
				<span class="time-separator">to</span>
				<input
					id="quiet-end"
					type="time"
					class="time-input"
					value={quietEnd}
					onchange={handleEndChange}
					aria-label="Quiet hours end"
				/>
			</div>

			{#if pushSupported}
				<div class="setting-row push-row">
					<label class="setting-label" for="push-toggle">Push when browser closed</label>
					<label class="toggle-switch" aria-label="Toggle push notifications">
						<input
							id="push-toggle"
							type="checkbox"
							checked={pushEnabled}
							onchange={(e) => onPushToggle?.(e.currentTarget.checked)}
						/>
						<span class="toggle-slider"></span>
					</label>
				</div>
			{/if}
		</div>
	{/if}
</div>

<style>
	.bell-wrapper {
		position: relative;
	}

	.bell-btn {
		background: none;
		border: none;
		cursor: pointer;
		font-size: 0.95rem;
		width: 1.75rem;
		height: 1.75rem;
		display: flex;
		align-items: center;
		justify-content: center;
		border-radius: 4px;
		padding: 0;
		line-height: 1;
	}

	.bell-btn:hover {
		background: var(--bg-overlay, rgba(0,0,0,0.06));
	}

	.bell-btn:focus-visible {
		outline: 2px solid var(--accent-default, #3b82f6);
		outline-offset: 2px;
	}

	.bell-popover {
		position: absolute;
		top: calc(100% + 6px);
		right: 0;
		background: var(--surface, #fff);
		border: 1px solid var(--border, #e0e0e0);
		border-radius: 8px;
		box-shadow: 0 4px 16px rgba(0, 0, 0, 0.12);
		padding: 1rem;
		min-width: 210px;
		z-index: 100;
	}

	:global(body.dark) .bell-popover {
		background: var(--bg-surface, #1e1e1e);
		border-color: var(--border, #333);
		box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
	}

	.setting-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
		margin-bottom: 0.75rem;
	}

	.setting-row:last-child {
		margin-bottom: 0;
	}

	.setting-label {
		font-size: 0.82rem;
		color: var(--text-primary, #111);
		font-weight: 500;
	}

	:global(body.dark) .setting-label {
		color: var(--text-primary, #eee);
	}

	/* Toggle switch */
	.toggle-switch {
		position: relative;
		display: inline-block;
		width: 36px;
		height: 20px;
		flex-shrink: 0;
		cursor: pointer;
	}

	.toggle-switch input {
		opacity: 0;
		width: 0;
		height: 0;
		position: absolute;
	}

	.toggle-slider {
		position: absolute;
		inset: 0;
		background: var(--border-default, #ccc);
		border-radius: 20px;
		transition: background 150ms ease;
	}

	.toggle-slider::before {
		content: '';
		position: absolute;
		width: 14px;
		height: 14px;
		border-radius: 50%;
		background: #fff;
		left: 3px;
		top: 3px;
		transition: transform 150ms ease;
	}

	.toggle-switch input:checked + .toggle-slider {
		background: var(--accent-default, #3b82f6);
	}

	.toggle-switch input:checked + .toggle-slider::before {
		transform: translateX(16px);
	}

	.toggle-switch input:focus-visible + .toggle-slider {
		outline: 2px solid var(--accent-default, #3b82f6);
		outline-offset: 2px;
	}

	/* Quiet hours */
	.quiet-hours-section {
		margin-bottom: 0.4rem;
	}

	.quiet-hours-inputs {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		flex-wrap: wrap;
	}

	.time-label {
		font-size: 0.75rem;
		color: var(--text-muted, #888);
	}

	.time-input {
		border: 1px solid var(--border-default, #d0d0d0);
		border-radius: 4px;
		padding: 0.2rem 0.35rem;
		font-size: 0.78rem;
		color: var(--text-primary, #111);
		background: var(--bg-base, #fff);
		cursor: pointer;
	}

	:global(body.dark) .time-input {
		background: var(--bg-base, #111);
		color: var(--text-primary, #eee);
		border-color: var(--border-default, #444);
	}

	.time-input:focus {
		outline: 2px solid var(--accent-default, #3b82f6);
		outline-offset: 1px;
		border-color: var(--accent-default, #3b82f6);
	}

	.time-separator {
		font-size: 0.75rem;
		color: var(--text-muted, #888);
	}

	.push-row {
		margin-top: 0.75rem;
		border-top: 1px solid var(--border, #e0e0e0);
		padding-top: 0.75rem;
		margin-bottom: 0;
	}

	:global(body.dark) .push-row {
		border-top-color: var(--border, #333);
	}
</style>
