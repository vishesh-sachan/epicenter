/**
 * Standalone server entry point.
 *
 * Starts an Epicenter server with sync, OpenAPI docs, and AI endpoints.
 * No workspace schemas needed — any client can connect and sync.
 *
 * Usage:
 *   bun packages/server/src/start.ts
 *   bun run --filter @epicenter/server start
 *
 * Clients connect to:
 *   ws://localhost:3913/rooms/{room}
 */

import { createServer } from './server';

const port = Number.parseInt(process.env.PORT ?? '3913', 10);

const server = createServer({
	clients: [],
	port,
	sync: {
		onRoomCreated: (roomId) => console.log(`[Sync] Room created: ${roomId}`),
		onRoomEvicted: (roomId) => console.log(`[Sync] Room evicted: ${roomId}`),
	},
});

server.start();

console.log(`Epicenter server running on http://localhost:${port}`);
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
