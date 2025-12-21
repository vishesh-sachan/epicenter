/**
 * Overlay Service Types
 * Defines all possible overlay states and data structures
 */

/**
 * Available overlay modes
 */
export type OverlayMode = 
	| 'recording'     // Recording with audio waveform
	| 'transcribing'  // Transcription in progress
	| 'transforming'  // Text transformation in progress
	| 'hidden';       // Overlay is hidden

/**
 * Position of the overlay on screen
 */
export type OverlayPosition = 'None' | 'Top' | 'Bottom';

/**
 * Data that can be sent to the overlay
 */
export interface OverlayData {
	/** Audio levels for waveform visualization (0-1 range) */
	audioLevels?: number[];
	/** Text to display */
	text?: string;
}

/**
 * Complete overlay state sent to the overlay window
 */
export interface OverlayState {
	mode: OverlayMode;
	position: OverlayPosition;
	data?: OverlayData;
}

/**
 * Events emitted by the overlay service
 */
export interface OverlayEvents {
	'overlay:shown': { mode: OverlayMode };
	'overlay:hidden': void;
	'overlay:error': { error: string };
}
