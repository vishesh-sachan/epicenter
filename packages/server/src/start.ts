/**
 * Standalone server entry point.
 *
 * Starts an Epicenter server in one of three modes:
 *
 * - `--mode hub`     — Hub server: sync relay + AI streaming (default)
 * - `--mode sidecar` — Sidecar: sync relay + workspace API (no AI)
 * - (no flag)        — Legacy: full composition via createServer()
 *
 * Usage:
 *   bun packages/server/src/start.ts --mode hub
 *   bun packages/server/src/start.ts --mode sidecar
 *   bun packages/server/src/start.ts
 */

import { createHubServer } from './hub';
import { createServer } from './server';
import { createSidecarServer } from './sidecar';

const port = Number.parseInt(process.env.PORT ?? '3913', 10);

const modeIndex = process.argv.indexOf('--mode');
const mode = modeIndex !== -1 ? process.argv[modeIndex + 1] : undefined;

const syncHooks = {
	onRoomCreated: (roomId: string) =>
		console.log(`[Sync] Room created: ${roomId}`),
	onRoomEvicted: (roomId: string) =>
		console.log(`[Sync] Room evicted: ${roomId}`),
};

function startServer() {
	if (mode === 'hub') {
		const server = createHubServer({ port, sync: syncHooks });
		server.start();
		console.log(`Epicenter HUB server running on http://localhost:${port}`);
		console.log(`  Sync:    ws://localhost:${port}/rooms/{room}`);
		console.log(`  AI:      POST http://localhost:${port}/ai/chat`);
		return server;
	}

	if (mode === 'sidecar') {
		const server = createSidecarServer({ clients: [], port, sync: syncHooks });
		server.start();
		console.log(`Epicenter SIDECAR server running on http://localhost:${port}`);
		console.log(`  Sync:    ws://localhost:${port}/rooms/{room}`);
		console.log(`  (No AI — all AI goes through the hub)`);
		return server;
	}

	// Legacy mode — full composition (backward compat)
	const server = createServer({ clients: [], port, sync: syncHooks });
	server.start();
	console.log(`Epicenter server running on http://localhost:${port}`);
	console.log(`WebSocket: ws://localhost:${port}/rooms/{room}`);
	return server;
}

const server = startServer();

// Graceful shutdown
process.on('SIGINT', async () => {
	console.log('\nShutting down...');
	await server.stop();
	process.exit(0);
});

process.on('SIGTERM', async () => {
	await server.stop();
	process.exit(0);
});
