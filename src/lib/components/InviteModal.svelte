<script lang="ts">
	import { qrSvg } from '$lib/qr/encoder';
	import { getRoomName } from '$lib/room/names';
	import type { RoomMember } from '$lib/room/session';

	interface Props {
		roomUrl: string;
		members: Map<string, RoomMember>;
		myIdentityKey: string;
		displayName: string;
		onClose: () => void;
	}

	let { roomUrl, members, myIdentityKey, displayName, onClose }: Props = $props();

	let copied = $state(false);
	let qrCode = $derived(qrSvg(roomUrl, { size: 200, fg: '#000', bg: '#fff' }));

	let roomIdFromUrl = $derived(roomUrl.split('/room/').pop() ?? '');
	let roomName = $derived(roomIdFromUrl.length >= 4 ? getRoomName(roomIdFromUrl) : '');

	function handleGlobalKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			onClose();
		}
	}

	function handleBackdropClick(e: MouseEvent) {
		if (e.target === e.currentTarget) {
			onClose();
		}
	}

	async function copyUrl() {
		try {
			await navigator.clipboard.writeText(roomUrl);
			copied = true;
			setTimeout(() => { copied = false; }, 2000);
		} catch {
			// Fallback: select the input text
		}
	}
</script>

<svelte:window onkeydown={handleGlobalKeydown} />

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div
	class="modal-backdrop"
	role="dialog"
	aria-modal="true"
	aria-labelledby="invite-modal-title"
	onclick={handleBackdropClick}
	onkeydown={(e) => e.key === 'Escape' && onClose()}
>
	<div class="modal-content">
		<div class="modal-header">
			<h3 id="invite-modal-title">Invite to {roomName || 'Room'}</h3>
			<button class="close-btn" onclick={onClose} aria-label="Close">&times;</button>
		</div>

		<div class="qr-container">
			{@html qrCode}
		</div>

		<div class="url-row">
			<input
				type="text"
				readonly
				value={roomUrl}
				class="url-input"
				onclick={(e) => (e.target as HTMLInputElement).select()}
			/>
			<button class="copy-btn" onclick={copyUrl}>
				{copied ? 'Copied!' : 'Copy'}
			</button>
		</div>

		<div class="member-list">
			<h4>Members ({members.size + 1})</h4>
			<div class="member">
				<span class="member-name">{displayName}</span>
				<span class="you-badge">You</span>
			</div>
			{#each [...members.values()] as member}
				<div class="member">
					<span class="member-name">{member.displayName}</span>
				</div>
			{/each}
		</div>

		<p class="privacy-footer">Only people with this link can join. The room is end-to-end encrypted.</p>
	</div>
</div>

<style>
	.modal-backdrop {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.5);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 200;
	}

	.modal-content {
		background: var(--bg-surface);
		border: 1px solid var(--border-default);
		border-radius: 8px;
		padding: 1.5rem;
		width: 100%;
		max-width: 420px;
		max-height: 80vh;
		overflow-y: auto;
	}

	.modal-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 1.25rem;
	}

	.modal-header h3 {
		margin: 0;
		font-weight: 500;
		font-size: 1.1rem;
		color: var(--text-heading);
	}

	.close-btn {
		background: none;
		border: none;
		color: var(--text-secondary);
		cursor: pointer;
		font-size: 1.3rem;
		padding: 0;
		line-height: 1;
	}

	.close-btn:hover {
		color: var(--text-primary);
	}


	.qr-container {
		display: flex;
		justify-content: center;
		padding: 1rem;
		background: #fff;
		border-radius: 8px;
		margin-bottom: 1rem;
	}

	.qr-container :global(svg) {
		width: 200px;
		height: 200px;
	}

	.url-row {
		display: flex;
		gap: 0.5rem;
		margin-bottom: 1.25rem;
	}

	.url-input {
		flex: 1;
		padding: 0.5rem 0.6rem;
		background: var(--bg-base);
		border: 1px solid var(--border-default);
		border-radius: 4px;
		color: var(--text-primary);
		font-size: 0.8rem;
		outline: none;
		min-width: 0;
	}

	.url-input:focus {
		border-color: var(--border-strong);
	}

	.copy-btn {
		padding: 0.5rem 1rem;
		background: var(--accent-default);
		color: var(--text-inverse);
		border: none;
		border-radius: 4px;
		font-size: 0.85rem;
		font-weight: 500;
		cursor: pointer;
		white-space: nowrap;
	}

	.copy-btn:hover {
		background: var(--accent-strong);
	}

	.member-list {
		margin-bottom: 1rem;
	}

	.member-list h4 {
		margin: 0 0 0.5rem;
		font-size: 0.85rem;
		font-weight: 500;
		color: var(--text-secondary);
	}

	.member {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.35rem 0;
	}

	.member-name {
		font-size: 0.9rem;
		color: var(--text-primary);
	}

	.you-badge {
		font-size: 0.7rem;
		background: var(--accent-muted);
		color: var(--accent-default);
		border: 1px solid var(--accent-border);
		padding: 0.1rem 0.4rem;
		border-radius: 3px;
	}

	.privacy-footer {
		margin: 0;
		font-size: 0.75rem;
		color: var(--text-muted);
		text-align: center;
		line-height: 1.4;
	}
</style>
