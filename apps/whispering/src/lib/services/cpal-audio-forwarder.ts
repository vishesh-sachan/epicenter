/**
 * CPAL Audio Level Forwarder
 * 
 * Listens to 'audio-levels' events from the CPAL recorder (Rust) and forwards
 * them to the OverlayService. This bridges CPAL's time-domain audio analysis
 * with the unified overlay system.
 */

import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { overlayService } from './overlay';

let unlisten: UnlistenFn | null = null;

/**
 * Start listening to CPAL audio level events and forward to overlay
 */
export async function startCpalAudioForwarding(): Promise<void> {
	if (unlisten) {
		console.warn('[CPAL FORWARDER] Already listening to audio levels');
		return;
	}

	console.log('[CPAL FORWARDER] Starting audio level forwarding from CPAL → Overlay');

	unlisten = await listen<number[]>('audio-levels', (event) => {
		const levels = event.payload;
		overlayService.updateAudioLevels(levels);
	});
}

/**
 * Stop listening to CPAL audio level events
 */
export function stopCpalAudioForwarding(): void {
	if (unlisten) {
		console.log('[CPAL FORWARDER] Stopping audio level forwarding');
		unlisten();
		unlisten = null;
	}
}
