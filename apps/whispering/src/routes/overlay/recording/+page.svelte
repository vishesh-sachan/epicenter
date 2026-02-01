<script lang="ts">
	import { onMount } from 'svelte';
	import { listen, type UnlistenFn, emit } from '@tauri-apps/api/event';
	import { MicrophoneIcon, TranscriptionIcon, CancelIcon } from '$lib/components/overlay/icons';

	type OverlayMode = 'recording' | 'transcribing' | 'transforming' | 'hidden';
	type OverlayData = {
		audioLevels?: number[];
		text?: string;
	};
	type OverlayState = {
		mode: OverlayMode;
		position: string;
		data?: OverlayData;
	};

	let isVisible = $state(false);
	let mode = $state<OverlayMode>('hidden');
	let levels = $state<number[]>(Array(9).fill(0));
	let smoothedLevels = $state<number[]>(Array(9).fill(0));
	let hasReceivedAudioLevels = $state(false);

	let unlistenState: UnlistenFn | null = null;
	let unlistenHide: UnlistenFn | null = null;
	let unlistenDataUpdate: UnlistenFn | null = null;
	let unlistenLevel: UnlistenFn | null = null;

	onMount(() => {
		(async () => {
			// Listen for unified overlay-state event
			unlistenState = await listen<OverlayState>('overlay-state', (event) => {
				const { mode: newMode, data } = event.payload;
				mode = newMode;
				isVisible = newMode !== 'hidden';

				// Reset audio levels flag when mode changes
				if (newMode === 'recording') {
					hasReceivedAudioLevels = false;
				}

				if (data?.audioLevels) {
					updateAudioLevels(data.audioLevels);
				}
			});

			// Listen for data-only updates (audio levels from CPAL)
			unlistenDataUpdate = await listen<OverlayData>(
				'overlay-data-update',
				(event) => {
					const data = event.payload;
					if (data.audioLevels) {
						updateAudioLevels(data.audioLevels);
					}
				},
			);

			// Listen for hide-overlay event
			unlistenHide = await listen('hide-overlay', () => {
				isVisible = false;
				// Don't change mode immediately to avoid flashing different icons
				// Mode will be set to 'hidden' after fade-out completes
				setTimeout(() => {
					mode = 'hidden';
				}, 300);
			});

			// Legacy mic-level support for backwards compatibility
			unlistenLevel = await listen<number[]>('mic-level', (event) => {
				updateAudioLevels(event.payload);
			});
		})();

		// Cleanup function
		return () => {
			unlistenState?.();
			unlistenHide?.();
			unlistenDataUpdate?.();
			unlistenLevel?.();
		};
	});

	function updateAudioLevels(newLevels: number[]) {
		hasReceivedAudioLevels = true;

		// Apply smoothing to reduce jitter
		const smoothed = smoothedLevels.map((prev, i) => {
			const target = newLevels[i] || 0;
			return prev * 0.7 + target * 0.3; // Smooth transition
		});

		smoothedLevels = smoothed;
		levels = smoothed.slice(0, 9);
	}

	// Reset levels when not recording
	$effect(() => {
		if (mode !== 'recording') {
			levels = Array(9).fill(0);
		}
	});

	function getIcon() {
		if (mode === 'recording') {
			return MicrophoneIcon;
		} else {
			return TranscriptionIcon;
		}
	}

	async function handleCancel() {
		try {
			await emit('cancel-recording-request');
		} catch (error) {
			console.error('[OVERLAY] Failed to emit cancel event:', error);
		}
	}
</script>

