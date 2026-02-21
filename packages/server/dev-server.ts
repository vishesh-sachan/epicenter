/**
 * Development server for tab-manager
 *
 * Usage: bun run dev-server.ts
 */

import { createWorkspace } from '@epicenter/hq';
import { definition } from '@epicenter/tab-manager/workspace';
import { createServer } from './src/index';

console.log('Starting tab-manager sync server...');

// Create workspace client with no extensions (server only needs Y.Doc)
const client = createWorkspace(definition);

// Create and start server
const server = createServer([client], { port: 3913 });
server.start();

console.log('');
console.log('✓ Server running on http://localhost:3913');
console.log('✓ Sync endpoint: ws://localhost:3913/rooms/tab-manager/sync');
console.log('');
console.log('Press Ctrl+C to stop');

// Graceful shutdown
process.on('SIGINT', async () => {
	console.log('\n\nShutting down...');
	await server.stop();
	console.log('✓ Server stopped');
	process.exit(0);
});
