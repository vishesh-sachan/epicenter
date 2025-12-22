import { Ok } from 'wellcrafted/result';
import type { FfmpegService } from './types';
import { FfmpegServiceErr } from './types';

/**
 * Creates a web-compatible FFmpeg service implementation.
 * This service provides stub implementations that indicate FFmpeg operations
 * are not supported in web environments.
 */
export function createFfmpegServiceWeb(): FfmpegService {
	return {
		/**
		 * Checks if FFmpeg is installed on the system.
		 * Always returns false for web environments since FFmpeg is not available.
		 */
		async checkInstalled() {
			// FFmpeg check is not available in web version, assume not installed
			return Ok(false);
		},

		/**
		 * Attempts to compress an audio blob using FFmpeg.
		 * Always returns an error for web environments since FFmpeg is not available.
		 *
		 * @param _blob - The audio blob to compress (unused in web version)
		 * @param compressionOptions - The compression options to apply
		 */
		async compressAudioBlob(_blob: Blob, compressionOptions: string) {
			// Audio compression is not available in web version
			return FfmpegServiceErr({
				message:
					'Audio compression is not available in the web version. FFmpeg is only supported in the desktop application.',
			});
		},
	};
}
