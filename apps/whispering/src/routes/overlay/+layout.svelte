<script lang="ts">
	let { children } = $props();
</script>

{@render children()}

<style>
	:global(html),
	:global(body) {
		background: transparent !important;
		margin: 0;
		padding: 0;
		overflow: hidden;
	}

	/* Hide TanStack Query Devtools button */
	:global(.tsqd-parent-container) {
		display: none !important;
		visibility: hidden !important;
		pointer-events: none !important;
	}

	/* Hide Svelte Inspector button */
	:global(#svelte-inspector-host),
	:global(#svelte-inspector-toggle) {
		display: none !important;
	}
</style>
