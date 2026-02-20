/**
 * Sync Plugin Integration Tests
 *
 * Tests the full WebSocket sync flow using real Elysia servers
 * and real sync providers over actual WebSocket connections.
 *
 * These tests verify the wiring between the Elysia plugin, room manager,
 * auth, and protocol layers — the exact integration path clients use.
 * Unit tests for individual building blocks live in their respective files.
 *
 * Co-located with plugin.ts for easy discovery.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { SyncProvider, SyncStatus } from '@epicenter/sync';
import { createSyncProvider } from '@epicenter/sync';
import * as Y from 'yjs';
import { createSyncServer, type SyncServerConfig } from './server';

// ============================================================================
// Test Utilities
// ============================================================================

let counter = 0;

/** Generate a unique room ID per test to avoid cross-test state bleed. */
function uniqueRoom(): string {
	return `test-room-${Date.now()}-${counter++}`;
}

/**
 * Start a test server on a random port (port 0).
 *
 * Returns the server instance plus URL helpers for building
 * WebSocket and HTTP URLs against the actual bound port.
 */
function startTestServer(config?: SyncServerConfig) {
	const server = createSyncServer({ ...config, port: 0 });
	const bunServer = server.start();
	const port = bunServer!.port;
	return {
		server,
		port,
		wsUrl(room: string) {
			return `ws://localhost:${port}/${room}/ws`;
		},
		httpUrl(path = '/') {
			return `http://localhost:${port}${path}`;
		},
	};
}

/**
 * Wait for a sync provider to reach a specific status.
 *
 * Resolves immediately if already at the target status.
 * Rejects after timeout to prevent hanging tests — the timeout
 * is a failure guard, not a correctness mechanism.
 */
function waitForStatus(
	provider: SyncProvider,
	target: SyncStatus,
	timeoutMs = 5_000,
): Promise<void> {
	return new Promise((resolve, reject) => {
		if (provider.status === target) {
			resolve();
			return;
		}
		const timer = setTimeout(() => {
			unsub();
			reject(
				new Error(
					`Timed out waiting for status '${target}', stuck at '${provider.status}'`,
				),
			);
		}, timeoutMs);
		const unsub = provider.onStatusChange((s) => {
			if (s === target) {
				clearTimeout(timer);
				unsub();
				resolve();
			}
		});
	});
}

/**
 * Wait for a Y.Map key to appear in a document.
 *
 * Resolves immediately if the key already exists.
 * Uses doc.on('update') to detect changes — event-driven, no polling.
 */
function waitForMapKey(
	doc: Y.Doc,
	mapName: string,
	key: string,
	timeoutMs = 5_000,
): Promise<unknown> {
	return new Promise((resolve, reject) => {
		const current = doc.getMap(mapName).get(key);
		if (current !== undefined) {
			resolve(current);
			return;
		}
		const timer = setTimeout(() => {
			doc.off('update', handler);
			reject(new Error(`Timed out waiting for ${mapName}.${key}`));
		}, timeoutMs);
		const handler = () => {
			const val = doc.getMap(mapName).get(key);
			if (val !== undefined) {
				clearTimeout(timer);
				doc.off('update', handler);
				resolve(val);
			}
		};
		doc.on('update', handler);
	});
}

/**
 * Wait for hasLocalChanges to reach an expected value.
 *
 * Resolves immediately if already at the expected value.
 * Uses the provider's onLocalChanges callback — event-driven.
 */
function waitForLocalChanges(
	provider: SyncProvider,
	expected: boolean,
	timeoutMs = 5_000,
): Promise<void> {
	return new Promise((resolve, reject) => {
		if (provider.hasLocalChanges === expected) {
			resolve();
			return;
		}
		const timer = setTimeout(() => {
			unsub();
			reject(
				new Error(
					`Timed out waiting for hasLocalChanges=${expected}, current=${provider.hasLocalChanges}`,
				),
			);
		}, timeoutMs);
		const unsub = provider.onLocalChanges((has) => {
			if (has === expected) {
				clearTimeout(timer);
				unsub();
				resolve();
			}
		});
	});
}

// ============================================================================
// Document Sync Tests
// ============================================================================

