<script lang="ts">
	import { onMount } from 'svelte';
	import { listen, type UnlistenFn } from '@tauri-apps/api/event';
	import { invoke } from '@tauri-apps/api/core';
	import { MicrophoneIcon, TranscriptionIcon, CancelIcon } from './icons';
	import './RecordingOverlay.css';

	type OverlayState = 'recording' | 'transcribing';

	let isVisible = $state(false);
	let state = $state<OverlayState>('recording');
	let levels = $state<number[]>(Array(9).fill(0));
	let smoothedLevels = $state<number[]>(Array(9).fill(0));

	let unlistenShow: UnlistenFn | null = null;
	let unlistenHide: UnlistenFn | null = null;
	let unlistenLevel: UnlistenFn | null = null;

	onMount(() => {
		(async () => {
			// Listen for show-overlay event from Rust
			console.log('[OVERLAY SVELTE] Setting up show-overlay listener');
			unlistenShow = await listen<OverlayState>('show-overlay', (event) => {
				console.log(
					'[OVERLAY SVELTE] Received show-overlay event:',
					event.payload,
					'Type:',
					typeof event.payload,
				);
				const overlayState = event.payload as OverlayState;
				console.log('[OVERLAY SVELTE] Setting state to:', overlayState);
				state = overlayState;
				isVisible = true;
				console.log(
					'[OVERLAY SVELTE] After update - isVisible=',
					isVisible,
					'state=',
					state,
				);
			});

			// Listen for hide-overlay event from Rust
			console.log('[OVERLAY SVELTE] Setting up hide-overlay listener');
			unlistenHide = await listen('hide-overlay', () => {
				console.log('[OVERLAY SVELTE] Received hide-overlay event');
				isVisible = false;
			});

			// Listen for mic-level updates
			console.log('[OVERLAY SVELTE] Setting up mic-level listener');
			unlistenLevel = await listen<number[]>('mic-level', (event) => {
				const newLevels = event.payload;

				// Apply smoothing to reduce jitter
				const smoothed = smoothedLevels.map((prev, i) => {
					const target = newLevels[i] || 0;
					return prev * 0.7 + target * 0.3; // Smooth transition
				});

				smoothedLevels = smoothed;
				levels = smoothed.slice(0, 9);
			});
			console.log('[OVERLAY SVELTE] All event listeners set up successfully');
		})();

		// Cleanup function
		return () => {
			console.log('[OVERLAY SVELTE] Cleaning up event listeners');
			unlistenShow?.();
			unlistenHide?.();
			unlistenLevel?.();
		};
	});

	// Log state changes
	$effect(() => {
		console.log(
			'[OVERLAY SVELTE] State - isVisible:',
			isVisible,
			'state:',
			state,
		);
	});

	// Animate bars with realistic audio-like animation
	let animationInterval: number | null = null;
	let animationPhase = 0;

	$effect(() => {
		if (isVisible && state === 'recording') {
			// Start animation for visual feedback with more realistic behavior
			animationInterval = window.setInterval(() => {
				animationPhase += 0.15;

				// Create wave-like animation that simulates voice patterns
				levels = Array(9)
					.fill(0)
					.map((_, i) => {
						// Base sine wave with some randomness
						const baseLevel = Math.sin(animationPhase + i * 0.5) * 0.3 + 0.4;
						// Add random spikes to simulate speech
						const spike = Math.random() > 0.7 ? Math.random() * 0.3 : 0;
						// Add some noise
						const noise = (Math.random() - 0.5) * 0.1;

						return Math.max(0.1, Math.min(1, baseLevel + spike + noise));
					});
			}, 80);
		} else {
			if (animationInterval) {
				clearInterval(animationInterval);
				animationInterval = null;
			}
			// Reset levels when not recording
			if (state !== 'recording') {
				levels = Array(9).fill(0);
			}
		}

		return () => {
			if (animationInterval) {
				clearInterval(animationInterval);
			}
		};
	});

	function getIcon() {
		if (state === 'recording') {
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
	<!-- Debug info -->
	<div
		style="position: absolute; top: -20px; left: 0; color: white; font-size: 10px; background: rgba(0,0,0,0.8); padding: 2px 4px;"
	>
		State: {state} | Visible: {isVisible}
	</div>

	<div class="overlay-left">
		{@html getIcon()}
	</div>

	<div class="overlay-middle">
		{#if state === 'recording'}
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
		{:else}
			<div class="transcribing-text">Transcribing...</div>
		{/if}
	</div>

	<div class="overlay-right">
		{#if state === 'recording'}
			<button class="cancel-button" onclick={handleCancel} type="button">
				{@html CancelIcon}
			</button>
		{/if}
	</div>
</div>
