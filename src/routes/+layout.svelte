<script lang="ts">
	import favicon from '$lib/assets/favicon.svg';
	import '../theme.css';
	import { browser } from '$app/environment';
	import { onMount } from 'svelte';
	import { page } from '$app/stores';
	import { isDark, initTheme, toggleTheme } from '$lib/theme.svelte';

	let { children } = $props();

	// Show top nav on pages that don't have their own header (i.e. homepage)
	let isRoomPage = $derived($page.url.pathname.startsWith('/room/'));

	onMount(() => {
		initTheme();
	});
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
</svelte:head>

{#if browser && !isRoomPage}
	<nav class="global-nav">
		<span class="nav-brand">weave<span class="nav-brand-accent">to.do</span></span>
		<button class="theme-toggle-inline" onclick={toggleTheme} aria-label="Toggle light/dark mode" title="Toggle light/dark mode">
			{isDark() ? '\u2600' : '\u263E'}
		</button>
	</nav>
{/if}

{@render children()}

<style>
	.global-nav {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 0.5rem 1rem;
		position: fixed;
		top: 0;
		left: 0;
		right: 0;
		z-index: 50;
	}

	.nav-brand {
		font-size: 0.8rem;
		font-weight: 300;
		letter-spacing: 0.08em;
		color: var(--text-muted);
	}

	.nav-brand-accent {
		color: var(--accent-default);
	}

	.theme-toggle-inline {
		background: none;
		border: 1px solid var(--border-default);
		color: var(--text-secondary);
		width: 2rem;
		height: 2rem;
		border-radius: 50%;
		cursor: pointer;
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 1rem;
		line-height: 1;
		padding: 0;
		transition: border-color 0.15s, color 0.15s;
	}

	.theme-toggle-inline:hover {
		border-color: var(--border-strong);
		color: var(--text-primary);
	}

	.theme-toggle-inline:focus-visible {
		outline: 2px solid var(--accent-default);
		outline-offset: 2px;
	}
</style>
