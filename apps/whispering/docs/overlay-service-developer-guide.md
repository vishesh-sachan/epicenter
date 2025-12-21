# Overlay Service Developer Guide

## Overview

This guide shows you how to add new features to the overlay system. Whether you're adding a new overlay mode, integrating a new recorder type, or customizing the overlay UI, this document walks you through the process step-by-step.

## Adding a New Overlay Mode

Let's add a "paused" mode that shows when recording is paused.

### Step 1: Update TypeScript Types

**File:** `src/lib/services/overlay/types.ts`

Add the new mode to the `OverlayMode` union:

```typescript
export type OverlayMode =
	| 'recording'
	| 'transcribing'
	| 'transforming'
	| 'paused'      // ← Add your new mode
	| 'hidden';
```

Add any mode-specific data to `OverlayData`:

```typescript
export interface OverlayData {
	audioLevels?: number[];
	text?: string;
	progress?: number;
	pausedDuration?: number;  // ← Add mode-specific data
}
```

### Step 2: Add Service Method

**File:** `src/lib/services/overlay/overlay-service.ts`

Add a method to show your new mode:

```typescript
class OverlayService {
	// ... existing methods

	/**
	 * Show the overlay in paused mode
	 */
	async showPaused(duration: number): Promise<Result<void, WhisperingError>> {
		const position = settings.value['recorder.overlay.position'];
		
		console.info('[OverlayService] Showing paused overlay', { position, duration });

		const { error } = await tryAsync({
			try: () =>
				invoke('show_overlay_command', {
					mode: 'paused',
					position,
					data: { pausedDuration: duration },
				}),
			catch: (error) =>
				WhisperingErr({
					title: '❌ Failed to show paused overlay',
					description: 'Could not display paused overlay window.',
					action: { type: 'more-details', error },
				}),
		});

		if (error) {
			console.error('[OverlayService] Failed to show paused overlay', error);
			return Err(error);
		}

		this.state.mode = 'paused';
		this.state.position = position;
		this.state.data = { pausedDuration: duration };

		return Ok(undefined);
	}
}
```

**Usage in your recorder:**
```typescript
await overlayService.showPaused(30); // 30 seconds paused
```

### Step 3: Update Rust Types

**File:** `src-tauri/src/overlay.rs`

Add the mode to Rust's `OverlayMode` enum:

```rust
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum OverlayMode {
    Recording,
    Transcribing,
    Transforming,
    Paused,      // ← Add your new mode
    Hidden,
}
```

Add mode-specific data to `OverlayData`:

```rust
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct OverlayData {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub audio_levels: Option<Vec<f32>>,
    
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    
    #[serde(skip_serializing_if = "Option::is_none")]
    pub progress: Option<u8>,
    
    #[serde(skip_serializing_if = "Option::is_none")]
    pub paused_duration: Option<u32>,  // ← Add mode-specific data
}
```

No changes needed to the Rust commands—they already handle any mode.

### Step 4: Update Overlay UI

**File:** `src/overlay/RecordingOverlay.svelte`

Add UI for your new mode:

```svelte
<script lang="ts">
	import type { OverlayState } from '$lib/services/overlay';
	import { listen } from '@tauri-apps/api/event';
	
	let overlayState: OverlayState = $state({
		mode: 'hidden',
		position: 'None',
		data: {},
	});
	
	listen<OverlayState>('overlay-state', (event) => {
		overlayState = event.payload;
	});
</script>

<div class="overlay-container">
	{#if overlayState.mode === 'recording'}
		<!-- Existing recording UI -->
	{:else if overlayState.mode === 'transcribing'}
		<!-- Existing transcribing UI -->
	{:else if overlayState.mode === 'transforming'}
		<!-- Existing transforming UI -->
	{:else if overlayState.mode === 'paused'}
		<!-- New paused UI -->
		<div class="paused-container">
			<div class="paused-icon">⏸️</div>
			<div class="paused-text">
				Recording paused: {overlayState.data.pausedDuration}s
			</div>
		</div>
	{/if}
</div>

<style>
	.paused-container {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 16px;
		background: rgba(0, 0, 0, 0.8);
		border-radius: 12px;
	}
	
	.paused-icon {
		font-size: 24px;
	}
	
	.paused-text {
		color: white;
		font-size: 14px;
	}
</style>
```

### Step 5: Test Your New Mode

**Manual test:**
```typescript
// In browser console or test file
import { overlayService } from '$lib/services/overlay';

// Show paused overlay
await overlayService.showPaused(30);

// Update duration
await overlayService.updateData({ pausedDuration: 45 });

// Hide overlay
await overlayService.hide();
```

