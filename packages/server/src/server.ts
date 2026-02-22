import { openapi } from '@elysiajs/openapi';
import type { AnyWorkspaceClient } from '@epicenter/hq';
import { Elysia } from 'elysia';
import * as Y from 'yjs';
import { createAIPlugin } from './ai';
import type { AuthConfig } from './sync/auth';
import { createSyncPlugin } from './sync/plugin';
import { createWorkspacePlugin } from './workspace';
import { collectActionPaths } from './workspace/actions';

export const DEFAULT_PORT = 3913;

export type ServerOptions = {
	port?: number;
	/** Auth configuration passed through to the sync plugin. */
	auth?: AuthConfig;
	/** Called when a new sync room is created on demand. */
	onRoomCreated?: (roomId: string, doc: Y.Doc) => void;
	/** Called when an idle sync room is evicted. */
	onRoomEvicted?: (roomId: string, doc: Y.Doc) => void;
};

/**
 * Create an Epicenter HTTP server.
 *
 * Always includes sync (WebSocket + REST document state), OpenAPI docs, AI endpoints,
 * and a discovery root. When the clients array is non-empty, also mounts RESTful
 * table CRUD and action endpoints under `/workspaces`.
 *
 * @example
 * ```typescript
 * // Sync relay only (no workspace config needed)
 * createServer([]).start();
 *
 * // Full server with workspace REST + sync
 * createServer([client], { port: 3913 }).start();
 *
 * // Multiple workspaces
 * createServer([blogClient, authClient]).start();
 * ```
 */
export function createServer(
	clients: AnyWorkspaceClient[],
	options?: ServerOptions,
) {
	const workspaces: Record<string, AnyWorkspaceClient> = {};
	for (const client of clients) {
		workspaces[client.id] = client;
	}

	/** Ephemeral Y.Docs for rooms with no pre-registered workspace client. */
	const dynamicDocs = new Map<string, Y.Doc>();

	const allActionPaths = clients.flatMap((client) => {
		if (!client.actions) return [];
		return collectActionPaths(client.actions).map((p) => `${client.id}/${p}`);
	});

	const app = new Elysia()
		.use(
			openapi({
				embedSpec: true,
				documentation: {
					info: {
						title: 'Epicenter API',
						version: '1.0.0',
						description: 'API documentation for Epicenter workspaces',
					},
				},
			}),
		)
		.use(
			new Elysia({ prefix: '/rooms' }).use(
				createSyncPlugin({
					getDoc:
						clients.length > 0
							? (room) => {
									if (workspaces[room]) return workspaces[room].ydoc;

									if (!dynamicDocs.has(room)) {
										dynamicDocs.set(room, new Y.Doc());
									}
									return dynamicDocs.get(room);
								}
							: undefined,
					auth: options?.auth,
					onRoomCreated: options?.onRoomCreated,
					onRoomEvicted: options?.onRoomEvicted,
				}),
			),
		)
		.use(new Elysia({ prefix: '/ai' }).use(createAIPlugin()))
		.get('/', () => ({
			name: 'Epicenter API',
			version: '1.0.0',
			workspaces: Object.keys(workspaces),
			actions: allActionPaths,
		}));

	if (clients.length > 0) {
		app.use(
			new Elysia({ prefix: '/workspaces' }).use(createWorkspacePlugin(clients)),
		);
	}

	const port =
		options?.port ??
		Number.parseInt(process.env.PORT ?? String(DEFAULT_PORT), 10);

	return {
		app,

		/**
		 * Start listening on the configured port.
		 *
		 * Does not log or install signal handlers — the caller owns those concerns.
		 */
		start() {
			app.listen(port);
			return app.server;
		},

		/**
		 * Stop the HTTP server and destroy all workspace clients.
		 */
		async stop() {
			app.stop();
			await Promise.all(clients.map((c) => c.destroy()));
			for (const doc of dynamicDocs.values()) doc.destroy();
			dynamicDocs.clear();
		},
	};
}
