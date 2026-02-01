# Overlay Service Architecture

## Overview

The Overlay Service provides a centralized system for managing the recording overlay window in Whispering. It uses a unified TypeScript service that coordinates between the application's recorder services and Rust's overlay window management. The overlay UI is implemented as a SvelteKit route (`/overlay/recording`) for simplified build and development.

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                    Application Layer                         │
│  (Recorders, VAD, Settings, Actions)                        │
└────────────────────────┬────────────────────────────────────┘
                         │
                         │ overlayService.showRecording()
                         │ overlayService.updateAudioLevels()
                         │ overlayService.hide()
                         │
┌────────────────────────▼────────────────────────────────────┐
│              TypeScript OverlayService                       │
│  - Reads position from settings automatically               │
│  - Maintains overlay state                                   │
│  - Provides type-safe API                                    │
└────────────────────────┬────────────────────────────────────┘
                         │
                         │ invoke('show_overlay_command')
                         │ invoke('update_overlay_data_command')
                         │ invoke('hide_overlay_command')
                         │
┌────────────────────────▼────────────────────────────────────┐
│              Rust Overlay Commands                           │
│  - Manages overlay window lifecycle                          │
│  - Emits 'overlay-state' events                             │
│  - Window positioning and visibility                         │
│  - Opens WebviewUrl::App("/overlay/recording")              │
└────────────────────────┬────────────────────────────────────┘
                         │
                         │ emit('overlay-state')
                         │
┌────────────────────────▼────────────────────────────────────┐
│      SvelteKit Route: /overlay/recording                     │
│  - Listens for 'overlay-state' events                       │
│  - Renders UI (bars, text, progress)                        │
│  - Handles multiple modes                                    │
│  - SSR disabled for Tauri API compatibility                 │
└──────────────────────────────────────────────────────────────┘
```

## Core Components

### 1. TypeScript Service Layer

**Location:** `src/lib/services/overlay/`

#### Types (`types.ts`)

```typescript
export type OverlayMode = 
  | 'recording'     // Showing audio bars
  | 'transcribing'  // Showing transcription text
  | 'transforming'  // Showing transformation in progress
  | 'hidden';       // Overlay not visible

export type OverlayPosition = 'Top' | 'Bottom' | 'None';

export interface OverlayData {
  audioLevels?: number[];      // 9-bar audio visualization
  text?: string;               // Transcription/transformation text
}

export interface OverlayState {
  mode: OverlayMode;
  position: OverlayPosition;
  data: OverlayData;
}
```

#### Service (`overlay-service.ts`)

The `OverlayService` class provides a singleton instance that manages all overlay interactions:

```typescript
class OverlayService {
  private state: OverlayState;
  
  // Show overlay in recording mode with audio bars
  showRecording(): Promise<Result<void, WhisperingError>>;
  
  // Show overlay in transcribing mode with text
  showTranscribing(text: string): Promise<Result<void, WhisperingError>>;
  
  // Show overlay in transforming mode with pulsing text
  showTransforming(): Promise<Result<void, WhisperingError>>;
  
  // Update only the data without changing mode/position
  updateData(data: Partial<OverlayData>): Promise<Result<void, WhisperingError>>;
  
  // Update audio levels specifically (common operation)
  updateAudioLevels(levels: number[]): Promise<Result<void, WhisperingError>>;
  
  // Hide the overlay
  hide(): Promise<Result<void, WhisperingError>>;
  
  // Get current state (synchronous)
  getState(): OverlayState;
}
```

**Key Features:**
- **Settings Integration:** Automatically reads `recorder.overlay.position` from settings
- **Type Safety:** Full TypeScript types prevent invalid state combinations
- **Error Handling:** Returns `Result<T, E>` for all operations using WellCrafted pattern
- **State Management:** Maintains internal state for debugging and introspection
- **Single Responsibility:** Only handles overlay coordination, not business logic

### 2. Rust Command Layer

**Location:** `src-tauri/src/overlay.rs`

#### Commands

Three unified commands replace the previous scattered command structure:

```rust
#[tauri::command]
pub async fn show_overlay_command(
    mode: OverlayMode,
    position: OverlayPosition,
    data: OverlayData,
    app: AppHandle,
) -> Result<(), String>

#[tauri::command]
pub async fn update_overlay_data_command(
    data: OverlayData,
    app: AppHandle,
) -> Result<(), String>

