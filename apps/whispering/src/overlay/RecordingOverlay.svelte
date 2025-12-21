<script lang="ts">
	import { onMount } from 'svelte';
	import { listen, type UnlistenFn } from '@tauri-apps/api/event';
	import { invoke } from '@tauri-apps/api/core';
	import { MicrophoneIcon, TranscriptionIcon, CancelIcon } from './icons';
	import './RecordingOverlay.css';

	type OverlayMode = 'recording' | 'transcribing' | 'transforming' | 'hidden';
	type OverlayData = {
		audioLevels?: number[];
		text?: string;
		progress?: number;
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
				mode = 'hidden';
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
			await invoke('cancel_recording');
		} catch (error) {
			console.error('Failed to cancel recording:', error);
		}
	}
</script>

<div class="recording-overlay" class:fade-in={isVisible}>
	<div class="overlay-left">
		{@html getIcon()}
	</div>

	<div class="overlay-middle">
		{#if mode === 'recording'}
			<div class="bars-container">
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
