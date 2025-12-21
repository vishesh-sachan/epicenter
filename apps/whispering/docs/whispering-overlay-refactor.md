# Whispering Overlay Architecture Refactor

## Overview

Complete refactor of the recording overlay system to use a centralized service architecture. Previously, overlay management was scattered across Navigator/CPAL recorders with direct Rust command invocations. Now, all overlay logic flows through a single TypeScript `OverlayService`.

## Architecture

### Before (Scattered)
```
Navigator Recorder → Direct invoke → Rust overlay.rs → Overlay window
CPAL Recorder → Direct invoke → Rust overlay.rs → Overlay window
Audio Levels → Direct emit → Overlay window
```

### After (Centralized)
```
Navigator Recorder ─┐
                    ├→ OverlayService → Rust overlay.rs → Overlay window
CPAL Recorder ──────┘        ↑
                             │
CPAL Audio Forwarder ────────┘
```

## Changes Made

### 1. Created OverlayService (TypeScript)

**Location:** `src/lib/services/overlay/`

**Files:**
- `types.ts` - Type definitions for overlay modes, positions, data
- `overlay-service.ts` - Centralized service class with convenience methods
- `index.ts` - Exports for easy importing

**Key Features:**
- Single source of truth for overlay state
- Reads position setting automatically
- Provides semantic methods: `showRecording()`, `showTranscribing()`, `updateAudioLevels()`, `hide()`
- Handles all invoke calls to Rust

**Example Usage:**
```typescript
import { overlayService } from '$lib/services/overlay';

// Show recording overlay (position read from settings)
await overlayService.showRecording();

// Update audio levels
overlayService.updateAudioLevels([0.1, 0.2, 0.3, ...]);

// Switch to transcribing state
await overlayService.showTranscribing();

// Hide overlay
await overlayService.hide();
```

### 2. Unified Rust Overlay Commands

**Location:** `src-tauri/src/overlay.rs`

**Before:**
- `show_recording_overlay_command(position)`
- `show_transcribing_overlay_command(position)`
- `hide_recording_overlay_command()`
- Multiple event types: 'show-overlay', 'hide-overlay', 'mic-level'

**After:**
- `show_overlay_command(mode, position, data)` - Single unified command
- `update_overlay_data_command(data)` - Update data without changing mode
- `hide_overlay_command()` - Hide overlay
- Unified event: 'overlay-state' with mode + position + data

**New Types:**
```rust
enum OverlayMode {
    Recording,
    Transcribing,
    Transforming,
    Hidden,
}

struct OverlayData {
    audio_levels: Option<Vec<f32>>,
    text: Option<String>,
}

struct OverlayState {
    mode: OverlayMode,
    position: OverlayPosition,
    data: Option<OverlayData>,
}
```

### 3. Updated Navigator Recorder

**Location:** `src/lib/services/recorder/navigator.ts`

**Changes:**
- Import `overlayService` instead of direct `invoke` calls
- Use `overlayService.showRecording()` on start
- Use `overlayService.showTranscribing()` on stop
- Use `overlayService.hide()` on cancel
- Audio level callback now calls `overlayService.updateAudioLevels()`

**Removed:**
- Direct imports of overlay command names
- Manual settings reads for position
- Debug logging for overlay commands

### 4. Updated CPAL Recorder

**Location:** `src/lib/services/recorder/cpal.ts`

**Changes:**
- Import `overlayService` and `startCpalAudioForwarding`
- Call `startCpalAudioForwarding()` when recording starts
- Call `stopCpalAudioForwarding()` when recording stops/cancels
- Use `overlayService.showRecording()` on start
- Use `overlayService.showTranscribing()` on stop
- Use `overlayService.hide()` on cancel

**New Pattern:**
CPAL doesn't have direct access to audio context like Navigator, so:
1. CPAL emits 'audio-levels' event to main window
2. `cpal-audio-forwarder.ts` listens and forwards to `overlayService`
3. `overlayService` updates overlay window

### 5. Created CPAL Audio Forwarder

**Location:** `src/lib/services/cpal-audio-forwarder.ts`

**Purpose:**
Bridges the gap between CPAL's Rust-side audio analysis and the TypeScript OverlayService.

**How it works:**
```typescript
// Started when CPAL recording begins
await startCpalAudioForwarding();

// Listens to 'audio-levels' event from Rust
listen<number[]>('audio-levels', (event) => {
    overlayService.updateAudioLevels(event.payload);
});

// Stopped when CPAL recording ends
stopCpalAudioForwarding();
```

### 6. Updated CPAL Rust Recorder

**Location:** `src-tauri/src/recorder/recorder.rs`

**Changes:**
- Changed `emit_levels()` to emit to main window instead of overlay
- Emits 'audio-levels' event to main window
- Removed direct overlay emission

**Before:**
```rust
use crate::overlay::emit_mic_levels;
emit_mic_levels(app, &levels.to_vec());
```

**After:**
```rust
use tauri::Emitter;
if let Some(main_window) = app.get_webview_window("main") {
    let _ = main_window.emit("audio-levels", levels);
}
```

### 7. Simplified CPAL Commands

**Location:** `src-tauri/src/recorder/commands.rs`

**Changes:**
- Removed overlay management from Rust commands
- `start_recording` no longer calls `show_recording_overlay`
- `stop_recording` no longer calls `show_transcribing_overlay`
- `cancel_recording` no longer calls `hide_recording_overlay`
- All overlay logic now handled by TypeScript OverlayService

