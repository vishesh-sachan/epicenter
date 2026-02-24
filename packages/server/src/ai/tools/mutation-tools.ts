/**
 * Server-side mutation tool implementations.
 *
 * Each tool writes a command row to the `commands` table in the Y.Doc,
 * then awaits the result via `waitForCommandResult()`. The target device's
 * background worker observes the command, executes Chrome APIs, and writes
 * the result back.
 *
 * @see specs/20260223T200500-ai-tools-command-queue.md
 */

import { createTables, generateId } from '@epicenter/hq';
import {
	type Command,
	type CommandId,
	type DeviceId,
	definition,
} from '@epicenter/tab-manager/workspace';
import type * as Y from 'yjs';
import {
	activateTabDef,
	closeTabsDef,
	groupTabsDef,
	muteTabsDef,
	openTabDef,
	pinTabsDef,
	reloadTabsDef,
	saveTabsDef,
} from './definitions';
import { waitForCommandResult } from './wait-for-result';

/**
 * Maximum time a command stays actionable after creation.
 *
 * Duplicated from `apps/tab-manager/src/lib/commands/constants.ts` because
 * the tab-manager package only exports `./workspace`. Both values must stay
 * in sync.
 */
const COMMAND_TTL_MS = 30_000;

/**
 * Extract the device ID from a composite tab ID (`${deviceId}_${tabId}`).
 */
function extractDeviceId(compositeId: string): DeviceId {
	const idx = compositeId.indexOf('_');
	if (idx === -1) return compositeId as DeviceId;
	return compositeId.slice(0, idx) as DeviceId;
}

/**
 * Extract device ID from the first element of a composite ID array.
 *
 * All tabs in a single command must belong to the same device,
 * so extracting from the first element is correct.
 */
function extractDeviceIdFromIds(compositeIds: string[]): DeviceId {
	const first = compositeIds[0];
	if (!first) throw new Error('tabIds array is empty');
	return extractDeviceId(first);
}

/**
 * Create a fresh command ID.
 */
function createCommandId(): CommandId {
	return generateId() as string as CommandId;
}

/**
 * Create server-side mutation tools bound to a Y.Doc.
 *
 * Each tool writes a command row to the `commands` table, then blocks
 * (async) until the target device writes the result or TTL expires.
 *
 * @param doc - The tab-manager Y.Doc (from the sync plugin's dynamicDocs)
 * @returns Array of server tools ready for `chat({ tools })`
 */
export function createMutationTools(doc: Y.Doc) {
	// biome-ignore lint/style/noNonNullAssertion: tab-manager definition always has tables
	const tables = createTables(doc, definition.tables!);

	/**
	 * Write a command and await its result.
	 *
	 * Shared by all mutation tools — extracts `deviceId` from the first
	 * composite ID (or uses an explicit one), writes the command row,
	 * and waits for the background worker to write the result.
	 */
	function writeAndAwait(command: Command): Promise<unknown> {
		tables.commands.set(command);
		return waitForCommandResult(tables.commands, command.id, COMMAND_TTL_MS);
	}

	return [
		closeTabsDef.server(async ({ tabIds }) => {
			const deviceId = extractDeviceIdFromIds(tabIds);
			const result = await writeAndAwait({
				id: createCommandId(),
				deviceId,
				action: 'closeTabs',
				tabIds,
				createdAt: Date.now(),
				_v: 1,
			});
			return result;
		}),

		openTabDef.server(async ({ url, deviceId, windowId }) => {
			const result = await writeAndAwait({
				id: createCommandId(),
				deviceId: deviceId as DeviceId,
				action: 'openTab',
				url,
				...(windowId ? { windowId } : {}),
				createdAt: Date.now(),
				_v: 1,
			});
			return result;
		}),

		activateTabDef.server(async ({ tabId }) => {
			const deviceId = extractDeviceId(tabId);
			const result = await writeAndAwait({
				id: createCommandId(),
				deviceId,
				action: 'activateTab',
				tabId,
				createdAt: Date.now(),
				_v: 1,
			});
			return result;
		}),

		saveTabsDef.server(async ({ tabIds, close }) => {
			const deviceId = extractDeviceIdFromIds(tabIds);
			const result = await writeAndAwait({
				id: createCommandId(),
				deviceId,
				action: 'saveTabs',
				tabIds,
				close: close ?? false,
				createdAt: Date.now(),
				_v: 1,
			});
			return result;
		}),

		groupTabsDef.server(async ({ tabIds, title, color }) => {
			const deviceId = extractDeviceIdFromIds(tabIds);
			const result = await writeAndAwait({
				id: createCommandId(),
				deviceId,
				action: 'groupTabs',
				tabIds,
				...(title ? { title } : {}),
				...(color
					? {
							color: color as Command extends {
								action: 'groupTabs';
								color?: infer C;
							}
								? C
								: never,
						}
					: {}),
				createdAt: Date.now(),
				_v: 1,
			});
			return result;
		}),

		pinTabsDef.server(async ({ tabIds, pinned }) => {
			const deviceId = extractDeviceIdFromIds(tabIds);
			const result = await writeAndAwait({
				id: createCommandId(),
				deviceId,
				action: 'pinTabs',
				tabIds,
				pinned,
				createdAt: Date.now(),
				_v: 1,
			});
			return result;
		}),

		muteTabsDef.server(async ({ tabIds, muted }) => {
			const deviceId = extractDeviceIdFromIds(tabIds);
			const result = await writeAndAwait({
				id: createCommandId(),
				deviceId,
				action: 'muteTabs',
				tabIds,
				muted,
				createdAt: Date.now(),
				_v: 1,
			});
			return result;
		}),

		reloadTabsDef.server(async ({ tabIds }) => {
			const deviceId = extractDeviceIdFromIds(tabIds);
			const result = await writeAndAwait({
				id: createCommandId(),
				deviceId,
				action: 'reloadTabs',
				tabIds,
				createdAt: Date.now(),
				_v: 1,
			});
			return result;
		}),
	];
}
