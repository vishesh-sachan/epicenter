import { Elysia, t } from 'elysia';
import { isSupportedProvider } from '../ai/adapters';
import type { KeyStore } from './store';

/**
 * Create an Elysia plugin for API key management.
 *
 * Provides REST endpoints for storing, listing, and removing
 * provider API keys on the hub server.
 *
 * Registers routes:
 *
 * | Method   | Route                           | Description                |
 * | -------- | ------------------------------- | -------------------------- |
 * | `PUT`    | `/api/provider-keys/:provider`  | Store/update a provider key|
 * | `GET`    | `/api/provider-keys`            | List configured providers  |
 * | `DELETE` | `/api/provider-keys/:provider`  | Remove a provider key      |
 *
 * **Security:** These endpoints should be protected by auth middleware.
 * The plugin itself does not enforce auth — the hub server composition
 * is responsible for applying auth guards.
 *
 * @example
 * ```typescript
 * const store = createKeyStore();
 * const app = new Elysia()
 *   .use(createKeyManagementPlugin(store));
 *
 * // PUT /api/provider-keys/openai { "apiKey": "sk-..." }
 * // GET /api/provider-keys → { providers: ["openai"] }
 * // DELETE /api/provider-keys/openai → { ok: true }
 * ```
 */
export function createKeyManagementPlugin(store: KeyStore) {
	return new Elysia({ prefix: '/api/provider-keys' })
		.put(
			'/:provider',
			async ({ params, body, status }) => {
				if (!isSupportedProvider(params.provider)) {
					return status(
						'Bad Request',
						`Unsupported provider: ${params.provider}`,
					);
				}

				await store.set(params.provider, body.apiKey);

				return { ok: true, provider: params.provider };
			},
			{
				body: t.Object({
					apiKey: t.String({ minLength: 1 }),
				}),
				response: {
					400: t.String(),
				},
			},
		)
		.get('/', () => ({
			providers: store.list(),
		}))
		.delete(
			'/:provider',
			({ params, status }) => {
				if (!isSupportedProvider(params.provider)) {
					return status(
						'Bad Request',
						`Unsupported provider: ${params.provider}`,
					);
				}

				const removed = store.remove(params.provider);

				if (!removed) {
					return status('Not Found', `No key stored for: ${params.provider}`);
				}

				return { ok: true, provider: params.provider };
			},
			{
				response: {
					400: t.String(),
					404: t.String(),
				},
			},
		);
}
