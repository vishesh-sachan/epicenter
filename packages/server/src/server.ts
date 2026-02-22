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

export type ServerConfig = {
	/**
	 * Workspace clients to expose via REST CRUD and action endpoints.
	 *
	 * Pass an empty array for a sync-only relay (no workspace routes).
	 * Non-empty arrays mount table and action endpoints under `/workspaces/{id}`.
	 */
	clients: AnyWorkspaceClient[];

	/**
	 * Port to listen on.
	 *
	 * Falls back to the `PORT` environment variable, then {@link DEFAULT_PORT} (3913).
	 */
	port?: number;

	/** Sync plugin options (WebSocket rooms, auth, lifecycle hooks). */
	sync?: {
		/** Auth for sync endpoints. Omit for open mode (no auth). */
		auth?: AuthConfig;

		/** Called when a new sync room is created on demand. */
		onRoomCreated?: (roomId: string, doc: Y.Doc) => void;

		/** Called when an idle sync room is evicted after all clients disconnect. */
		onRoomEvicted?: (roomId: string, doc: Y.Doc) => void;
	};
};

/**
 * Create an Epicenter HTTP server.
 *
 * Composes sync (WebSocket + REST document state), OpenAPI docs, AI endpoints,
 * and a discovery root into a single Elysia app. When `clients` is non-empty,
 * also mounts RESTful table CRUD and action endpoints under `/workspaces`.
 *
 * The server always provides:
 * - `/` — API root with discovery info (workspace IDs, action paths)
 * - `/openapi` — Interactive API documentation (Scalar UI)
 * - `/rooms/{id}` — WebSocket sync + REST document state (GET/POST)
 * - `/ai/chat` — Streaming AI chat via SSE
 *
 * With workspace clients, also provides:
 * - `/workspaces/{id}/tables/{table}` — RESTful table CRUD
 * - `/workspaces/{id}/actions/{action}` — Workspace action endpoints
 *
 * @example
 * ```typescript
 * // Sync relay only — no workspace config needed
 * createServer({ clients: [] }).start();
 *
 * // Full server with workspace REST + sync
 * createServer({ clients: [blogClient], port: 3913 }).start();
 *
 * // Multiple workspaces with auth
 * createServer({
 *   clients: [blogClient, authClient],
 *   sync: { auth: { token: 'my-secret' } },
 * }).start();
 * ```
 */
export function createServer(config: ServerConfig) {
	const { clients, sync } = config;

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
					auth: sync?.auth,
					onRoomCreated: sync?.onRoomCreated,
					onRoomEvicted: sync?.onRoomEvicted,
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
		config.port ??
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
		 *
		 * Cleans up workspace clients, ephemeral sync documents, and the HTTP listener.
		 */
		async stop() {
			app.stop();
			await Promise.all(clients.map((c) => c.destroy()));
			for (const doc of dynamicDocs.values()) doc.destroy();
			dynamicDocs.clear();
		},
	};
}