**Reason:**
Position setting lives in TypeScript settings store, not Rust. Moving overlay logic to TypeScript removes the need to pass position around.

### 8. Updated Overlay Svelte Component

**Location:** `src/overlay/RecordingOverlay.svelte`

**Changes:**
- Listen for unified 'overlay-state' event instead of separate 'show-overlay' events
- Added support for new modes: 'transforming' (for future AI transformations)
- Listen for 'overlay-data-update' event for data-only updates
- Backward compatible with legacy 'mic-level' event
- Unified state handling with single `mode` variable

**New Event Structure:**
```typescript
// Unified state event
{
    mode: 'recording' | 'transcribing' | 'transforming' | 'hidden',
    position: 'Top' | 'Bottom' | 'None',
    data?: {
        audioLevels?: number[],
        text?: string
    }
}
```

## Benefits

### 1. Single Source of Truth
- All overlay logic in one place: `OverlayService`
- No more duplicate position reads across recorders
- Consistent behavior across Navigator and CPAL

### 2. Type Safety
- TypeScript types ensure correct usage
- Rust types match TypeScript types
- Compiler catches mismatches

### 3. Extensibility
- Easy to add new overlay modes (e.g., 'transforming')
- Easy to add new data types (e.g., progress bars)
- Future-proof for AI transformations

### 4. Clean Separation of Concerns
- **TypeScript OverlayService**: Business logic (what to show, when)
- **Rust overlay.rs**: Window management (positioning, showing/hiding)
- **Svelte Component**: Presentation (rendering, animations)

### 5. Testability
- OverlayService is a class → easy to test
- Can mock Tauri invoke calls
- Can test state transitions in isolation

### 6. Better Error Handling
- OverlayService logs errors consistently
- No silent failures
- Easier debugging with centralized logging

## Migration Path

If you have code that uses the old overlay commands:

### Before:
```typescript
import { invoke } from '@tauri-apps/api/core';

const position = settings.value['overlay.position'];
await invoke('show_recording_overlay_command', { position });
await invoke('hide_recording_overlay_command');
```

### After:
```typescript
import { overlayService } from '$lib/services/overlay';

await overlayService.showRecording();
await overlayService.hide();
```

## Audio Level Flow

### Navigator (Browser Audio API)
```
Microphone → AudioContext → AnalyserNode → FFT Analysis → 
9 frequency buckets → overlayService.updateAudioLevels() → 
Rust overlay → Overlay window
```

### CPAL (Rust Audio API)
```
Microphone → CPAL Stream → RMS calculation (Rust) → 
'audio-levels' event to main window → cpal-audio-forwarder → 
overlayService.updateAudioLevels() → Rust overlay → Overlay window
```

## Key Differences Between Recorders

### Navigator (FFT - Frequency Domain)
- Uses Web Audio API's AnalyserNode
- FFT (Fast Fourier Transform) analysis
- Splits audio into 9 frequency buckets
- Voice energy concentrates in low frequencies (buckets 0-2)
- Higher buckets (3-8) typically near zero for voice

### CPAL (RMS - Time Domain)
- Uses CPAL audio stream in Rust
- RMS (Root Mean Square) calculation
- All 9 bars show similar patterns
- Reflects overall volume, not frequency content
- More uniform distribution across bars

## Future Enhancements

With this architecture, we can easily add:

1. **Enhanced Transforming Mode:**
   ```typescript
   overlayService.showTransforming();
   // Shows pulsing "Transforming..." text
   ```

2. **Custom Overlay Content:****
   ```typescript
   overlayService.updateData({
       text: 'Recording: 00:42',
   });
   ```

3. **Multiple Overlay Windows:**
   - Could support multiple overlays per monitor
   - Each with different content/purpose

4. **Overlay Themes:**
   - Pass theme data to overlay
   - Dynamic color schemes

## Testing Checklist

- [x] TypeScript compiles without errors
- [x] Rust compiles without errors
- [ ] Navigator recorder shows overlay
- [ ] Navigator recorder audio levels animate
- [ ] Navigator recorder transitions to transcribing
- [ ] Navigator recorder hides on cancel
- [ ] CPAL recorder shows overlay
- [ ] CPAL recorder audio levels animate
- [ ] CPAL recorder transitions to transcribing
- [ ] CPAL recorder hides on cancel
- [ ] Position setting respected (Top/Bottom/None)
- [ ] Overlay appears on correct monitor
- [ ] Overlay stays on top of other windows

## Files Modified

### Created:
- `src/lib/services/overlay/types.ts`
- `src/lib/services/overlay/overlay-service.ts`
- `src/lib/services/overlay/index.ts`
- `src/lib/services/cpal-audio-forwarder.ts`

### Modified:
- `src/lib/services/recorder/navigator.ts`
- `src/lib/services/recorder/cpal.ts`
- `src-tauri/src/overlay.rs`
- `src-tauri/src/recorder/recorder.rs`
- `src-tauri/src/recorder/commands.rs`
- `src-tauri/src/lib.rs`
- `src/overlay/RecordingOverlay.svelte`

## Backward Compatibility

The overlay Svelte component maintains backward compatibility:
- Still listens for legacy 'show-overlay' event
- Still listens for legacy 'mic-level' event
- Will work with old and new command structures during transition

Once fully tested, legacy event listeners can be removed.