<div class="recording-overlay" class:fade-in={isVisible}>
	<div class="overlay-left">
		{@html getIcon()}
	</div>

	<div class="overlay-middle">
		{#if mode === 'recording'}
			<div class="bars-container" class:pulsing={!hasReceivedAudioLevels}>
				{#each levels as level, i (i)}
					<div
						class="bar"
						style="
							height: {Math.min(20, 4 + Math.pow(level, 0.7) * 16)}px;
							transition: height 60ms ease-out, opacity 120ms ease-out;
							opacity: {Math.max(0.2, level * 1.7)};
						"
					></div>
				{/each}
			</div>
		{:else if mode === 'transcribing'}
			<div class="transcribing-text">Transcribing...</div>
		{:else if mode === 'transforming'}
			<div class="transcribing-text">Transforming...</div>
		{/if}
	</div>

	<div class="overlay-right">
		{#if mode === 'recording'}
			<button class="cancel-button" onclick={handleCancel} type="button">
				{@html CancelIcon}
			</button>
		{/if}
	</div>
</div>

<style>
	.recording-overlay {
		height: 36px;
		width: 172px;
		display: grid;
		grid-template-columns: auto 1fr auto;
		align-items: center;
		padding: 6px;
		background: oklch(0.208 0.042 265.755 / 0.95); /* --card with high opacity for visibility */
		border: 1px solid oklch(1 0 0 / 0.1); /* --border */
		border-radius: 18px;
		opacity: 1; /* Always visible for now - was: opacity: 0 */
		transition: opacity 300ms ease-out;
		box-sizing: border-box;
	}

	.overlay-left {
		display: flex;
		align-items: center;
	}

	.overlay-middle {
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.overlay-right {
		display: flex;
		align-items: center;
		justify-content: flex-end;
	}

	.bars-container {
		display: flex;
		align-items: end;
		justify-content: center;
		gap: 3px;
		padding-bottom: 0px;
		height: 24px;
		overflow: hidden;
	}

	.bar {
		width: 6px;
		background: oklch(0.929 0.013 255.508); /* --primary (light purple/gray) */
		max-height: 20px;
		border-radius: 2px;
		transition: height 80ms linear;
		min-height: 4px;
	}

	/* Pulsing animation for bars when no real audio levels (e.g., FFmpeg) */
	.bars-container.pulsing .bar {
		animation: pulse-bar 1.5s ease-in-out infinite;
		animation-delay: calc(var(--bar-index, 0) * 0.1s);
	}

	.bars-container.pulsing .bar:nth-child(1) {
		--bar-index: 0;
		height: 8px;
	}
	.bars-container.pulsing .bar:nth-child(2) {
		--bar-index: 1;
		height: 12px;
	}
	.bars-container.pulsing .bar:nth-child(3) {
		--bar-index: 2;
		height: 16px;
	}
	.bars-container.pulsing .bar:nth-child(4) {
		--bar-index: 3;
		height: 18px;
	}
	.bars-container.pulsing .bar:nth-child(5) {
		--bar-index: 4;
		height: 20px;
	}
	.bars-container.pulsing .bar:nth-child(6) {
		--bar-index: 5;
		height: 18px;
	}
	.bars-container.pulsing .bar:nth-child(7) {
		--bar-index: 6;
		height: 16px;
	}
	.bars-container.pulsing .bar:nth-child(8) {
		--bar-index: 7;
		height: 12px;
	}
	.bars-container.pulsing .bar:nth-child(9) {
		--bar-index: 8;
		height: 8px;
	}

	@keyframes pulse-bar {
		0%,
		100% {
			opacity: 0.4;
			transform: scaleY(0.6);
		}
		50% {
			opacity: 1;
			transform: scaleY(1);
		}
	}

	.recording-overlay.fade-in {
		opacity: 1;
	}

	.transcribing-text {
		color: oklch(0.984 0.003 247.858); /* --foreground (light text) */
		font-size: 12px;
		font-family:
			'Manrope Variable',
			-apple-system,
			BlinkMacSystemFont,
			'Segoe UI',
			Roboto,
			sans-serif;
		animation: transcribing-pulse 1.5s infinite ease-in-out;
	}

	@keyframes transcribing-pulse {
		0%,
		100% {
			opacity: 0.6;
		}
		50% {
			opacity: 1;
		}
	}

	.cancel-button {
		width: 24px;
		height: 24px;
		border-radius: 50%;
		background: transparent;
		border: none;
		padding: 0;
		margin: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		cursor: pointer;
		pointer-events: auto;
		transition:
			background-color 150ms ease-out,
			transform 100ms ease-out;
		flex-shrink: 0;
	}

	.cancel-button:hover {
		background-color: oklch(1 0 0 / 0.1);
		transform: scale(1.05);
	}

	.cancel-button:active {
		background-color: oklch(1 0 0 / 0.15);
		transform: scale(0.95);
	}

	/* Hide Svelte inspector in overlay window - it interferes with the small UI */
	:global(#svelte-inspector-toggle) {
		display: none !important;
	}

	/* Make page background transparent for overlay window */
	:global(html),
	:global(body) {
		background: transparent !important;
		margin: 0;
		padding: 0;
		overflow: hidden;
	}
</style>
