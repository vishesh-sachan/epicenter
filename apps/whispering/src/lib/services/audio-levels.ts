/**
 * Audio level monitoring service using Web Audio API
 * Analyzes microphone input and provides frequency spectrum data for visualization
 */

import { invoke } from '@tauri-apps/api/core';

const FFT_SIZE = 512;
const NUM_BARS = 9;

export class AudioLevelMonitor {
	private audioContext: AudioContext | null = null;
	private analyser: AnalyserNode | null = null;
	private dataArray: Uint8Array | null = null;
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
			this.analyser.smoothingTimeConstant = 0.8;
			this.source.connect(this.analyser);
			this.dataArray = new Uint8Array(this.analyser.frequencyBinCount);
		} catch (error) {
			console.error('Failed to connect audio monitor:', error);
		}
	}

	/**
	 * Start monitoring audio levels and call the callback with spectrum data
	 */
	startMonitoring(callback: (levels: number[]) => void): void {
		const update = () => {
			if (this.analyser && this.dataArray) {
				this.analyser.getByteFrequencyData(this.dataArray);
				const levels = this.computeSpectrum(this.dataArray);
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
	 * Compute frequency spectrum divided into NUM_BARS buckets
	 * Returns normalized values between 0 and 1
	 */
	private computeSpectrum(frequencyData: Uint8Array): number[] {
		const buckets: number[] = [];
		const bucketSize = Math.floor(frequencyData.length / NUM_BARS);

		for (let i = 0; i < NUM_BARS; i++) {
			let sum = 0;
			const start = i * bucketSize;
			const end = start + bucketSize;

			for (let j = start; j < end; j++) {
				const value = frequencyData[j];
				if (value !== undefined) {
					sum += value;
				}
			}

			// Average and normalize to 0-1 range
			const average = sum / bucketSize;
			const normalized = average / 255;

			buckets.push(normalized);
		}

		return buckets;
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
		console.log('[AUDIO LEVELS] Emitting levels:', levels.slice(0, 3), '...');
		await invoke('emit_mic_levels_command', { levels });
	} catch (error) {
		console.error('[AUDIO LEVELS] Failed to emit mic levels:', error);
	}
}
