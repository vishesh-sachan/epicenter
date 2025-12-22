import {
	disable,
	enable,
	isEnabled,
} from '@tauri-apps/plugin-autostart';
import { extractErrorMessage } from 'wellcrafted/error';
import { tryAsync } from 'wellcrafted/result';
import type { AutostartService } from './types';
import { AutostartServiceErr } from './types';

/**
 * Auto-start service for desktop platforms.
 * Enables/disables launching Whispering on system login.
 *
 * Platform-specific behavior:
 * - macOS: Creates Launch Agent in ~/Library/LaunchAgents/
 * - Windows: Adds registry entry to HKEY_CURRENT_USER\...\Run
 * - Linux: Creates .desktop file in ~/.config/autostart/
 */
export function createAutostartServiceDesktop(): AutostartService {
	return {
		isEnabled: () =>
			tryAsync({
				try: () => isEnabled(),
				catch: (error) =>
					AutostartServiceErr({
						message: `Failed to check autostart status: ${extractErrorMessage(error)}`,
					}),
			}),

		enable: () =>
			tryAsync({
				try: () => enable(),
				catch: (error) =>
					AutostartServiceErr({
						message: `Failed to enable autostart: ${extractErrorMessage(error)}`,
					}),
			}),

		disable: () =>
			tryAsync({
				try: () => disable(),
				catch: (error) =>
					AutostartServiceErr({
						message: `Failed to disable autostart: ${extractErrorMessage(error)}`,
					}),
			}),
	};
}
