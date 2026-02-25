<script lang="ts">
  const { connected, reestablishing, pendingCount } = $props<{
    connected: boolean;
    reestablishing: boolean;
    pendingCount: number;
  }>();

  const label = $derived(() => {
    if (connected && !reestablishing) return '';
    if (reestablishing) return 'Reconnecting...';
    if (pendingCount > 0) return `Offline · ${pendingCount} pending`;
    return 'Offline';
  });
</script>

<span class="connection-status">
  <span class="connection-dot" class:online={connected && !reestablishing}></span>
  {#if label()}
    <span class="connection-label">{label()}</span>
  {/if}
</span>

<style>
  .connection-status {
    display: flex;
    align-items: center;
    gap: 0.375rem;
  }

  .connection-dot {
    width: 0.5rem;
    height: 0.5rem;
    border-radius: 50%;
    background: transparent;
    border: 1.5px solid var(--text-secondary, #888);
    flex-shrink: 0;
  }

  .connection-dot.online {
    background: #22c55e;
    border-color: #22c55e;
  }

  .connection-label {
    font-size: 0.75rem;
    color: var(--text-secondary, #888);
  }
</style>