**Unit test:**
```typescript
import { describe, it, expect, vi } from 'vitest';
import { overlayService } from '$lib/services/overlay';
import { invoke } from '@tauri-apps/api/core';

vi.mock('@tauri-apps/api/core');

describe('OverlayService - Paused Mode', () => {
	it('shows paused overlay with duration', async () => {
		const mockInvoke = vi.mocked(invoke);
		mockInvoke.mockResolvedValue(undefined);
		
		const result = await overlayService.showPaused(30);
		
		expect(result.ok).toBe(true);
		expect(mockInvoke).toHaveBeenCalledWith('show_overlay_command', {
			mode: 'paused',
			position: expect.any(String),
			data: { pausedDuration: 30 },
		});
	});
});
```

## Integrating a New Recorder Type

Let's integrate a hypothetical "remote" recorder that captures audio from a network stream.

### Step 1: Create Recorder Service

**File:** `src/lib/services/recorder/remote.ts`

```typescript
import { overlayService } from '$lib/services/overlay';
import { WhisperingErr, type WhisperingError } from '$lib/result';
import { Err, Ok, tryAsync, type Result } from 'wellcrafted/result';

interface RemoteRecorderOptions {
	streamUrl: string;
	onAudioLevels?: (levels: number[]) => void;
}

export function createRemoteRecorder(options: RemoteRecorderOptions) {
	let audioMonitor: NodeJS.Timeout | null = null;
	let isRecording = false;

	return {
		async start(): Promise<Result<void, WhisperingError>> {
			// Show overlay in recording mode
			const showResult = await overlayService.showRecording();
			if (showResult.error) return showResult;

			// Connect to remote stream
			const { data: stream, error } = await tryAsync({
				try: async () => {
					const response = await fetch(options.streamUrl);
					return response.body;
				},
				catch: (error) =>
					WhisperingErr({
						title: '🌐 Connection Failed',
						description: 'Could not connect to remote audio stream.',
						action: { type: 'more-details', error },
					}),
			});

			if (error) {
				await overlayService.hide();
				console.error('[RemoteRecorder] Failed to connect', error);
				return Err(error);
			}

			isRecording = true;

			// Start audio level monitoring
			audioMonitor = setInterval(() => {
				if (!isRecording) return;
				
				// Compute audio levels from stream
				const levels = computeLevelsFromStream(stream);
				
				// Update overlay with audio levels
				overlayService.updateAudioLevels(levels);
				
				// Call user callback if provided
				options.onAudioLevels?.(levels);
			}, 16); // ~60 FPS

			console.info('[RemoteRecorder] Started recording', { streamUrl: options.streamUrl });
			return Ok(undefined);
		},

		async stop(): Promise<Result<Blob, WhisperingError>> {
			isRecording = false;

			if (audioMonitor) {
				clearInterval(audioMonitor);
				audioMonitor = null;
			}

			// Switch to transcribing mode
			await overlayService.showTranscribing('Transcribing...');

			// Get recorded audio blob
			const { data: blob, error } = await tryAsync({
				try: () => fetchRecordedAudio(),
				catch: (error) =>
					WhisperingErr({
						title: '❌ Failed to retrieve recording',
						description: 'Could not fetch recorded audio from remote stream.',
						action: { type: 'more-details', error },
					}),
			});

			if (error) {
				await overlayService.hide();
				console.error('[RemoteRecorder] Failed to stop', error);
				return Err(error);
			}

			console.info('[RemoteRecorder] Stopped recording', { size: blob.size });
			return Ok(blob);
		},

		async cancel(): Promise<Result<void, WhisperingError>> {
			isRecording = false;

			if (audioMonitor) {
				clearInterval(audioMonitor);
				audioMonitor = null;
			}

			// Hide overlay
			const hideResult = await overlayService.hide();
			if (hideResult.error) {
				console.warn('[RemoteRecorder] Failed to hide overlay', hideResult.error);
			}

			console.info('[RemoteRecorder] Cancelled recording');
			return Ok(undefined);
		},
	};
}

function computeLevelsFromStream(stream: ReadableStream): number[] {
	// Your audio analysis logic here
	return Array.from({ length: 9 }, () => Math.random());
}

async function fetchRecordedAudio(): Promise<Blob> {
	// Your logic to fetch recorded audio
	return new Blob();
}

export const RemoteRecorderLive = createRemoteRecorder({
	streamUrl: 'https://example.com/audio-stream',
});
```

### Step 2: Wire into Query Layer

