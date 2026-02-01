<script lang="ts">
	let { children } = $props();
</script>

<!-- Minimal layout for overlay - no dev tools, no query client, just the overlay component -->
{@render children()}

<style>
	/* Ensure transparent background for overlay */
	:global(html),
	:global(body) {
		background: transparent !important;
		margin: 0;
		padding: 0;
		overflow: hidden;
	}
</style>
