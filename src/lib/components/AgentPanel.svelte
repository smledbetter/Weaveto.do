<script lang="ts">
	import type { StoredAgentModule } from '$lib/agents/types';
	import { isBuiltIn } from '$lib/agents/builtin';

	interface Props {
		modules: StoredAgentModule[];
		activeAgents: string[];
		onActivate: (moduleId: string) => void;
		onDeactivate: (moduleId: string) => void;
		onDelete: (moduleId: string) => void;
		onClose: () => void;
	}

	let {
		modules,
		activeAgents,
		onActivate,
		onDeactivate,
		onDelete,
		onClose,
	}: Props = $props();

	// Delete confirmation
	let confirmDelete = $state<string | null>(null);

	function toggleActive(moduleId: string) {
		if (activeAgents.includes(moduleId)) {
			onDeactivate(moduleId);
		} else {
			onActivate(moduleId);
		}
	}

	function initiateDelete(moduleId: string) {
		confirmDelete = moduleId;
	}

	function confirmDeleteModule() {
		if (confirmDelete) {
			onDelete(confirmDelete);
			confirmDelete = null;
		}
	}

	function cancelDelete() {
		confirmDelete = null;
	}

	function formatDate(timestamp: number): string {
		const date = new Date(timestamp);
		return date.toLocaleDateString('en-US', {
			month: 'short',
			day: 'numeric',
			year: date.getFullYear() !== new Date().getFullYear() ? '2-digit' : undefined,
		});
	}
</script>