#[tauri::command]
pub async fn hide_overlay_command(
    app: AppHandle,
) -> Result<(), String>
```

**Key Features:**
- **Window Management:** Creates, positions, and destroys overlay window
- **Event Emission:** Emits `overlay-state` events to the overlay window
- **Error Handling:** Returns `Result<(), String>` with descriptive error messages
- **Backward Compatibility:** Legacy commands kept for gradual migration

#### State Events

The overlay window receives state updates via the `overlay-state` event:

```rust
#[derive(Clone, serde::Serialize)]
pub struct OverlayState {
    pub mode: OverlayMode,
    pub data: OverlayData,
}
```

### 3. Svelte UI Layer

**Location:** `src/overlay/RecordingOverlay.svelte`

The overlay component listens for `overlay-state` events and renders the appropriate UI:

- **Recording Mode:** 9-bar audio visualization (real levels or pulsing animation fallback)
- **Transcribing Mode:** "Transcribing..." with pulsing animation
- **Transforming Mode:** "Transforming..." with pulsing animation
- **Hidden Mode:** Window hidden via Rust command

**Event Listener:**
```typescript
listen<OverlayState>('overlay-state', (event) => {
  overlayState = event.payload;
  // UI updates reactively via Svelte runes
});
```

## Audio Visualization Pipeline

### Navigator (Browser) Recorder

```
MediaStream → AnalyserNode → getByteTimeDomainData() 
  → RMS calculation → 5.0x amplification → overlayService.updateAudioLevels()
  → Rust overlay → overlay UI
```

**File:** `src/lib/services/audio-levels.ts`
- Uses Web Audio API `AnalyserNode` with 2048 FFT size
- Computes RMS (Root Mean Square) from time-domain waveform
- Splits waveform into 9 chunks, one per bar
- Amplifies by 5.0x (capped at 1.0) for visibility

### CPAL (Rust) Recorder

```
Audio device → CPAL stream → RMS calculation → 8.0x amplification
  → emit('audio-levels') → main window → CPAL forwarder
  → overlayService.updateAudioLevels() → Rust overlay → overlay UI
```

**Files:**
- `src-tauri/src/recorder/recorder.rs` - CPAL audio capture and RMS computation
- `src/lib/services/cpal-audio-forwarder.ts` - Bridge between Rust events and overlayService

**Why Two Amplification Values?**
- CPAL captures raw device audio (typically quieter)
- Navigator uses WebAudio's automatic gain control
- Different multipliers (8.0x vs 5.0x) compensate for these differences

### FFmpeg Recorder

```
FFmpeg CLI → File output (no real-time levels)
  → overlayService.showRecording() → Pulsing animation fallback
```

**File:** `src/lib/services/recorder/ffmpeg.ts`
- FFmpeg is a command-line tool that writes audio directly to file
- No access to real-time audio levels during recording
- Overlay displays pulsing animated bars as visual feedback
- Animation automatically switches to real levels if data becomes available

**Pulsing Animation:**
- 9 bars with staggered wave effect (0.1s delay per bar)
- Opacity pulses between 0.4 and 1.0
- Scale pulses between 0.6 and 1.0 (scaleY)
- 1.5s animation cycle with ease-in-out timing

## Design Principles

### 1. Separation of Concerns

- **Service Layer:** Business logic, no UI, no platform-specific code
- **Rust Layer:** Window management, no business logic
- **UI Layer:** Presentation only, no business logic

### 2. Settings-Driven Configuration

The overlay position is not hardcoded in function calls. Instead, `overlayService` reads the current position from settings:

```typescript
const position = settings.value['recorder.overlay.position'];
```

This eliminates the need to pass position through every function call.

### 3. Type Safety

All overlay state transitions are type-checked:
- Can't show transcribing mode without text
- Can't show transforming mode without progress
- Audio levels must be exactly 9 numbers

### 4. Error Handling

All operations return `Result<T, WhisperingError>`:
- Tauri command errors are caught and wrapped
- Errors include user-friendly titles and descriptions
- Toast notifications automatically shown for errors

### 5. Single Source of Truth

The `OverlayService` maintains the canonical state. Components don't track their own overlay state—they query the service.

## State Transitions

```
┌─────────┐
│ Hidden  │
└────┬────┘
     │ showRecording()
     ▼
┌─────────────┐
│  Recording  │◄─── updateAudioLevels() (continuous)
└────┬────────┘
     │ showTranscribing()
     ▼
┌──────────────┐
│ Transcribing │◄─── showTranscribing(newText) (updates)
└────┬─────────┘
     │ showTransforming()
     ▼
