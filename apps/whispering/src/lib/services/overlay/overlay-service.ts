/**
 * Overlay Service
 * 
 * Central service for managing the recording overlay window.
 * Handles all overlay state, positioning, and communication with the Rust backend.
 * 
 * This service is the single source of truth for overlay state and should be used
 * by all features that need to display overlay UI (recording, transcription, etc.)
 */

import { invoke } from '@tauri-apps/api/core';
import type { OverlayMode, OverlayPosition, OverlayData, OverlayState } from './types';

class OverlayService {
	private currentMode: OverlayMode = 'hidden';
	private isVisible = false;

	/**
	 * Get overlay position from settings
	 */
	private async getPosition(): Promise<OverlayPosition> {
		// Lazy import to avoid circular dependencies
		const { settings } = await import('$lib/stores/settings.svelte');
		return settings.value['overlay.position'];
	}

	/**
	 * Show overlay in recording mode with optional audio levels
	 */
	async showRecording(audioLevels?: number[]): Promise<void> {
		console.log('[OVERLAY SERVICE] Showing recording mode');
		const position = await this.getPosition();
		
		if (position === 'None') {
			console.log('[OVERLAY SERVICE] Position is None, not showing overlay');
			return;
		}

		try {
			await invoke('show_overlay_command', {
				mode: 'recording',
				position,
				data: audioLevels ? { audioLevels } : undefined,
			});

			this.currentMode = 'recording';
			this.isVisible = true;
			console.log('[OVERLAY SERVICE] Recording overlay shown');
		} catch (error) {
			console.error('[OVERLAY SERVICE] Failed to show recording overlay:', error);
			throw error;
		}
	}

	/**
	 * Show overlay in transcribing mode
	 */
	async showTranscribing(): Promise<void> {
		console.log('[OVERLAY SERVICE] Showing transcribing mode');
		const position = await this.getPosition();
		
		if (position === 'None') {
			return;
		}

		try {
			await invoke('show_overlay_command', {
				mode: 'transcribing',
				position,
			});

			this.currentMode = 'transcribing';
			this.isVisible = true;
			console.log('[OVERLAY SERVICE] Transcribing overlay shown');
		} catch (error) {
			console.error('[OVERLAY SERVICE] Failed to show transcribing overlay:', error);
			throw error;
		}
	}

	/**
	 * Show overlay in transforming mode
	 */
	async showTransforming(): Promise<void> {
		console.log('[OVERLAY SERVICE] Showing transforming mode');
		const position = await this.getPosition();
		
		if (position === 'None') {
			return;
		}

		try {
			await invoke('show_overlay_command', {
				mode: 'transforming',
				position,
			});

			this.currentMode = 'transforming';
			this.isVisible = true;
			console.log('[OVERLAY SERVICE] Transforming overlay shown');
		} catch (error) {
			console.error('[OVERLAY SERVICE] Failed to show transforming overlay:', error);
			throw error;
		}
	}

	/**
	 * Update overlay data (audio levels, text, progress, etc.)
	 * Only works when overlay is visible
	 */
	async updateData(data: OverlayData): Promise<void> {
		if (!this.isVisible) {
			return;
		}

		try {
			await invoke('update_overlay_data_command', { data });
		} catch (error) {
			console.error('[OVERLAY SERVICE] Failed to update overlay data:', error);
		}
	}

	/**
	 * Update audio levels (convenience method)
	 */
	async updateAudioLevels(levels: number[]): Promise<void> {
		await this.updateData({ audioLevels: levels });
	}

	/**
	 * Hide the overlay
	 */
	async hide(): Promise<void> {
		if (!this.isVisible) {
			return;
		}

		console.log('[OVERLAY SERVICE] Hiding overlay');
		
		try {
			await invoke('hide_overlay_command');
			this.currentMode = 'hidden';
			this.isVisible = false;
			console.log('[OVERLAY SERVICE] Overlay hidden');
		} catch (error) {
			console.error('[OVERLAY SERVICE] Failed to hide overlay:', error);
			throw error;
		}
	}

	/**
	 * Get current overlay state
	 */
	getState(): { mode: OverlayMode; isVisible: boolean } {
		return {
			mode: this.currentMode,
			isVisible: this.isVisible,
		};
	}

	/**
	 * Check if overlay is currently visible
	 */
	isShowing(): boolean {
		return this.isVisible;
	}

	/**
	 * Get current mode
	 */
	getCurrentMode(): OverlayMode {
		return this.currentMode;
	}
}

// Export singleton instance
export const overlayService = new OverlayService();

// Also export the class for testing
export { OverlayService };
