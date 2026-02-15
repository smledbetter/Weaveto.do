<script lang="ts">
	import { onMount } from 'svelte';
	import type { Task, TaskId, TaskEvent } from '$lib/tasks/types';
	import type { RoomMember } from '$lib/room/session';
	import { parseNaturalDate, formatDueDate } from '$lib/tasks/date-parser';
	import TaskCreateModal from './TaskCreateModal.svelte';

	interface Props {
		tasks: Task[];
		members: Map<string, RoomMember>;
		myIdentityKey: string;
		lastMessageTimes: Map<string, number>;
		onTaskEvent: (event: TaskEvent) => void;
		onAutoAssign: (events: TaskEvent[]) => void;
		onClose: () => void;
	}

	let {
		tasks,
		members,
		myIdentityKey,
		lastMessageTimes,
		onTaskEvent,
		onAutoAssign,
		onClose,
	}: Props = $props();

	let showCreateModal = $state(false);
	let showCompleted = $state(false);
	let assignDropdownTask = $state<TaskId | null>(null);
	let autoAssignPreview = $state<TaskEvent[] | null>(null);

	// Inline editing state
	let editingTask = $state<string | null>(null);
	let editingField = $state<'title' | 'due' | null>(null);
	let editValue = $state('');
	let editInputRef: HTMLInputElement | null = null;

	// Derived task lists
	let parentTasks = $derived(tasks.filter((t) => !t.parentId));
	let pendingParents = $derived(parentTasks.filter((t) => t.status !== 'completed'));
	let completedParents = $derived(parentTasks.filter((t) => t.status === 'completed'));
	let pendingCount = $derived(tasks.filter((t) => t.status !== 'completed').length);

	// Listen for open-task-create-modal event from keyboard shortcut
	onMount(() => {
		const handleOpenCreateModal = () => {
			showCreateModal = true;
		};
		window.addEventListener('open-task-create-modal', handleOpenCreateModal);
		return () => {
			window.removeEventListener('open-task-create-modal', handleOpenCreateModal);
		};
	});

	// Inline editing functions
	function startEdit(taskId: TaskId, field: 'title' | 'due', currentValue: string | number | undefined) {
		if (currentValue === undefined) return;
		editingTask = taskId;
		editingField = field;
		editValue = typeof currentValue === 'number' ? formatDueDate(currentValue) : String(currentValue);
	}

	function cancelEdit() {
		editingTask = null;
		editingField = null;
		editValue = '';
		editInputRef = null;
	}

	function saveEdit() {
		if (!editingTask || !editingField) return;

		const trimmed = editValue.trim();
		if (!trimmed) {
			cancelEdit();
			return;
		}

		if (editingField === 'title') {
			onTaskEvent({
				type: 'task_status_changed',
				taskId: editingTask,
				task: { title: trimmed },
				timestamp: Date.now(),
				actorId: myIdentityKey,
			});
		} else if (editingField === 'due') {
			const parsed = parseNaturalDate(trimmed);
			if (parsed) {
				onTaskEvent({
					type: 'task_status_changed',
					taskId: editingTask,
					task: { dueAt: parsed.timestamp },
					timestamp: Date.now(),
					actorId: myIdentityKey,
				});
			}
		}

		cancelEdit();
	}

	function handleEditKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter') {
			e.preventDefault();
			saveEdit();
		} else if (e.key === 'Escape') {
			e.preventDefault();
			cancelEdit();
		}
	}

	// Room progress calculation
	let roomProgress = $derived.by(() => {
		const total = tasks.length;
		const completed = tasks.filter((t) => t.status === 'completed').length;
		const inProgress = tasks.filter((t) => t.status === 'in_progress').length;
		const pending = tasks.filter((t) => t.status === 'pending').length;
		const blocked = tasks.filter((t) => t.status !== 'completed' && isTaskBlocked(t)).length;
		const percent = total > 0 ? Math.round((completed / total) * 100) : 0;
		return { total, completed, inProgress, pending, blocked, percent };
	});

	function getSubtasks(parentId: TaskId): Task[] {
		return tasks.filter((t) => t.parentId === parentId);
	}

	function isTaskBlocked(task: Task): boolean {
		if (!task.blockedBy || task.blockedBy.length === 0) return false;
		return task.blockedBy.some((depId) => {
			const dep = tasks.find((t) => t.id === depId);
			return dep && dep.status !== 'completed';
		});
	}

	function getBlockingTasks(task: Task): Task[] {
		if (!task.blockedBy) return [];
		return task.blockedBy
			.map((depId) => tasks.find((t) => t.id === depId))
			.filter((dep): dep is Task => dep !== undefined && dep.status !== 'completed');
	}

	function getTaskProgress(parentId: TaskId): number | null {
		const subtasks = getSubtasks(parentId);
		if (subtasks.length === 0) return null;
		const completed = subtasks.filter((t) => t.status === 'completed').length;
		return Math.round((completed / subtasks.length) * 100);
	}

	function getMemberName(identityKey: string): string {
		if (identityKey === myIdentityKey) return 'Me';
		return members.get(identityKey)?.displayName ?? 'Unknown';
	}

	function statusIcon(status: string): string {
		switch (status) {
			case 'pending': return '○';
			case 'in_progress': return '◐';
			case 'completed': return '●';
			default: return '○';
		}
	}

	function toggleComplete(task: Task) {
		const newStatus = task.status === 'completed' ? 'pending' : 'completed';
		onTaskEvent({
			type: 'task_status_changed',
			taskId: task.id,
			task: { status: newStatus },
			timestamp: Date.now(),
			actorId: myIdentityKey,
		});
	}

	function assignTask(taskId: TaskId, assignee: string) {
		onTaskEvent({
			type: 'task_assigned',
			taskId,
			task: { assignee },
			timestamp: Date.now(),
			actorId: myIdentityKey,
		});
		assignDropdownTask = null;
	}

	function handleCreateTask(title: string, assignee?: string, dueAt?: number, subtasks?: string[], blockedBy?: string[]) {
		const now = Date.now();
		const parentId = crypto.randomUUID();

		onTaskEvent({
			type: 'task_created',
			taskId: parentId,
			task: {
				title,
				status: 'pending',
				createdBy: myIdentityKey,
				...(assignee && { assignee }),
				...(dueAt !== undefined && { dueAt }),
				...(blockedBy && blockedBy.length > 0 && { blockedBy }),
			},
			timestamp: now,
			actorId: myIdentityKey,
		});

		if (subtasks) {
			for (const sub of subtasks) {
				onTaskEvent({
					type: 'subtask_created',
					taskId: crypto.randomUUID(),
					task: {
						title: sub,
						status: 'pending',
						parentId,
						createdBy: myIdentityKey,
					},
					timestamp: now,
					actorId: myIdentityKey,
				});
			}
		}

		showCreateModal = false;
	}

	function triggerAutoAssign() {
		// Import dynamically to keep panel lightweight
		import('$lib/tasks/agent').then(({ autoAssign }) => {
			const events = autoAssign(tasks, members, myIdentityKey, lastMessageTimes);
			if (events.length === 0) return;
			autoAssignPreview = events;
		});
	}

	function confirmAutoAssign() {
		if (autoAssignPreview) {
			onAutoAssign(autoAssignPreview);
			autoAssignPreview = null;
		}
	}

	function cancelAutoAssign() {
		autoAssignPreview = null;
	}

	// Build a summary for auto-assign preview
	function getAssignmentSummary(events: TaskEvent[]): Map<string, number> {
		const counts = new Map<string, number>();
		for (const e of events) {
			const assignee = e.task?.assignee;
			if (assignee) {
				counts.set(assignee, (counts.get(assignee) ?? 0) + 1);
			}
		}
		return counts;
	}

	function getCurrentLoad(identityKey: string): number {
		return tasks.filter(
			(t) => t.assignee === identityKey && t.status !== 'completed'
		).length;
	}
