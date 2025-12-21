/**
 * Audio level monitoring service using Web Audio API
 * Analyzes microphone input using time-domain RMS analysis for visualization
 */

import { invoke } from '@tauri-apps/api/core';

// Time-domain analysis configuration
const FFT_SIZE = 2048; // Larger size for better time-domain resolution
const NUM_BARS = 9;

// Amplification to make waveforms more visible
const AMPLITUDE_MULTIPLIER = 5.0; // Boost small audio signals
const MAX_AMPLITUDE = 1.0; // Clamp to prevent overflow

export class AudioLevelMonitor {
	private audioContext: AudioContext | null = null;
	private analyser: AnalyserNode | null = null;
	private dataArray: Uint8Array<ArrayBuffer> | null = null;
	private rafId: number | null = null;
	private source: MediaStreamAudioSourceNode | null = null;

	/**
	 * Connect to a MediaStream and start analyzing audio
	 */
	connect(stream: MediaStream): void {
		try {
			this.audioContext = new AudioContext();
			this.source = this.audioContext.createMediaStreamSource(stream);
			this.analyser = this.audioContext.createAnalyser();
			this.analyser.fftSize = FFT_SIZE;
			this.analyser.smoothingTimeConstant = 0.3; // Less smoothing for more responsive visualization
			this.source.connect(this.analyser);
			// Use time-domain data (waveform) instead of frequency data
			this.dataArray = new Uint8Array(this.analyser.fftSize);
		} catch (error) {
			console.error('Failed to connect audio monitor:', error);
		}
	}

	/**
	 * Start monitoring audio levels and call the callback with RMS amplitude data
	 */
	startMonitoring(callback: (levels: number[]) => void): void {
		const update = () => {
			if (this.analyser && this.dataArray) {
				// Get time-domain data (waveform)
				this.analyser.getByteTimeDomainData(this.dataArray);
				const levels = this.computeRMSLevels(this.dataArray);
				callback(levels);
			}
			this.rafId = requestAnimationFrame(update);
		};
		update();
	}

	/**
	 * Stop monitoring audio levels
	 */
	stopMonitoring(): void {
		if (this.rafId !== null) {
			cancelAnimationFrame(this.rafId);
			this.rafId = null;
		}
	}

	/**
	 * Disconnect and cleanup all audio resources
	 */
	disconnect(): void {
		this.stopMonitoring();
		
		if (this.source) {
			this.source.disconnect();
			this.source = null;
		}
		
		if (this.audioContext) {
			this.audioContext.close();
			this.audioContext = null;
		}
		
		this.analyser = null;
		this.dataArray = null;
	}

	/**
	 * Compute RMS (Root Mean Square) amplitude for each bar
	 * Uses time-domain waveform data, same approach as CPAL recorder
	 * Returns normalized values between 0 and 1 with amplification
	 */
	private computeRMSLevels(timeDomainData: Uint8Array<ArrayBuffer>): number[] {
		const levels: number[] = [];
		const chunkSize = Math.floor(timeDomainData.length / NUM_BARS);

		for (let i = 0; i < NUM_BARS; i++) {
			const start = i * chunkSize;
			const end = Math.min(start + chunkSize, timeDomainData.length);
			
			// Convert byte values (0-255, centered at 128) to normalized values (-1 to 1)
			let sumSquares = 0;
			for (let j = start; j < end; j++) {
				const value = timeDomainData[j];
				if (value !== undefined) {
					const normalized = (value - 128) / 128.0;
					sumSquares += normalized * normalized;
				}
			}

			// Calculate RMS
			const rms = Math.sqrt(sumSquares / (end - start));
			
			// Apply amplification and clamp to max
			const amplified = Math.min(rms * AMPLITUDE_MULTIPLIER, MAX_AMPLITUDE);
			
			levels.push(amplified);
		}

		return levels;
	}
}

/**
 * Create a monitor and automatically emit levels to Tauri backend
 */
export function createAudioLevelMonitor(): AudioLevelMonitor {
	const monitor = new AudioLevelMonitor();
	return monitor;
}

/**
 * Emit audio levels to the Tauri backend for overlay visualization
 */
export async function emitMicLevels(levels: number[]): Promise<void> {
	try {
		console.log('[AUDIO LEVELS] Emitting', levels.length, 'levels:', levels.map(l => l.toFixed(2)).join(', '));
		await invoke('emit_mic_levels_command', { levels });
	} catch (error) {
		console.error('[AUDIO LEVELS] Failed to emit mic levels:', error);
	}
}