<aside class="agent-panel" role="complementary" aria-label="Automation panel">
	<div class="panel-header">
		<h3>Automation</h3>
		<button
			class="close-panel-btn"
			onclick={onClose}
			aria-label="Close agent panel"
		>&times;</button>
	</div>

	<div class="panel-body" aria-live="polite">
		<div class="explainer-card">
			<p class="explainer-primary">
				Automate your workflow — tasks get balanced and bottlenecks get flagged, all without sharing your messages.
			</p>
			<p class="explainer-secondary">
				Auto-balance distributes unassigned tasks evenly. Unblock flags stuck tasks as urgent.
			</p>
		</div>

		<!-- Custom agent upload UI removed — deferred to a later milestone -->

		{#if modules.length === 0}
			<div class="empty-state">
				<p>No agent modules uploaded</p>
			</div>
		{:else}
			<ul class="module-list" role="list">
				{#each modules as module (module.id)}
					{@const isActive = activeAgents.includes(module.id)}
					{@const builtin = isBuiltIn(module.id)}
					<li class="module-item" class:builtin>
						<div class="module-header">
							<div class="module-title-section">
								<div class="status-badge" class:active={isActive} title={isActive ? 'Active' : 'Inactive'}>
									{isActive ? '●' : '○'}
								</div>
								<div class="module-info">
									<h4 class="module-name">{module.manifest.name}</h4>
									<div class="module-meta">
										<span class="version">v{module.manifest.version}</span>
										{#if builtin}
											<span class="builtin-badge">Built-in</span>
										{:else}
											<span class="author">{module.manifest.author}</span>
											<span class="uploaded">Uploaded {formatDate(module.uploadedAt)}</span>
										{/if}
									</div>
								</div>
							</div>
							<div class="module-actions">
								<button
									class="toggle-btn"
									class:active={isActive}
									onclick={() => toggleActive(module.id)}
									aria-label={isActive ? 'Deactivate agent' : 'Activate agent'}
									title={isActive ? 'Deactivate' : 'Activate'}
								>
									{isActive ? 'Deactivate' : 'Activate'}
								</button>
								{#if !builtin}
									<button
										class="delete-btn"
										onclick={() => initiateDelete(module.id)}
										aria-label="Delete agent module"
										title="Delete"
									>
										&#128465;
									</button>
								{/if}
							</div>
						</div>

						{#if module.manifest.description}
							<div class="module-description">
								{module.manifest.description}
							</div>
						{/if}

						{#if module.manifest.permissions.length > 0}
							<div class="permissions-list">
								{#each module.manifest.permissions as perm}
									<span class="permission-tag">{perm}</span>
								{/each}
							</div>
						{/if}
					</li>
				{/each}
			</ul>
		{/if}
	</div>
</aside>

{#if confirmDelete}
	<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
	<div
		class="modal-backdrop"
		role="dialog"
		aria-modal="true"
		aria-label="Confirm delete"
		onkeydown={(e) => e.key === 'Escape' && cancelDelete()}
		onclick={(e) => e.target === e.currentTarget && cancelDelete()}
	>
		<div class="confirm-modal">
			<h4>Delete agent module?</h4>
			<p>This action cannot be undone.</p>
			<div class="confirm-actions">
				<button class="delete-confirm-btn" onclick={confirmDeleteModule}>Delete</button>
				<button class="cancel-btn" onclick={cancelDelete}>Cancel</button>
			</div>
		</div>
	</div>
{/if}

<style>
	.agent-panel {
		display: flex;
		flex-direction: column;
		height: 100%;
		border-left: 1px solid var(--border-subtle);
		background: var(--bg-base);
		overflow: hidden;
	}

	.panel-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 0.75rem 1rem;
		border-bottom: 1px solid var(--border-subtle);
		flex-shrink: 0;
	}

	.panel-header h3 {
		margin: 0;
		font-size: 0.95rem;
		font-weight: 500;
	}

	.close-panel-btn {
		background: none;
		border: none;
		color: var(--text-secondary);
		cursor: pointer;
		font-size: 1.2rem;
		padding: 0.1rem 0.3rem;
		line-height: 1;
	}

	.close-panel-btn:hover {
		color: var(--text-primary);
	}

	.panel-body {
		flex: 1;
		overflow-y: auto;
		padding: 0.75rem;
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	/* Explainer card */
	.explainer-card {
		background: var(--bg-surface);
		border: 1px solid var(--border-subtle);
		border-radius: 6px;
		padding: 0.75rem;
		margin-bottom: 0.25rem;
	}

	.explainer-primary {
		margin: 0 0 0.5rem;
		font-size: 0.85rem;
		color: var(--text-secondary);
		line-height: 1.4;
	}

	.explainer-secondary {
		margin: 0;
		font-size: 0.85rem;
		color: var(--text-secondary);
		line-height: 1.4;
	}

	/* Empty state */
	.empty-state {
		text-align: center;
		padding: 2rem 1rem;
		color: var(--text-muted);
	}

	.empty-state p {
		margin: 0;
	}

	/* Module list */
	.module-list {
		list-style: none;
		padding: 0;
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.module-item {
		background: var(--bg-surface);
		border: 1px solid var(--border-default);
		border-radius: 6px;
		padding: 0.75rem;
		transition: border-color 150ms ease-out;
	}

	.module-item:hover {
		border-color: var(--border-strong);
	}

	.module-header {
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
		gap: 0.75rem;
		margin-bottom: 0.5rem;
	}

	.module-title-section {
		display: flex;
		align-items: flex-start;
		gap: 0.6rem;
		flex: 1;
		min-width: 0;
	}

	.status-badge {
		font-size: 0.8rem;
		color: var(--text-muted);
		margin-top: 0.1rem;
		flex-shrink: 0;
	}

	.status-badge.active {
		color: var(--status-success);
	}

	.module-info {
		flex: 1;
		min-width: 0;
	}

	.module-name {
		margin: 0;
		font-size: 0.9rem;
		font-weight: 500;
		color: var(--text-primary);
		word-break: break-word;
	}

	.module-meta {
		display: flex;
		flex-wrap: wrap;
		gap: 0.75rem;
		font-size: 0.75rem;
		color: var(--text-muted);
		margin-top: 0.25rem;
	}

	.version,
	.author,
	.uploaded {
		display: inline-block;
	}

	.version::before {
		content: '';
	}

	.builtin-badge {
		display: inline-flex;
		align-items: center;
		padding: 0.1rem 0.4rem;
		background: var(--accent-muted);
		color: var(--accent-default);
		border-radius: 3px;
		font-size: 0.7rem;
		font-weight: 500;
		border: 1px solid var(--accent-border);
	}

	.builtin-badge::before {
		content: '•';
		margin: 0 0.35rem;
	}

	.author::before,
	.uploaded::before {
		content: '•';
		margin: 0 0.35rem;
	}

	.module-actions {
		display: flex;
		gap: 0.4rem;
		flex-shrink: 0;
	}

	.toggle-btn {
		background: none;
		border: 1px solid var(--border-default);
		color: var(--text-secondary);
		padding: 0.3rem 0.6rem;
		border-radius: 4px;
		cursor: pointer;
		font-size: 0.75rem;
		transition: all 150ms ease-out;
		white-space: nowrap;
	}

	.toggle-btn:hover {
		border-color: var(--accent-default);
		color: var(--accent-default);
	}

	.toggle-btn.active {
		border-color: var(--accent-default);
		color: var(--accent-default);
		background: var(--accent-muted);
	}

	.delete-btn {
		background: none;
		border: 1px solid var(--border-default);
		color: var(--text-secondary);
		padding: 0.3rem 0.4rem;
		border-radius: 4px;
		cursor: pointer;
		font-size: 0.75rem;
		transition: all 150ms ease-out;
		min-width: 32px;
		height: 26px;
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.delete-btn:hover {
		border-color: var(--status-error);
		color: var(--status-error);
	}

	.module-description {
		font-size: 0.8rem;
		color: var(--text-secondary);
		line-height: 1.3;
		margin-bottom: 0.5rem;
		word-break: break-word;
	}

	.permissions-list {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
	}

	.permission-tag {
		display: inline-flex;
		align-items: center;
		padding: 0.2rem 0.5rem;
		background: var(--accent-muted);
		color: var(--accent-default);
		border-radius: 3px;
		font-size: 0.7rem;
		font-weight: 500;
		border: 1px solid var(--accent-border);
	}

	/* Delete confirmation modal */
	.modal-backdrop {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.5);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 200;
	}

	.confirm-modal {
		background: var(--bg-surface);
		border: 1px solid var(--border-default);
		border-radius: 8px;
		padding: 1.25rem;
		max-width: 360px;
		width: 100%;
	}

	.confirm-modal h4 {
		margin: 0 0 0.5rem;
		font-weight: 500;
		font-size: 0.95rem;
		color: var(--text-primary);
	}

	.confirm-modal p {
		margin: 0 0 1rem;
		font-size: 0.85rem;
		color: var(--text-secondary);
	}

	.confirm-actions {
		display: flex;
		gap: 0.75rem;
	}

	.delete-confirm-btn {
		flex: 1;
		padding: 0.5rem;
		background: var(--status-error);
		color: var(--text-inverse);
		border: none;
		border-radius: 6px;
		cursor: pointer;
		font-weight: 500;
		font-size: 0.85rem;
		transition: opacity 150ms ease-out;
	}

	.delete-confirm-btn:hover {
		opacity: 0.9;
	}

	.cancel-btn {
		padding: 0.5rem 1rem;
		background: none;
		border: 1px solid var(--border-default);
		border-radius: 6px;
		color: var(--text-secondary);
		cursor: pointer;
		font-size: 0.85rem;
		transition: all 150ms ease-out;
	}

	.cancel-btn:hover {
		border-color: var(--border-strong);
		color: var(--text-primary);
	}

	/* Mobile: full width */
	@media (max-width: 767px) {
		.agent-panel {
			border-left: none;
		}

		.module-header {
			flex-direction: column;
		}

		.module-actions {
			width: 100%;
		}

		.toggle-btn,
		.delete-btn {
			flex: 1;
		}
	}
</style>
