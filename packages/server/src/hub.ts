import { openapi } from '@elysiajs/openapi';
import { Elysia } from 'elysia';
import * as Y from 'yjs';
import { createAIPlugin } from './ai';
import { type AuthPluginConfig, createAuthPlugin } from './auth';
import {
	createKeyManagementPlugin,
	createKeyStore,
	type KeyStore,
} from './keys';
import { createProxyPlugin } from './proxy';
import type { AuthConfig } from './sync/auth';
import { createSyncPlugin } from './sync/plugin';

export { DEFAULT_PORT } from './server';

export type HubServerConfig = {
	/**
	 * Port to listen on.
	 *
	 * Falls back to the `PORT` environment variable, then 3913.
	 */
	port?: number;

	/**
	 * Better Auth configuration.
	 *
	 * When provided, mounts Better Auth at `/auth/*` with session-based
	 * authentication and Bearer token support. Omit for open mode (no auth).
	 */
	auth?: AuthPluginConfig;

	/**
	 * Encrypted API key store for server-side key management.
	 *
	 * When provided, the hub stores provider API keys encrypted on disk
	 * and mounts key management REST endpoints at `/api/provider-keys`.
	 * Also enables the AI proxy for OpenCode at `/proxy/{provider}/*`.
	 *
	 * Pass `true` to use the default store directory (`~/.epicenter/server/`),
	 * or pass a `KeyStore` instance for custom configuration.
	 */
	keyStore?: KeyStore | true;

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
 * Create an Epicenter hub server.
 *
 * The hub is the coordination server in the three-tier topology. It provides:
 * - Better Auth authentication (when configured)
 * - API key management (when key store configured)
 * - AI proxy for OpenCode (when key store configured)
 * - Sync relay (primary) — all devices sync through the hub
 * - AI streaming — all providers (cloud + Ollama) via SSE
 * - OpenAPI docs
 * - Discovery root
 *
 * The hub does NOT serve workspace CRUD — that's the local server's job.
 *
 * @example
 * ```typescript
 * import { Database } from 'bun:sqlite';
 *
 * // Full hub: auth + key store + proxy + sync + AI
 * createHubServer({
 *   auth: {
 *     database: new Database('auth.db'),
 *     secret: 'my-secret',
 *     trustedOrigins: ['tauri://localhost'],
 *   },
 *   keyStore: true,
 * }).start();
 *
 * // Minimal hub — no auth, no key store (development)
 * createHubServer({}).start();
 * ```
 */
export function createHubServer(config: HubServerConfig) {
	const { sync } = config;

	// Resolve key store: `true` = default store, `KeyStore` = custom, `undefined` = none
	const keyStore =
		config.keyStore === true
			? createKeyStore()
			: (config.keyStore ?? undefined);

	/** Ephemeral Y.Docs for rooms (hub is a pure relay, no pre-registered workspaces). */
	const dynamicDocs = new Map<string, Y.Doc>();

	const app = new Elysia()
		.use(
			openapi({
				embedSpec: true,
				documentation: {
					info: {
						title: 'Epicenter Hub API',
						version: '1.0.0',
						description:
							'Hub server — sync relay, AI streaming, and coordination.',
					},
				},
			}),
		)
		.use(
			new Elysia({ prefix: '/rooms' }).use(
				createSyncPlugin({
					getDoc: (room) => {
						if (!dynamicDocs.has(room)) {
							dynamicDocs.set(room, new Y.Doc());
						}
						return dynamicDocs.get(room);
					},
					auth: sync?.auth,
					onRoomCreated: sync?.onRoomCreated,
					onRoomEvicted: sync?.onRoomEvicted,
				}),
			),
		)
		.use(new Elysia({ prefix: '/ai' }).use(createAIPlugin({ keyStore })))
		.get('/', () => ({
			name: 'Epicenter Hub',
			version: '1.0.0',
			mode: 'hub' as const,
		}));

	// Mount Better Auth when configured
	if (config.auth) {
		app.use(createAuthPlugin(config.auth));
	}

	// Mount key management and AI proxy when key store is active
	if (keyStore) {
		app.use(createKeyManagementPlugin(keyStore));
		app.use(createProxyPlugin({ keyStore }));
	}

	const port = config.port ?? Number.parseInt(process.env.PORT ?? '3913', 10);

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
		 * Stop the HTTP server and clean up resources.
		 */
		async stop() {
			app.stop();
			for (const doc of dynamicDocs.values()) doc.destroy();
			dynamicDocs.clear();
		},
	};
}