┌──────────────┐
│ Transforming │ (pulsing text animation)
└────┬─────────┘
     │ hide()
     ▼
┌─────────┐
│ Hidden  │
└─────────┘
```

**Note:** You can call `hide()` from any state to immediately hide the overlay.

## Performance Considerations

### Audio Level Updates

Audio levels update at ~60 Hz (every frame). To prevent overwhelming the system:

1. **Debouncing:** The service doesn't debounce internally—callers control update frequency
2. **Small Payloads:** Only 9 numbers (36-72 bytes) sent per update
3. **Event-Driven:** No polling, only push updates when data changes

### Window Management

- **Lazy Creation:** Overlay window created only when first shown
- **Reuse:** Window stays alive between hide/show cycles for instant display
- **Destroy on Close:** Window destroyed when app closes to free resources

## Logging

The service includes strategic logging for debugging:

```typescript
console.info('[OverlayService] Showing recording overlay', { position });
console.error('[OverlayService] Failed to show overlay', error);
```

**Logging Levels:**
- `info`: State transitions (show, hide)
- `warn`: Recoverable issues (invalid data)
- `error`: Failed operations (Tauri commands)

Keep logging minimal—14 logs total in the service.

## Testing Considerations

### Unit Testing

Mock the Tauri `invoke` function:

```typescript
import { invoke } from '@tauri-apps/api/core';
vi.mock('@tauri-apps/api/core');

// Test
const mockInvoke = vi.mocked(invoke);
mockInvoke.mockResolvedValue(undefined);
await overlayService.showRecording();
expect(mockInvoke).toHaveBeenCalledWith('show_overlay_command', ...);
```

### Integration Testing

The overlay window can be tested by:
1. Showing the overlay
2. Emitting state events manually
3. Inspecting the overlay window's DOM

### Manual Testing

Use the settings page preview button:
1. Navigate to Settings → Recorder → Overlay
2. Click "Preview Overlay"
3. Verify bars appear at configured position
4. Change position and preview again

## Migration Guide

### Before (Old Pattern)

```typescript
import { invoke } from '@tauri-apps/api/core';

// Scattered command calls throughout the codebase
await invoke('show_recording_overlay_command', { position: 'Top' });
await invoke('update_mic_levels', { levels: [0.5, 0.3, ...] });
await invoke('show_transcribing_overlay_command', { text: '...' });
await invoke('hide_recording_overlay_command');
```

### After (New Pattern)

```typescript
import { overlayService } from '$lib/services/overlay';

// Unified service API
await overlayService.showRecording();
await overlayService.updateAudioLevels([0.5, 0.3, ...]);
await overlayService.showTranscribing('transcription text...');
await overlayService.hide();
```

**Benefits:**
- Position read from settings automatically
- Type-safe API prevents invalid calls
- Consistent error handling with Result types
- Single source of truth for overlay state
- Easier to test and mock

## Future Enhancements

Potential improvements to consider:

1. **Animation States:** Add transition animations between modes
2. **Custom Positions:** Support custom X/Y coordinates, not just Top/Bottom
3. **Multiple Overlays:** Support showing multiple overlay windows simultaneously
4. **Overlay Themes:** Allow customizing overlay appearance via settings
5. **Overlay Plugins:** Extension API for custom overlay modes
6. **Performance Metrics:** Track and log overlay render performance

## Common Issues

### Overlay Not Showing

**Check:**
1. Position setting: `settings.value['recorder.overlay.position']` not 'None'
2. Rust command errors: Look for console errors from Tauri commands
3. Window creation: Check if overlay window exists in Tauri window list

### Bars Not Animating

**Check:**
1. Audio callback registered: Verify recorder is calling `overlayService.updateAudioLevels()`
2. Audio levels valid: Must be array of exactly 9 numbers between 0-1
3. Amplification: Values might be too small—check amplification multipliers

### Overlay Won't Hide

**Check:**
1. `hide()` being called: Add console.log before `overlayService.hide()`
2. State transitions: Overlay might be re-shown immediately after hiding
3. Rust command errors: Check if `hide_overlay_command` is failing

## Related Documentation

- [Developer Guide: Adding Overlay Features](./overlay-service-developer-guide.md)
- [Whispering Architecture Deep Dive](./ARCHITECTURE.md)
- [Services Layer README](../src/lib/services/README.md)
- [Recording Overlay Refactor](./whispering-overlay-refactor.md)
