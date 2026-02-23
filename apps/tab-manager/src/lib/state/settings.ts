/**
 * Server URL settings for the tab manager extension.
 *
 * Stores the AI chat server URL in chrome.storage.local with a sensible default.
 * Used by the AI chat state module to connect to the streaming endpoint.
 *
 * @example
 * ```typescript
 * const url = await getServerUrl(); // 'http://127.0.0.1:3913'
 * await setServerUrl('http://my-server.local:3913');
 * ```
 */

import { storage } from '@wxt-dev/storage';

/**
 * Server URL storage item.
 *
 * Defaults to localhost — the standard self-hosted server address.
 * Persisted in chrome.storage.local so it survives browser restarts.
 */
const serverUrlItem = storage.defineItem<string>('local:serverUrl', {
	fallback: 'http://127.0.0.1:3913',
});

/**
 * Get the current server URL.
 *
 * Returns the user-configured URL, or the default localhost address
 * if no custom URL has been set.
 */
export async function getServerUrl(): Promise<string> {
	return await serverUrlItem.getValue();
}

/**
 * Set the server URL.
 *
 * Persisted to chrome.storage.local. Takes effect on the next
 * chat request (not retroactively on active connections).
 */
export async function setServerUrl(url: string): Promise<void> {
	await serverUrlItem.setValue(url);
}
