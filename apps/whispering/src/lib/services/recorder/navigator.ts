import { invoke } from '@tauri-apps/api/core';
import { Err, Ok, type Result, tryAsync, trySync } from 'wellcrafted/result';
import {
	type CancelRecordingResult,
	TIMESLICE_MS,
	type WhisperingRecordingState,
} from '$lib/constants/audio';
import { AudioLevelMonitor } from '../audio-levels';
import {
	cleanupRecordingStream,
	enumerateDevices,
	getRecordingStream,
} from '../device-stream';
import type { DeviceAcquisitionOutcome, DeviceIdentifier } from '../types';
import type {
	NavigatorRecordingParams,
	RecorderService,
	RecorderServiceError,
} from './types';
import { RecorderServiceErr } from './types';
import { overlayService } from '../overlay';

type ActiveRecording = {
	recordingId: string;
	selectedDeviceId: DeviceIdentifier | null;
	bitrateKbps: string;
	stream: MediaStream;
	mediaRecorder: MediaRecorder;
	recordedChunks: Blob[];
	audioMonitor: AudioLevelMonitor | null;
};

export function createNavigatorRecorderService(): RecorderService {
	let activeRecording: ActiveRecording | null = null;

	return {
		getRecorderState: async (): Promise<
			Result<WhisperingRecordingState, RecorderServiceError>
		> => {
			return Ok(activeRecording ? 'RECORDING' : 'IDLE');
		},

		enumerateDevices: async () => {
			const { data: devices, error } = await enumerateDevices();
			if (error) {
				return RecorderServiceErr({
					message: error.message,
				});
			}
			return Ok(devices);
		},

		startRecording: async (
			{ selectedDeviceId, recordingId, bitrateKbps }: NavigatorRecordingParams,
			{ sendStatus },
		): Promise<Result<DeviceAcquisitionOutcome, RecorderServiceError>> => {
			// Ensure we're not already recording
			if (activeRecording) {
				return RecorderServiceErr({
					message:
						'A recording is already in progress. Please stop the current recording before starting a new one.',
				});
			}

			sendStatus({
				title: '🎙️ Starting Recording',
				description: 'Setting up your microphone...',
			});

			// Get the recording stream
			const { data: streamResult, error: acquireStreamError } =
				await getRecordingStream({ selectedDeviceId, sendStatus });
			if (acquireStreamError) {
				return RecorderServiceErr({
					message: acquireStreamError.message,
				});
			}

			const { stream, deviceOutcome } = streamResult;

			const { data: mediaRecorder, error: recorderError } = trySync({
				try: () =>
					new MediaRecorder(stream, {
						bitsPerSecond: Number(bitrateKbps) * 1000,
					}),
				catch: (error) =>
					RecorderServiceErr({
						message:
							'Failed to initialize the audio recorder. This could be due to unsupported audio settings, microphone conflicts, or browser limitations. Please check your microphone is working and try adjusting your audio settings.',
					}),
			});

			if (recorderError) {
				// Clean up stream if recorder creation fails
				cleanupRecordingStream(stream);
				return Err(recorderError);
			}

			// Set up recording state and event handlers
			const recordedChunks: Blob[] = [];

			// Set up audio level monitoring for overlay visualization
			let audioMonitor: AudioLevelMonitor | null = null;
			if (window.__TAURI_INTERNALS__) {
				try {
					audioMonitor = new AudioLevelMonitor();
					audioMonitor.connect(stream);
					audioMonitor.startMonitoring((levels) => {
						overlayService.updateAudioLevels(levels);
					});
				} catch (error) {
					console.warn('Failed to start audio level monitoring:', error);
				}
			}

			// Store active recording state
			activeRecording = {
				recordingId,
				selectedDeviceId,
				bitrateKbps,
				stream,
				mediaRecorder,
				recordedChunks,
				audioMonitor,
			};

			// Set up event handlers
			mediaRecorder.addEventListener('dataavailable', (event: BlobEvent) => {
				if (event.data.size) recordedChunks.push(event.data);
			});

			// Show the recording overlay in Tauri
			if (window.__TAURI_INTERNALS__) {
				await overlayService.showRecording();
			}

			// Start recording
			mediaRecorder.start(TIMESLICE_MS);

			// Return the device acquisition outcome
			return Ok(deviceOutcome);
		},

		stopRecording: async ({
			sendStatus,
		}): Promise<Result<Blob, RecorderServiceError>> => {
			if (!activeRecording) {
				return RecorderServiceErr({
					message:
						'Cannot stop recording because no active recording session was found. Make sure you have started recording before attempting to stop it.',
				});
			}

			const recording = activeRecording;
			activeRecording = null; // Clear immediately to prevent race conditions

			// Stop audio level monitoring
			if (recording.audioMonitor) {
				recording.audioMonitor.stopMonitoring();
				recording.audioMonitor.disconnect();
			}

			// Show transcribing state in overlay
			if (window.__TAURI_INTERNALS__) {
				await overlayService.showTranscribing();
			}

			sendStatus({
				title: '⏸️ Finishing Recording',
				description: 'Saving your audio...',
			});

			// Stop the recorder and wait for the final data
			const { data: blob, error: stopError } = await tryAsync({
				try: () =>
					new Promise<Blob>((resolve) => {
						recording.mediaRecorder.addEventListener('stop', () => {
							const audioBlob = new Blob(recording.recordedChunks, {
								type: recording.mediaRecorder.mimeType,
							});
							resolve(audioBlob);
						});
						recording.mediaRecorder.stop();
					}),
				catch: (error) =>
					RecorderServiceErr({
						message:
							'Failed to properly stop and save the recording. This might be due to corrupted audio data, insufficient storage space, or a browser issue. Your recording data may be lost.',
					}),
			});

			// Always clean up the stream
			cleanupRecordingStream(recording.stream);

			if (stopError) return Err(stopError);

			sendStatus({
				title: '✅ Recording Saved',
				description: 'Your recording is ready for transcription!',
			});
			return Ok(blob);
		},

		cancelRecording: async ({
			sendStatus,
		}): Promise<Result<CancelRecordingResult, RecorderServiceError>> => {
			if (!activeRecording) {
				return Ok({ status: 'no-recording' });
			}

			const recording = activeRecording;
			activeRecording = null; // Clear immediately

			// Stop audio level monitoring
			if (recording.audioMonitor) {
				recording.audioMonitor.stopMonitoring();
				recording.audioMonitor.disconnect();
			}

			// Hide the overlay
			if (window.__TAURI_INTERNALS__) {
			const { overlayService } = await import('$lib/services/overlay');
			await overlayService.hide();
		}

		sendStatus({
			title: '🛑 Cancelling',
			description: 'Discarding your recording...',
		});
			recording.mediaRecorder.stop();

			// Clean up the stream
			cleanupRecordingStream(recording.stream);

			sendStatus({
				title: '✨ Cancelled',
				description: 'Recording discarded successfully!',
			});

			return Ok({ status: 'cancelled' });
		},
	};
}

/**
 * Navigator recorder service that uses the MediaRecorder API.
 * Available in both browser and desktop environments.
 */
export const NavigatorRecorderServiceLive = createNavigatorRecorderService();