**File:** `src/lib/query/recorder.ts`

Add your recorder to the recorder factory:

```typescript
import { RemoteRecorderLive } from '$lib/services/recorder/remote';

function createRecorder(type: RecorderType) {
	switch (type) {
		case 'navigator':
			return NavigatorRecorderLive;
		case 'cpal':
			return CpalRecorderLive;
		case 'remote':  // ← Add your recorder type
			return RemoteRecorderLive;
		default:
			throw new Error(`Unknown recorder type: ${type}`);
	}
}
```

### Step 3: Add Settings Support

**File:** `src/lib/settings/settings.ts`

Add recorder type to settings:

```typescript
export const settingsSchema = z.object({
	// ... existing settings
	'recorder.type': z.enum(['navigator', 'cpal', 'remote']).default('navigator'),
});
```

**File:** `src/routes/(app)/(config)/settings/recorder/+page.svelte`

Add UI for selecting remote recorder:

```svelte
<LabeledSelect
	id="recorder-type"
	label="Recording Source"
	items={[
		{ value: 'navigator', label: 'Browser (Navigator)' },
		{ value: 'cpal', label: 'System Audio (CPAL)' },
		{ value: 'remote', label: 'Remote Stream' },
	]}
	bind:selected={
		() => settings.value['recorder.type'],
		(selected) => settings.updateKey('recorder.type', selected)
	}
/>

{#if settings.value['recorder.type'] === 'remote'}
	<LabeledInput
		id="remote-stream-url"
		label="Stream URL"
		placeholder="https://example.com/audio-stream"
		value={settings.value['recorder.remote.streamUrl']}
		oninput={({ currentTarget: { value } }) => {
			settings.updateKey('recorder.remote.streamUrl', value);
		}}
	/>
{/if}
```

### Step 4: Test Your Recorder

```typescript
import { RemoteRecorderLive } from '$lib/services/recorder/remote';

// Start recording
const startResult = await RemoteRecorderLive.start();
if (startResult.error) {
	console.error('Failed to start:', startResult.error);
	return;
}

// Recording... overlay showing audio bars

// Stop recording
const stopResult = await RemoteRecorderLive.stop();
if (stopResult.error) {
	console.error('Failed to stop:', stopResult.error);
	return;
}

console.log('Recorded blob:', stopResult.data);
```

## Customizing Overlay Appearance

### Adding a Settings Toggle

Let's add a setting to show/hide the audio bars.

**Step 1: Add setting**

**File:** `src/lib/settings/settings.ts`

```typescript
export const settingsSchema = z.object({
	// ... existing settings
	'recorder.overlay.showAudioBars': z.boolean().default(true),
});
```

**Step 2: Update overlay UI**

**File:** `src/overlay/RecordingOverlay.svelte`

```svelte
<script lang="ts">
	import { settings } from '$lib/stores/settings.svelte';
	
	// ... existing code
</script>

{#if overlayState.mode === 'recording'}
	<div class="recording-container">
		{#if settings.value['recorder.overlay.showAudioBars']}
			<!-- Show audio bars -->
			<div class="audio-bars">
				{#each overlayState.data.audioLevels || [] as level}
					<div
						class="bar"
						style="height: {level * 100}%"
					></div>
				{/each}
			</div>
		{:else}
			<!-- Show simple recording indicator -->
			<div class="recording-indicator">
				🎤 Recording...
			</div>
		{/if}
	</div>
{/if}
```

**Step 3: Add UI control**

**File:** `src/routes/(app)/(config)/settings/recorder/+page.svelte`

```svelte
<LabeledToggle
	id="show-audio-bars"
	label="Show Audio Bars"
	checked={settings.value['recorder.overlay.showAudioBars']}
	onchange={(checked) => {
		settings.updateKey('recorder.overlay.showAudioBars', checked);
	}}
>
	{#snippet description()}
		Display animated audio bars in the recording overlay.
	{/snippet}
</LabeledToggle>
```

## Best Practices

### 1. Always Use the Service

❌ **Don't** call Rust commands directly:
```typescript
// Bad
import { invoke } from '@tauri-apps/api/core';
await invoke('show_overlay_command', { mode: 'recording', position: 'Top', data: {} });
```

✅ **Do** use the overlay service:
```typescript
// Good
import { overlayService } from '$lib/services/overlay';
await overlayService.showRecording();
```

### 2. Handle Errors Properly

❌ **Don't** ignore errors:
```typescript
// Bad
await overlayService.showRecording();
```

