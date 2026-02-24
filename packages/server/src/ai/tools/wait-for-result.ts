/**
 * Promise-based Y.Doc observation for command results.
 *
 * The server writes a command row, then waits here until the target device
 * writes a `result` field or the TTL expires.
 *
 * @see specs/20260223T200500-ai-tools-command-queue.md
 */

import type { TableHelper } from '@epicenter/hq';
import type { Command } from '@epicenter/tab-manager/workspace';

/**
 * Wait for a command result by observing the commands table.
 *
 * Resolves with the result object when the target device writes it.
 * Rejects on TTL timeout or abort signal. Cleans up the command row
 * after resolution (success or abort).
 *
 * @param commandsTable - The commands table helper bound to the Y.Doc
 * @param commandId - The ID of the command to watch
 * @param ttlMs - Maximum time to wait before timing out
 * @param abortSignal - Optional signal for client disconnect cleanup
 * @returns The result object from the command row
 */
export function waitForCommandResult(
	commandsTable: TableHelper<Command>,
	commandId: string,
	ttlMs: number,
	abortSignal?: AbortSignal,
): Promise<unknown> {
	return new Promise((resolve, reject) => {
		let unobserve: (() => void) | undefined;

		const cleanup = () => {
			clearTimeout(timeout);
			unobserve?.();
		};

		const timeout = setTimeout(() => {
			cleanup();
			reject(new Error('Command timed out \u2014 device may be offline'));
		}, ttlMs);

		// Abort when client disconnects
		abortSignal?.addEventListener(
			'abort',
			() => {
				cleanup();
				commandsTable.delete(commandId);
				reject(new DOMException('Client disconnected', 'AbortError'));
			},
			{ once: true },
		);

		unobserve = commandsTable.observe((changedIds) => {
			if (!changedIds.has(commandId)) return;
			const result = commandsTable.get(commandId);
			if (result.status !== 'valid') return;
			if (!result.row.result) return;

			const commandResult = result.row.result;
			cleanup();
			// Clean up the command row after getting result
			commandsTable.delete(commandId);
			resolve(commandResult);
		});
	});
}
