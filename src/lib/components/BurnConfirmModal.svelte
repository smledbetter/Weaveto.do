<script lang="ts">
	interface Props {
		onConfirm: () => void;
		onCancel: () => void;
	}

	let { onConfirm, onCancel }: Props = $props();

	let confirmText = $state('');
	let isValid = $derived(confirmText === 'DELETE');

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			onCancel();
		} else if (e.key === 'Enter' && isValid) {
			e.preventDefault();
			onConfirm();
		}
	}

	function handleBackdropClick(e: MouseEvent) {
		if (e.target === e.currentTarget) {
			onCancel();
		}
	}

	function handleGlobalKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			onCancel();
		}
	}
</script>

<svelte:window onkeydown={handleGlobalKeydown} />

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div
	class="modal-backdrop"
	role="dialog"
	aria-modal="true"
	aria-labelledby="burn-modal-title"
	onkeydown={handleKeydown}
	onclick={handleBackdropClick}
>
	<div class="modal-content">
		<h3 id="burn-modal-title">Permanently Delete Room</h3>

		<p class="warning">
			This action cannot be undone. All messages, tasks, and member access will be destroyed
			immediately.
		</p>

		<label class="field">
			<span>Type DELETE to confirm</span>
			<input
				type="text"
				bind:value={confirmText}
				placeholder="Type DELETE to confirm"
				autofocus
			/>
		</label>

		<div class="actions">
			<button class="delete-btn" onclick={onConfirm} disabled={!isValid}>Delete Room</button>
			<button class="cancel-btn" onclick={onCancel}>Cancel</button>
		</div>
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

	h3 {
		margin: 0 0 1rem;
		font-weight: 500;
		font-size: 1.1rem;
		color: var(--text-heading);
	}

	.warning {
		background: var(--status-urgent-bg);
		border: 1px solid var(--status-urgent);
		border-radius: 6px;
		padding: 0.75rem;
		font-size: 0.85rem;
		color: var(--status-urgent);
		margin-bottom: 1rem;
		line-height: 1.4;
	}

	.field {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		margin-bottom: 1rem;
	}

	.field span {
		font-size: 0.8rem;
		color: var(--text-secondary);
	}

	.field input {
		padding: 0.5rem 0.6rem;
		background: var(--bg-base);
		border: 1px solid var(--border-default);
		border-radius: 4px;
		color: var(--text-primary);
		font-size: 0.9rem;
		outline: none;
	}

	.field input:focus {
		border-color: var(--border-strong);
	}

	.actions {
		display: flex;
		gap: 0.75rem;
	}

	.delete-btn {
		flex: 1;
		padding: 0.6rem 1rem;
		background: var(--status-urgent);
		color: var(--text-inverse);
		border: none;
		border-radius: 6px;
		font-weight: 500;
		cursor: pointer;
	}

	.delete-btn:hover:not(:disabled) {
		background: var(--status-error);
	}

	.delete-btn:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}

	.delete-btn:focus-visible {
		outline: 2px solid var(--status-urgent);
		outline-offset: 2px;
	}

	.cancel-btn {
		padding: 0.6rem 1rem;
		background: none;
		border: 1px solid var(--border-default);
		border-radius: 6px;
		color: var(--text-secondary);
		cursor: pointer;
	}

	.cancel-btn:hover {
		border-color: var(--border-strong);
		color: var(--text-primary);
	}

	.cancel-btn:focus-visible {
		outline: 2px solid var(--border-strong);
		outline-offset: 2px;
	}
</style>
