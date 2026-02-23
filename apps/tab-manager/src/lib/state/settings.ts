/**
 * Server URL settings for the tab manager extension.
 *
 * Two URLs are maintained:
 * - **Server URL** (`serverUrl`): The local server for sync and workspace
 *   operations. Defaults to `http://127.0.0.1:3913`.
 * - **Hub Server URL** (`hubServerUrl`): The hub server for AI, auth, and key
 *   management. Defaults to the same address — in single-server setups both
 *   point to the same place. For multi-server deployments, set this to the
 *   hub's address (e.g., `https://hub.epicenter.so`).
 *
 * @example
 * ```typescript
 * const local = await getServerUrl(); // 'http://127.0.0.1:3913'
 * const hub = await getHubServerUrl(); // 'http://127.0.0.1:3913' (or custom)
 * await setHubServerUrl('https://hub.epicenter.so');
 * ```
 */

import { storage } from '@wxt-dev/storage';

const DEFAULT_SERVER_URL = 'http://127.0.0.1:3913';

/**
 * Local server URL storage item.
 *
 * Points to the local server for sync and workspace operations.
 * Defaults to localhost — the standard self-hosted server address.
 * Persisted in chrome.storage.local so it survives browser restarts.
 */
const serverUrlItem = storage.defineItem<string>('local:serverUrl', {
	fallback: DEFAULT_SERVER_URL,
});

/**
 * Hub server URL storage item.
 *
 * Points to the hub server for AI completions, authentication, and
 * API key management. Defaults to the same localhost address as the
 * local server — in single-server setups both URLs are identical.
 *
 * For multi-server deployments (e.g., Epicenter Cloud), set this to
 * the hub's public address.
 */
const hubServerUrlItem = storage.defineItem<string>('local:hubServerUrl', {
	fallback: DEFAULT_SERVER_URL,
});

/**
 * Get the current local server URL.
 *
 * Returns the user-configured URL, or the default localhost address
 * if no custom URL has been set. Used for sync and workspace operations.
 */
export async function getServerUrl(): Promise<string> {
	return await serverUrlItem.getValue();
}

/**
 * Set the local server URL.
 *
 * Persisted to chrome.storage.local. Takes effect on the next
 * request (not retroactively on active connections).
 */
export async function setServerUrl(url: string): Promise<void> {
	await serverUrlItem.setValue(url);
}

/**
 * Get the current hub server URL.
 *
 * Returns the user-configured hub URL, or the default localhost address.
 * Used for AI chat completions, authentication, and key management.
 */
export async function getHubServerUrl(): Promise<string> {
	return await hubServerUrlItem.getValue();
}

/**
 * Set the hub server URL.
 *
 * Persisted to chrome.storage.local. Takes effect on the next
 * AI chat request (not retroactively on active streams).
 */
export async function setHubServerUrl(url: string): Promise<void> {
	await hubServerUrlItem.setValue(url);
}
