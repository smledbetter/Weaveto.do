<script lang="ts">
	import type { RoomMember } from '$lib/room/session';
	import type { Task } from '$lib/tasks/types';
	import { parseNaturalDate, formatDueDate } from '$lib/tasks/date-parser';

	interface Props {
		members: Map<string, RoomMember>;
		myIdentityKey: string;
		tasks?: Task[];
		onCreateTask: (title: string, assignee?: string, dueAt?: number, subtasks?: string[], blockedBy?: string[]) => void;
		onClose: () => void;
	}

	let { members, myIdentityKey, tasks = [], onCreateTask, onClose }: Props = $props();

	let title = $state('');
	let assignee = $state('');
	let dueInput = $state('');
	let subtaskInputs = $state<string[]>([]);
	let blockedBy = $state<string[]>([]);
	let blockedBySelect = $state('');
	let error = $state('');
	let shownPrivacyNote = $state(false);

	// Available tasks for the "Blocked by" dropdown (pending/in-progress, not self)
	let availableDeps = $derived(
		tasks.filter((t) => t.status !== 'completed' && !blockedBy.includes(t.id)),
	);

	// Live preview of parsed due date
	let duePreview = $derived.by(() => {
		if (!dueInput.trim()) return '';
		const parsed = parseNaturalDate(dueInput.trim());
		return parsed ? formatDueDate(parsed.timestamp) : 'Invalid format';
	});

	function addSubtask() {
		subtaskInputs = [...subtaskInputs, ''];
	}

	function removeSubtask(index: number) {
		subtaskInputs = subtaskInputs.filter((_, i) => i !== index);
	}

	function updateSubtask(index: number, value: string) {
		subtaskInputs = subtaskInputs.map((s, i) => (i === index ? value : s));
	}

	function addBlockedBy() {
		if (blockedBySelect && !blockedBy.includes(blockedBySelect)) {
			blockedBy = [...blockedBy, blockedBySelect];
			blockedBySelect = '';
		}
	}

	function removeBlockedBy(taskId: string) {
		blockedBy = blockedBy.filter((id) => id !== taskId);
	}

	function getTaskTitle(taskId: string): string {
		const task = tasks.find((t) => t.id === taskId);
		return task?.title ?? taskId;
	}

	function handleSubmit() {
		error = '';
		const trimmedTitle = title.trim();
		if (!trimmedTitle) {
			error = 'Task title is required.';
			return;
		}

		let dueAt: number | undefined;
		if (dueInput.trim()) {
			const parsed = parseNaturalDate(dueInput.trim());
			if (parsed === null) {
				error = 'Could not parse date. Try: tomorrow, next friday, in 3 hours, 30m';
				return;
			}
			dueAt = parsed.timestamp;
		}

		const subtasks = subtaskInputs
			.map((s) => s.trim())
			.filter((s) => s.length > 0);

		onCreateTask(
			trimmedTitle,
			assignee || undefined,
			dueAt,
			subtasks.length > 0 ? subtasks : undefined,
			blockedBy.length > 0 ? blockedBy : undefined,
		);
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			onClose();
		} else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
			e.preventDefault();
			handleSubmit();
		} else if (e.key === 'Enter' && subtaskInputs.length === 0 && !(e.target instanceof HTMLButtonElement)) {
			e.preventDefault();
			handleSubmit();
		}
	}

	function handleBackdropClick(e: MouseEvent) {
		if (e.target === e.currentTarget) onClose();
	}
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div class="modal-backdrop" role="dialog" aria-modal="true" aria-label="Create task" onkeydown={handleKeydown} onclick={handleBackdropClick}>
	<div class="modal-content">
		<h3>New Task</h3>

		{#if !shownPrivacyNote}
			<p class="privacy-note">
				Tasks are end-to-end encrypted, like messages. Only room members can see them.
				<button class="dismiss-note" onclick={() => { shownPrivacyNote = true; }}>Got it</button>
			</p>
		{/if}

		{#if error}
			<p class="error">{error}</p>
		{/if}

		<label class="field">
			<span>Title</span>
			<input type="text" bind:value={title} placeholder="What needs to be done?" autofocus />
		</label>

		<label class="field">
			<span>Assign to</span>
			<select bind:value={assignee}>
				<option value="">Unassigned</option>
				<option value={myIdentityKey}>Me</option>
				{#each Array.from(members.values()) as member}
					<option value={member.identityKey}>{member.displayName}</option>
				{/each}
			</select>
		</label>

		<div class="field">
			<label>
				<span>Due</span>
				<input type="text" bind:value={dueInput} placeholder="e.g. tomorrow, next friday, in 3 hours, 30m" />
			</label>
			{#if duePreview}
				<span class="due-preview" class:invalid={duePreview === 'Invalid format'}>
					{duePreview === 'Invalid format' ? 'Invalid format' : duePreview}
				</span>
			{/if}
		</div>

		{#if availableDeps.length > 0 || blockedBy.length > 0}
			<div class="field">
				<span>Blocked by</span>
				{#if blockedBy.length > 0}
					<div class="dep-tags">
						{#each blockedBy as depId}
							<span class="dep-tag">
								{getTaskTitle(depId)}
								<button class="remove-dep" onclick={() => removeBlockedBy(depId)} aria-label="Remove dependency">&times;</button>
							</span>
						{/each}
					</div>
				{/if}
				{#if availableDeps.length > 0}
				<div class="dep-select-row">
					<select bind:value={blockedBySelect}>
						<option value="">Select a task...</option>
						{#each availableDeps as task}
							<option value={task.id}>{task.title}</option>
						{/each}
					</select>
					<button class="add-dep-btn" onclick={addBlockedBy} disabled={!blockedBySelect}>Add</button>
				</div>
				{/if}
			</div>
		{/if}

		<div class="field">
			<span>Subtasks</span>
			{#each subtaskInputs as subtask, i}
				<div class="subtask-row">
					<input
						type="text"
						value={subtask}
						oninput={(e) => updateSubtask(i, (e.target as HTMLInputElement).value)}
						placeholder="Subtask title"
					/>
					<button class="remove-subtask" onclick={() => removeSubtask(i)} aria-label="Remove subtask">-</button>
				</div>
			{/each}
			<button class="add-subtask" onclick={addSubtask}>+ Add subtask</button>
		</div>

		<div class="actions">
			<button class="create-btn" onclick={handleSubmit} disabled={!title.trim()} title="⌘Enter">Create Task</button>
			<button class="cancel-btn" onclick={onClose}>Cancel</button>
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
	}

	.privacy-note {
		background: var(--accent-muted);
		border: 1px solid var(--accent-border);
		border-radius: 6px;
		padding: 0.5rem 0.75rem;
		font-size: 0.8rem;
		color: var(--accent-strong);
		margin-bottom: 1rem;
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.dismiss-note {
		background: none;
		border: none;
		color: var(--accent-default);
		cursor: pointer;
		font-size: 0.75rem;
		text-decoration: underline;
		white-space: nowrap;
	}

	.error {
		color: var(--status-error);
		font-size: 0.85rem;
		margin-bottom: 0.75rem;
	}

	.field {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		margin-bottom: 0.75rem;
	}

	.field span {
		font-size: 0.8rem;
		color: var(--text-secondary);
	}

	.field input,
	.field select {
		padding: 0.5rem 0.6rem;
		background: var(--bg-base);
		border: 1px solid var(--border-default);
		border-radius: 4px;
		color: var(--text-primary);
		font-size: 0.9rem;
		outline: none;
	}

	.field select {
		padding-right: 2rem;
		appearance: none;
		background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8' viewBox='0 0 12 8'%3E%3Cpath fill='%23666' d='M1.4 0L6 4.6 10.6 0 12 1.4l-6 6-6-6z'/%3E%3C/svg%3E");
		background-repeat: no-repeat;
		background-position: right 0.6rem center;
	}

	.field input:focus,
	.field select:focus {
		border-color: var(--border-strong);
	}

	.subtask-row {
		display: flex;
		gap: 0.5rem;
		margin-bottom: 0.25rem;
	}

	.subtask-row input {
		flex: 1;
		padding: 0.4rem 0.5rem;
		background: var(--bg-base);
		border: 1px solid var(--border-default);
		border-radius: 4px;
		color: var(--text-primary);
		font-size: 0.85rem;
	}

	.remove-subtask {
		width: 28px;
		height: 28px;
		min-width: 28px;
		background: none;
		border: 1px solid var(--border-default);
		border-radius: 4px;
		color: var(--text-secondary);
		cursor: pointer;
		font-size: 1rem;
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.add-subtask {
		background: none;
		border: none;
		color: var(--accent-default);
		cursor: pointer;
		font-size: 0.8rem;
		padding: 0.25rem 0;
	}

	.actions {
		display: flex;
		gap: 0.75rem;
		margin-top: 1rem;
	}

	.create-btn {
		flex: 1;
		padding: 0.6rem 1rem;
		background: var(--btn-primary-bg);
		color: var(--text-inverse);
		border: none;
		border-radius: 6px;
		font-weight: 500;
		cursor: pointer;
	}

	.create-btn:hover:not(:disabled) {
		background: var(--btn-primary-hover);
	}

	.create-btn:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}

	.cancel-btn {
		padding: 0.6rem 1rem;
		background: none;
		border: 1px solid var(--border-default);
		border-radius: 6px;
		color: var(--text-secondary);
		cursor: pointer;
	}

	.due-preview {
		font-size: 0.75rem;
		color: var(--accent-default);
		padding: 0.1rem 0;
	}

	.due-preview.invalid {
		color: var(--status-error);
	}

	.dep-tags {
		display: flex;
		flex-wrap: wrap;
		gap: 0.35rem;
	}

	.dep-tag {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		background: var(--bg-overlay);
		border: 1px solid var(--border-default);
		border-radius: 4px;
		padding: 0.2rem 0.5rem;
		font-size: 0.8rem;
		color: var(--text-primary);
	}

	.remove-dep {
		background: none;
		border: none;
		color: var(--text-muted);
		cursor: pointer;
		font-size: 1rem;
		padding: 0;
		line-height: 1;
	}

	.remove-dep:hover {
		color: var(--status-error);
	}

	.dep-select-row {
		display: flex;
		gap: 0.5rem;
	}

	.dep-select-row select {
		flex: 1;
	}

	.add-dep-btn {
		padding: 0.5rem 0.75rem;
		background: none;
		border: 1px solid var(--border-default);
		border-radius: 4px;
		color: var(--accent-default);
		cursor: pointer;
		font-size: 0.8rem;
		white-space: nowrap;
	}

	.add-dep-btn:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}
</style>
