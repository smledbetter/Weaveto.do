<script lang="ts">
  type View = 'chat' | 'tasks' | 'automation';

  let {
    activeView = 'chat',
    taskCount = 0,
    agentCount = 0,
    onnavigate
  }: {
    activeView?: View;
    taskCount?: number;
    agentCount?: number;
    onnavigate?: (view: View) => void;
  } = $props();
</script>

<nav class="mobile-nav" aria-label="Room navigation">
  <button
    class="nav-item"
    class:active={activeView === 'chat'}
    onclick={() => onnavigate?.('chat')}
    aria-current={activeView === 'chat' ? 'page' : undefined}
  >
    <svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
    </svg>
    <span class="nav-label">Chat</span>
  </button>
  <button
    class="nav-item"
    class:active={activeView === 'tasks'}
    onclick={() => onnavigate?.('tasks')}
    aria-current={activeView === 'tasks' ? 'page' : undefined}
  >
    <svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <polyline points="9 11 12 14 22 4"/>
      <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>
    </svg>
    <span class="nav-label">Tasks</span>
    {#if taskCount > 0}
      <span class="nav-badge">{taskCount}</span>
    {/if}
  </button>
  <button
    class="nav-item"
    class:active={activeView === 'automation'}
    onclick={() => onnavigate?.('automation')}
    aria-current={activeView === 'automation' ? 'page' : undefined}
  >
    <svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
    </svg>
    <span class="nav-label">Auto</span>
    {#if agentCount > 0}
      <span class="nav-badge">{agentCount}</span>
    {/if}
  </button>
</nav>

<style>
  .mobile-nav {
    display: none; /* Hidden on desktop */
    border-top: 1px solid var(--border-subtle);
    background: var(--bg-surface);
    padding: 0.25rem 0;
    padding-bottom: env(safe-area-inset-bottom, 0);
  }

  .nav-item {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.15rem;
    padding: 0.5rem 0;
    min-height: 44px;
    background: none;
    border: none;
    color: var(--text-muted);
    cursor: pointer;
    position: relative;
    font-family: inherit;
    transition: color 0.15s;
  }

  .nav-item:focus-visible {
    outline: 2px solid var(--accent-default);
    outline-offset: -2px;
    border-radius: 4px;
  }

  .nav-item.active {
    color: var(--accent-default);
  }

  .nav-icon {
    width: 20px;
    height: 20px;
  }

  .nav-label {
    font-size: 0.65rem;
    font-weight: 500;
    letter-spacing: 0.02em;
  }

  .nav-badge {
    position: absolute;
    top: 0.25rem;
    right: calc(50% - 18px);
    min-width: 16px;
    height: 16px;
    padding: 0 4px;
    border-radius: 8px;
    background: var(--accent-default);
    color: var(--text-inverse);
    font-size: 0.6rem;
    font-weight: 600;
    display: flex;
    align-items: center;
    justify-content: center;
    line-height: 1;
  }

  @media (max-width: 767px) {
    .mobile-nav {
      display: flex;
    }
  }
</style>