describe('sync plugin integration', () => {
	let ctx: ReturnType<typeof startTestServer>;

	beforeAll(() => {
		ctx = startTestServer();
	});

	afterAll(async () => {
		await ctx.server.stop();
	});

	test('health endpoint returns ok', async () => {
		const res = await fetch(ctx.httpUrl('/'));
		const body = await res.json();
		expect(body).toEqual({ status: 'ok' });
	});

	test('two clients sync document updates', async () => {
		const room = uniqueRoom();
		const doc1 = new Y.Doc();
		const doc2 = new Y.Doc();

		const p1 = createSyncProvider({ doc: doc1, url: ctx.wsUrl(room) });
		const p2 = createSyncProvider({ doc: doc2, url: ctx.wsUrl(room) });

		try {
			await waitForStatus(p1, 'connected');
			await waitForStatus(p2, 'connected');

			doc1.getMap('data').set('hello', 'world');

			const value = await waitForMapKey(doc2, 'data', 'hello');
			expect(value).toBe('world');
		} finally {
			p1.destroy();
			p2.destroy();
		}
	});

	test('bidirectional sync merges concurrent edits', async () => {
		const room = uniqueRoom();
		const doc1 = new Y.Doc();
		const doc2 = new Y.Doc();

		const p1 = createSyncProvider({ doc: doc1, url: ctx.wsUrl(room) });
		const p2 = createSyncProvider({ doc: doc2, url: ctx.wsUrl(room) });

		try {
			await waitForStatus(p1, 'connected');
			await waitForStatus(p2, 'connected');

			doc1.getMap('data').set('from1', 'value1');
			doc2.getMap('data').set('from2', 'value2');

			await waitForMapKey(doc1, 'data', 'from2');
			await waitForMapKey(doc2, 'data', 'from1');

			expect(doc1.getMap('data').get('from1')).toBe('value1');
			expect(doc1.getMap('data').get('from2')).toBe('value2');
			expect(doc2.getMap('data').get('from1')).toBe('value1');
			expect(doc2.getMap('data').get('from2')).toBe('value2');
		} finally {
			p1.destroy();
			p2.destroy();
		}
	});

	test('late joiner receives existing document state', async () => {
		const room = uniqueRoom();
		const doc1 = new Y.Doc();

		const p1 = createSyncProvider({ doc: doc1, url: ctx.wsUrl(room) });

		try {
			await waitForStatus(p1, 'connected');

			doc1.getMap('data').set('existing', 'content');

			// Small delay for server to process the update
			await new Promise((r) => setTimeout(r, 50));

			const doc2 = new Y.Doc();
			const p2 = createSyncProvider({ doc: doc2, url: ctx.wsUrl(room) });

			try {
				await waitForStatus(p2, 'connected');

				const value = await waitForMapKey(doc2, 'data', 'existing');
				expect(value).toBe('content');
			} finally {
				p2.destroy();
			}
		} finally {
			p1.destroy();
		}
	});

	test('rooms are isolated from each other', async () => {
		const roomA = uniqueRoom();
		const roomB = uniqueRoom();
		const docA = new Y.Doc();
		const docB = new Y.Doc();

		const pA = createSyncProvider({ doc: docA, url: ctx.wsUrl(roomA) });
		const pB = createSyncProvider({ doc: docB, url: ctx.wsUrl(roomB) });

		try {
			await waitForStatus(pA, 'connected');
			await waitForStatus(pB, 'connected');

			docA.getMap('data').set('secret', 'room-a-only');

			// Allow time for any cross-contamination to surface
			await new Promise((r) => setTimeout(r, 200));

			expect(docB.getMap('data').get('secret')).toBeUndefined();
		} finally {
			pA.destroy();
			pB.destroy();
		}
	});

	test('hasLocalChanges tracks server acknowledgment', async () => {
		const room = uniqueRoom();
		const doc = new Y.Doc();

		const provider = createSyncProvider({ doc, url: ctx.wsUrl(room) });

		try {
			await waitForStatus(provider, 'connected');

			// After handshake, server echoes SYNC_STATUS — hasLocalChanges becomes false
			await waitForLocalChanges(provider, false);
			expect(provider.hasLocalChanges).toBe(false);

			// Local edit makes it dirty
			doc.getMap('data').set('key', 'value');
			expect(provider.hasLocalChanges).toBe(true);

			// Server echo makes it clean again
			await waitForLocalChanges(provider, false);
			expect(provider.hasLocalChanges).toBe(false);
		} finally {
			provider.destroy();
		}
	});
});

// ============================================================================
// Auth Tests (separate servers per test — different auth configs)
// ============================================================================

describe('sync plugin auth', () => {
	test('rejects connection without token when auth is required', async () => {
		const ctx = startTestServer({ auth: { token: 'secret' } });

		try {
			const room = uniqueRoom();
			const doc = new Y.Doc();

			const provider = createSyncProvider({
				doc,
				url: ctx.wsUrl(room),
				connect: false,
			});

			const statuses: SyncStatus[] = [];
			provider.onStatusChange((s) => statuses.push(s));
			provider.connect();

			try {
				// Provider retries on failure — wait long enough for 2+ attempts
				await new Promise((r) => setTimeout(r, 1_500));

				expect(statuses).not.toContain('connected');
				expect(statuses).toContain('error');
			} finally {
				provider.destroy();
			}
		} finally {
			await ctx.server.stop();
		}
	});

	test('accepts connection with correct token', async () => {
		const ctx = startTestServer({ auth: { token: 'secret' } });

		try {
			const room = uniqueRoom();
			const doc = new Y.Doc();

			const provider = createSyncProvider({
				doc,
				url: ctx.wsUrl(room),
				token: 'secret',
			});

			try {
				await waitForStatus(provider, 'connected');
				expect(provider.status).toBe('connected');
			} finally {
				provider.destroy();
			}
		} finally {
			await ctx.server.stop();
		}
	});
});