</script>

<aside class="task-panel" role="complementary" aria-label="Task panel">
	<div class="panel-header">
		<h3>Tasks</h3>
		<div class="panel-actions">
			<button
				class="new-task-btn"
				onclick={() => { showCreateModal = true; }}
				aria-label="Create new task"
			>+ New Task</button>
			<button
				class="close-panel-btn"
				onclick={onClose}
				aria-label="Close task panel"
			>&times;</button>
		</div>
	</div>

	<div class="panel-body" aria-live="polite">
		{#if tasks.length === 0}
			<div class="empty-state">
				<p>No tasks yet.</p>
				<button class="empty-create-btn" onclick={() => { showCreateModal = true; }}>
					Create your first task
				</button>
			</div>
		{:else}
			{#if tasks.length > 0}
				<div class="room-progress" aria-live="polite" aria-label="Room progress">
					<div class="progress-info">
						<span class="progress-text">{roomProgress.completed}/{roomProgress.total} complete ({roomProgress.percent}%)</span>
					</div>
					<div class="progress-bar">
						<div class="progress-fill" style="width: {roomProgress.percent}%"></div>
					</div>
					<div class="progress-stats">
						<span class="stat" title="Completed tasks">✓ {roomProgress.completed}</span>
						<span class="stat" title="In-progress tasks">◐ {roomProgress.inProgress}</span>
						<span class="stat" title="Pending tasks">○ {roomProgress.pending}</span>
						{#if roomProgress.blocked > 0}
							<span class="stat blocked" title="Blocked tasks">⊘ {roomProgress.blocked}</span>
						{/if}
					</div>
				</div>
			{/if}

			{#if pendingCount > 0}
				<button
					class="auto-assign-btn"
					onclick={triggerAutoAssign}
					aria-label="Auto-assign unassigned tasks"
				>Auto-assign</button>
			{/if}

			<ul class="task-list" role="list">
				{#each pendingParents as task (task.id)}
					{@const subtasks = getSubtasks(task.id)}
					{@const blocked = isTaskBlocked(task)}
					{@const blockingTasks = getBlockingTasks(task)}
					{@const subtaskProgress = getTaskProgress(task.id)}
					<li class="task-item" class:blocked>
						<div class="task-row">
							<button
								class="task-checkbox"
								onclick={() => toggleComplete(task)}
								aria-label="Mark '{task.title}' as complete"
								title="Mark complete"
							>
								<span class="status-icon">{statusIcon(task.status)}</span>
							</button>
							<div class="task-info">
								<div class="task-header">
									{#if editingTask === task.id && editingField === 'title'}
										<input
											type="text"
											class="inline-edit"
											bind:value={editValue}
											bind:this={editInputRef}
											onkeydown={handleEditKeydown}
											onblur={saveEdit}
											autofocus
										/>
									{:else}
										<button
											class="task-title editable"
											onclick={() => startEdit(task.id, 'title', task.title)}
											title="Click to edit title"
										>
											{task.title}
										</button>
									{/if}
									{#if blocked}
										<span class="blocked-indicator">Blocked</span>
									{/if}
								</div>
								{#if task.dueAt}
									{#if editingTask === task.id && editingField === 'due'}
										<input
											type="text"
											class="inline-edit"
											bind:value={editValue}
											bind:this={editInputRef}
											onkeydown={handleEditKeydown}
											onblur={saveEdit}
											autofocus
											placeholder="e.g. tomorrow, 2h, in 1 hour"
										/>
									{:else}
										<button
											class="task-due editable"
											onclick={() => startEdit(task.id, 'due', task.dueAt)}
											title="Click to edit due date"
										>
											Due {formatDueDate(task.dueAt)}
										</button>
									{/if}
								{/if}
							</div>
							<div class="task-meta">
								<button
									class="assignee-btn"
									onclick={() => { assignDropdownTask = assignDropdownTask === task.id ? null : task.id; }}
									aria-label="Assign task"
								>
									{task.assignee ? getMemberName(task.assignee) : 'Unassigned'}
								</button>
								{#if assignDropdownTask === task.id}
									<div class="assign-dropdown" role="listbox" aria-label="Select assignee">
										<button
											role="option"
											onclick={() => assignTask(task.id, myIdentityKey)}
										>Me</button>
										{#each Array.from(members.values()) as member}
											<button
												role="option"
												onclick={() => assignTask(task.id, member.identityKey)}
											>{member.displayName}</button>
										{/each}
									</div>
								{/if}
								<span class="lock-icon" title="Encrypted">&#128274;</span>
							</div>
						</div>

						{#if blockingTasks.length > 0}
							<div class="dependencies">
								{#each blockingTasks as dep}
									<div class="blocked-by">
										<span class="blocked-label">Blocked by:</span>
										<span class="dep-title">{dep.title}</span>
									</div>
								{/each}
							</div>
						{/if}

						{#if subtasks.length > 0}
							{#if subtaskProgress !== null}
								<div class="subtask-progress">
									<div class="progress-bar">
										<div class="progress-fill" style="width: {subtaskProgress}%"></div>
									</div>
									<span class="progress-text">{subtaskProgress}%</span>
								</div>
							{/if}
							<ul class="subtask-list" role="list">
								{#each subtasks as sub (sub.id)}
									<li class="subtask-item">
										<button
											class="task-checkbox"
											onclick={() => toggleComplete(sub)}
											aria-label="Mark '{sub.title}' as complete"
										>
											<span class="status-icon">{statusIcon(sub.status)}</span>
										</button>
										<span class="task-title" class:completed={sub.status === 'completed'}>{sub.title}</span>
										<span class="lock-icon" title="Encrypted">&#128274;</span>
									</li>
								{/each}
							</ul>
						{/if}
					</li>
				{/each}
			</ul>

			{#if completedParents.length > 0}
				<button
					class="toggle-completed"
					onclick={() => { showCompleted = !showCompleted; }}
				>
					{showCompleted ? 'Hide' : 'Show'} completed ({completedParents.length})
				</button>

				{#if showCompleted}
					<ul class="task-list completed-list" role="list">
						{#each completedParents as task (task.id)}
							<li class="task-item">
								<div class="task-row">
									<button
										class="task-checkbox"
										onclick={() => toggleComplete(task)}
										aria-label="Mark '{task.title}' as incomplete"
									>
										<span class="status-icon">●</span>
									</button>
									<span class="task-title completed">{task.title}</span>
									<span class="lock-icon" title="Encrypted">&#128274;</span>
								</div>
							</li>
						{/each}
					</ul>
				{/if}
			{/if}
		{/if}
	</div>
</aside>

{#if showCreateModal}
	<TaskCreateModal
		{members}
		{myIdentityKey}
		{tasks}
		onCreateTask={handleCreateTask}
		onClose={() => { showCreateModal = false; }}
	/>
{/if}

{#if autoAssignPreview}
	{@const summary = getAssignmentSummary(autoAssignPreview)}
	<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
	<div class="modal-backdrop" role="dialog" aria-modal="true" aria-label="Auto-assign preview" onkeydown={(e) => e.key === 'Escape' && cancelAutoAssign()} onclick={(e) => e.target === e.currentTarget && cancelAutoAssign()}>
		<div class="preview-modal">
			<h4>Auto-assign will distribute {autoAssignPreview.length} {autoAssignPreview.length === 1 ? 'task' : 'tasks'}:</h4>
			<ul class="preview-list">
				{#each Array.from(summary.entries()) as [key, count]}
					<li>
						<strong>{getMemberName(key)}</strong>: {count} {count === 1 ? 'task' : 'tasks'}
						<span class="current-load">(currently has {getCurrentLoad(key)})</span>
					</li>
				{/each}
			</ul>
			<div class="preview-actions">
				<button class="confirm-btn" onclick={confirmAutoAssign}>Confirm</button>
				<button class="cancel-btn" onclick={cancelAutoAssign}>Cancel</button>
			</div>
		</div>
	</div>
{/if}

<style>
	/* Room progress section */
	.room-progress {
		background: var(--bg-surface);
		border-radius: 6px;
		padding: 0.75rem;
		margin-bottom: 0.75rem;
		border: 1px solid var(--border-subtle);
	}

	.progress-info {
		display: flex;
		align-items: center;
		margin-bottom: 0.5rem;
	}

	.progress-text {
		font-size: 0.85rem;
		font-weight: 500;
		color: var(--text-primary);
	}

	.progress-bar {
		width: 100%;
		height: 8px;
		background: var(--bg-overlay);
		border-radius: 4px;
		overflow: hidden;
		margin-bottom: 0.5rem;
	}

	.progress-fill {
		height: 100%;
		background: var(--accent-default);
		transition: width 200ms ease-out;
	}

	.progress-stats {
		display: flex;
		gap: 0.75rem;
		flex-wrap: wrap;
		font-size: 0.75rem;
		color: var(--text-secondary);
	}

	.stat {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
	}

	.stat.blocked {
		color: var(--status-caution);
		font-weight: 500;
	}

	.task-panel {
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

	.panel-actions {
		display: flex;
		gap: 0.5rem;
		align-items: center;
	}

	.new-task-btn {
		background: none;
		border: 1px solid var(--border-default);
		color: var(--accent-default);
		padding: 0.25rem 0.6rem;
		border-radius: 4px;
		cursor: pointer;
		font-size: 0.8rem;
	}

	.new-task-btn:hover {
		border-color: var(--accent-default);
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
	}

	.empty-state {
		text-align: center;
		padding: 2rem 1rem;
		color: var(--text-muted);
	}

	.empty-state p {
		margin: 0 0 0.75rem;
	}

	.empty-create-btn {
		background: none;
		border: 1px solid var(--border-default);
		color: var(--accent-default);
		padding: 0.5rem 1rem;
		border-radius: 6px;
		cursor: pointer;
		font-size: 0.85rem;
	}

	.auto-assign-btn {
		width: 100%;
		padding: 0.4rem;
		background: var(--bg-surface);
		border: 1px solid var(--border-default);
		border-radius: 4px;
		color: var(--text-secondary);
		cursor: pointer;
		font-size: 0.8rem;
		margin-bottom: 0.75rem;
	}

	.auto-assign-btn:hover {
		border-color: var(--border-strong);
		color: var(--text-primary);
	}

	.task-list {
		list-style: none;
		padding: 0;
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}

	.task-item {
		background: var(--bg-surface);
		border-radius: 6px;
		padding: 0.5rem 0.6rem;
		transition: opacity 150ms ease-out;
	}

	.task-item.blocked {
		opacity: 0.7;
	}

	.task-row {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.task-checkbox {
		background: none;
		border: none;
		cursor: pointer;
		padding: 0;
		min-width: 24px;
		min-height: 24px;
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.status-icon {
		font-size: 0.9rem;
		color: var(--text-secondary);
	}

	.task-info {
		flex: 1;
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
		min-width: 0;
	}

	.task-header {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		min-width: 0;
	}

	.task-title {
		font-size: 0.85rem;
		color: var(--text-primary);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		flex: 1;
	}

	.blocked-indicator {
		display: inline-flex;
		align-items: center;
		padding: 0.1rem 0.4rem;
		background: var(--status-caution);
		color: var(--bg-base);
		border-radius: 3px;
		font-size: 0.65rem;
		font-weight: 600;
		white-space: nowrap;
		flex-shrink: 0;
	}

	.task-title.completed {
		text-decoration: line-through;
		color: var(--text-muted);
	}

	.task-due {
		font-size: 0.7rem;
		color: var(--status-caution);
	}

	.task-meta {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		position: relative;
		flex-shrink: 0;
	}

	.assignee-btn {
		background: none;
		border: none;
		color: var(--text-muted);
		cursor: pointer;
		font-size: 0.75rem;
		padding: 0.15rem 0.3rem;
		border-radius: 3px;
	}

	.assignee-btn:hover {
		background: var(--bg-raised);
		color: var(--text-secondary);
	}

	.assign-dropdown {
		position: absolute;
		top: 100%;
		right: 0;
		background: var(--bg-raised);
		border: 1px solid var(--border-default);
		border-radius: 4px;
		z-index: 50;
		min-width: 120px;
		padding: 0.25rem 0;
	}

	.assign-dropdown button {
		display: block;
		width: 100%;
		text-align: left;
		background: none;
		border: none;
		color: var(--text-primary);
		padding: 0.35rem 0.6rem;
		cursor: pointer;
		font-size: 0.8rem;
	}

	.assign-dropdown button:hover {
		background: var(--bg-overlay);
	}

	.lock-icon {
		font-size: 0.6rem;
		opacity: 0.3;
	}

	.dependencies {
		margin-top: 0.5rem;
		padding: 0.5rem;
		background: var(--bg-overlay);
		border-left: 2px solid var(--status-caution);
		border-radius: 3px;
		font-size: 0.75rem;
	}

	.blocked-by {
		display: flex;
		align-items: center;
		gap: 0.35rem;
		color: var(--text-secondary);
		margin-bottom: 0.25rem;
	}

	.blocked-by:last-child {
		margin-bottom: 0;
	}

	.blocked-label {
		color: var(--status-caution);
		font-weight: 600;
		flex-shrink: 0;
	}

	.dep-title {
		color: var(--text-primary);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.subtask-progress {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		margin: 0.5rem 0;
		padding: 0 0.6rem;
	}

	.subtask-progress .progress-bar {
		flex: 1;
		height: 6px;
		margin: 0;
	}

	.subtask-progress .progress-text {
		font-size: 0.7rem;
		color: var(--text-muted);
		min-width: 30px;
		text-align: right;
		font-weight: 500;
	}

	.subtask-list {
		list-style: none;
		padding: 0 0 0 1.5rem;
		margin: 0.25rem 0 0;
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
	}

	.subtask-item {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		font-size: 0.8rem;
	}

	.toggle-completed {
		background: none;
		border: none;
		color: var(--text-muted);
		cursor: pointer;
		font-size: 0.8rem;
		padding: 0.5rem 0;
		width: 100%;
		text-align: left;
	}

	.toggle-completed:hover {
		color: var(--text-secondary);
	}

	.completed-list {
		opacity: 0.6;
	}

	/* Auto-assign preview modal */
	.modal-backdrop {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.5);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 200;
	}

	.preview-modal {
		background: var(--bg-surface);
		border: 1px solid var(--border-default);
		border-radius: 8px;
		padding: 1.25rem;
		max-width: 360px;
		width: 100%;
	}

	.preview-modal h4 {
		margin: 0 0 0.75rem;
		font-weight: 500;
		font-size: 0.95rem;
	}

	.preview-list {
		list-style: none;
		padding: 0;
		margin: 0 0 1rem;
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
		font-size: 0.85rem;
	}

	.current-load {
		color: var(--text-muted);
		font-size: 0.75rem;
	}

	.preview-actions {
		display: flex;
		gap: 0.75rem;
	}

	.confirm-btn {
		flex: 1;
		padding: 0.5rem;
		background: var(--btn-primary-bg);
		color: var(--text-inverse);
		border: none;
		border-radius: 6px;
		cursor: pointer;
		font-weight: 500;
	}

	.confirm-btn:hover {
		background: var(--btn-primary-hover);
	}

	.cancel-btn {
		padding: 0.5rem 1rem;
		background: none;
		border: 1px solid var(--border-default);
		border-radius: 6px;
		color: var(--text-secondary);
		cursor: pointer;
	}

	/* Inline editing */
	.task-title.editable {
		background: none;
		border: none;
		cursor: pointer;
		text-align: left;
		padding: 0;
		color: var(--text-primary);
		font-size: 0.85rem;
		font-weight: inherit;
		font-family: inherit;
	}

	.task-title.editable:hover {
		color: var(--accent-default);
	}

	.task-due.editable {
		background: none;
		border: none;
		cursor: pointer;
		text-align: left;
		padding: 0;
		color: var(--status-caution);
		font-size: 0.7rem;
		font-weight: inherit;
		font-family: inherit;
	}

	.task-due.editable:hover {
		color: var(--accent-default);
	}

	.inline-edit {
		background: var(--bg-base);
		border: 1px solid var(--accent-default);
		border-radius: 3px;
		padding: 0.2rem 0.4rem;
		font-size: 0.85rem;
		color: var(--text-primary);
		width: 100%;
		font-family: inherit;
	}

	.inline-edit:focus {
		outline: none;
		border-color: var(--accent-default);
		background: var(--bg-base);
	}

	/* Mobile: full width */
	@media (max-width: 767px) {
		.task-panel {
			border-left: none;
		}
	}
</style>