✅ **Do** check for errors:
```typescript
// Good
const result = await overlayService.showRecording();
if (result.error) {
	console.error('Failed to show overlay:', result.error);
	// Handle error appropriately
}
```

### 3. Clean Up Resources

❌ **Don't** leave overlay visible:
```typescript
// Bad
async function record() {
	await overlayService.showRecording();
	// ... recording logic
	// Forgot to hide overlay!
}
```

✅ **Do** always hide overlay when done:
```typescript
// Good
async function record() {
	await overlayService.showRecording();
	try {
		// ... recording logic
	} finally {
		await overlayService.hide();
	}
}
```

### 4. Update Audio Levels Efficiently

❌ **Don't** update too frequently:
```typescript
// Bad - Updates every millisecond
setInterval(() => {
	overlayService.updateAudioLevels(levels);
}, 1);
```

✅ **Do** use requestAnimationFrame or ~60 FPS:
```typescript
// Good - Updates at 60 FPS
setInterval(() => {
	overlayService.updateAudioLevels(levels);
}, 16); // ~60 FPS
```

### 5. Keep Logging Strategic

❌ **Don't** log excessively:
```typescript
// Bad
console.log('Updating levels:', levels);
console.log('Level 0:', levels[0]);
console.log('Level 1:', levels[1]);
// ...
```

✅ **Do** log only important events:
```typescript
// Good
console.info('[MyRecorder] Started recording');
console.error('[MyRecorder] Failed to record:', error);
```

## Common Patterns

### Pattern 1: Recording Lifecycle

```typescript
async function recordingLifecycle() {
	// 1. Start recording - show overlay
	const startResult = await overlayService.showRecording();
	if (startResult.error) return;

	// 2. During recording - update audio levels
	const audioMonitor = setInterval(() => {
		const levels = computeAudioLevels();
		overlayService.updateAudioLevels(levels);
	}, 16);

	// 3. Stop recording - show transcribing
	clearInterval(audioMonitor);
	await overlayService.showTranscribing('Transcribing...');

	// 4. Transcription complete - hide overlay
	await overlayService.hide();
}
```

### Pattern 2: Transformation with Pulsing Text

```typescript
async function transformText(text: string) {
	// Show transforming overlay with pulsing text
	await overlayService.showTransforming();

	// Make API call (text pulses automatically)
	const result = await apiClient.transform(text);

	// Hide when complete
	await overlayService.hide();

	return result;
}
```

### Pattern 3: Error Recovery

```typescript
async function recordWithErrorRecovery() {
	const showResult = await overlayService.showRecording();
	if (showResult.error) {
		console.error('Failed to show overlay:', showResult.error);
		// Continue recording without overlay
	}

	try {
		// ... recording logic
	} catch (error) {
		// Always try to hide overlay on error
		await overlayService.hide();
		throw error;
	}
}
```

## Troubleshooting

### Overlay Not Showing

**Problem:** `overlayService.showRecording()` succeeds but overlay not visible

**Solutions:**
1. Check position setting: `settings.value['recorder.overlay.position']` should not be `'None'`
2. Check if overlay window exists: Use Tauri devtools to inspect windows
3. Check for Rust errors: Look in terminal for overlay.rs errors

### TypeScript Type Errors

**Problem:** Type mismatch when calling overlay service methods

**Solution:** Ensure your data matches the `OverlayData` interface:
```typescript
// Check types match
const data: OverlayData = {
	audioLevels: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9], // Exactly 9
	text: 'Some text',
	progress: 50, // Must be 0-100
};

await overlayService.updateData(data);
```

### Audio Bars Not Animating

**Problem:** Bars shown but not moving

**Solutions:**
1. Verify `updateAudioLevels()` is being called continuously
2. Check audio levels are valid: array of 9 numbers between 0-1
3. Check amplification: values might be too small, increase multiplier

## Related Documentation

- [Overlay Service Architecture](./overlay-service-architecture.md)
- [Whispering Architecture Deep Dive](./ARCHITECTURE.md)
- [Services Layer README](../src/lib/services/README.md)
- [Recording Overlay Refactor](./whispering-overlay-refactor.md)

## Contributing New Features

When adding new overlay features:

1. **Discuss First:** Open a GitHub issue to discuss your feature
2. **Follow Patterns:** Study existing code in overlay service
3. **Add Tests:** Write unit tests for new TypeScript code
4. **Update Docs:** Add your feature to this guide
5. **Test Manually:** Verify overlay works on all platforms (macOS, Windows, Linux)

Need help? Join our [Discord community](https://go.epicenterhq.com/discord) or open a GitHub issue!
