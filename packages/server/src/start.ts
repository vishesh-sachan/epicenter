/**
 * Standalone sync server entry point.
 *
 * Starts a pure Yjs sync relay with rooms created on demand.
 * No workspace schemas needed — any client can connect and sync.
 *
 * Usage:
 *   bun packages/server/src/start.ts
 *   bun run --filter @epicenter/server start
 *
 * Clients connect to:
 *   ws://localhost:3913/rooms/{room}
 */

import { createSyncServer } from './sync';

const port = Number.parseInt(process.env.PORT ?? '3913', 10);

const server = createSyncServer({
	port,
	onRoomCreated: (roomId) => console.log(`[Sync] Room created: ${roomId}`),
	onRoomEvicted: (roomId) => console.log(`[Sync] Room evicted: ${roomId}`),
});

server.start();

console.log(`Epicenter sync server running on http://localhost:${port}`);
console.log(`WebSocket: ws://localhost:${port}/rooms/{room}`);

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
