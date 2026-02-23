/**
 * Standalone server entry point.
 *
 * Starts an Epicenter server in one of two modes:
 *
 * - `--mode hub`   — Hub server: sync relay + AI streaming + auth + key management
 * - `--mode local` — Local server: sync relay + workspace API (no AI)
 *
 * Defaults to hub mode when no flag is provided.
 *
 * Usage:
 *   bun packages/server/src/start.ts --mode hub
 *   bun packages/server/src/start.ts --mode local
 *   bun packages/server/src/start.ts
 */

import { createHubServer } from './hub';
import { createLocalServer } from './local';

const port = Number.parseInt(process.env.PORT ?? '3913', 10);

const modeIndex = process.argv.indexOf('--mode');
const mode = modeIndex !== -1 ? process.argv[modeIndex + 1] : 'hub';

const syncHooks = {
	onRoomCreated: (roomId: string) =>
		console.log(`[Sync] Room created: ${roomId}`),
	onRoomEvicted: (roomId: string) =>
		console.log(`[Sync] Room evicted: ${roomId}`),
};

function startServer() {
	if (mode === 'local') {
		const server = createLocalServer({ clients: [], port, sync: syncHooks });
		server.start();
		console.log(`Epicenter LOCAL server running on http://localhost:${port}`);
		console.log(`  Sync:    ws://localhost:${port}/rooms/{room}`);
		console.log(`  (No AI — all AI goes through the hub)`);
		return server;
	}

	// Default: hub mode
	const server = createHubServer({ port, sync: syncHooks });
	server.start();
	console.log(`Epicenter HUB server running on http://localhost:${port}`);
	console.log(`  Sync:    ws://localhost:${port}/rooms/{room}`);
	console.log(`  AI:      POST http://localhost:${port}/ai/chat`);
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
