import { chat, toServerSentEventsResponse } from '@tanstack/ai';
import { Elysia, t } from 'elysia';
import { Err, trySync } from 'wellcrafted/result';
import type { KeyStore } from '../keys/store';
import {
	createAdapter,
	isSupportedProvider,
	PROVIDER_ENV_VARS,
	resolveApiKey,
} from './adapters';

/**
 * Configuration for the AI plugin.
 */
export type AIPluginConfig = {
	/**
	 * Encrypted key store for server-side API key resolution.
	 *
	 * When provided, the resolution chain becomes:
	 * 1. Per-request header (x-provider-api-key)
	 * 2. Server key store (encrypted)
	 * 3. Environment variable
	 *
	 * Omit for header-only or env-only key resolution.
	 */
	keyStore?: KeyStore;
};

/**
 * Creates an Elysia plugin that provides a streaming AI chat endpoint.
 *
 * Registers a single route:
 *
 * | Method | Route   | Description                                         |
 * | ------ | ------- | --------------------------------------------------- |
 * | `POST` | `/chat` | Streaming chat via SSE (Server-Sent Events)         |
 *
 * The client sends messages, provider name, model, and API key (via header).
 * The server creates the appropriate TanStack AI adapter, calls `chat()`,
 * and streams the response back as SSE using `toServerSentEventsResponse()`.
 *
 * **API key resolution chain** (when key store is provided):
 * 1. `x-provider-api-key` header (per-request, backward compat)
 * 2. Server key store (encrypted on disk)
 * 3. Environment variable (`OPENAI_API_KEY`, etc.)
 *
 * All providers require an API key — there are no exceptions.
 *
 * @example
 * ```typescript
 * import { createAIPlugin } from '@epicenter/server/ai';
 *
 * // Without key store (backward compat)
 * const app = new Elysia()
 *   .use(new Elysia({ prefix: '/ai' }).use(createAIPlugin()))
 *   .listen(3913);
 *
 * // With key store (hub server)
 * const store = createKeyStore();
 * const app = new Elysia()
 *   .use(new Elysia({ prefix: '/ai' }).use(createAIPlugin({ keyStore: store })))
 *   .listen(3913);
 * ```
 */
export function createAIPlugin(config?: AIPluginConfig) {
	const keyStore = config?.keyStore;

	return new Elysia().post(
		'/chat',
		async ({ body, headers, status }) => {
			const headerApiKey = headers['x-provider-api-key'];
			const {
				messages,
				provider,
				model,
				conversationId,
				systemPrompt,
				modelOptions,
			} = body;

			if (!isSupportedProvider(provider)) {
				return status('Bad Request', `Unsupported provider: ${provider}`);
			}

			const apiKey = await resolveApiKey(provider, headerApiKey, keyStore);

			if (!apiKey) {
				const envVarName = PROVIDER_ENV_VARS[provider];
				return status(
					'Unauthorized',
					`Missing API key: set x-provider-api-key header or configure ${envVarName} environment variable`,
				);
			}

			const adapter = createAdapter(provider, model, apiKey);
			if (!adapter) {
				return status('Bad Request', `Unsupported provider: ${provider}`);
			}

			const abortController = new AbortController();

			const { data: stream, error: chatError } = trySync({
				try: () =>
					chat({
						adapter,
						messages,
						conversationId,
						abortController,
						...(systemPrompt ? { systemPrompts: [systemPrompt] } : {}),
						...(modelOptions ? { modelOptions } : {}),
					}),
				catch: (e) => Err(e instanceof Error ? e : new Error(String(e))),
			});

			if (chatError) {
				if (chatError.name === 'AbortError' || abortController.signal.aborted) {
					return status(499, 'Client closed request');
				}
				return status('Bad Gateway', `Provider error: ${chatError.message}`);
			}

			return toServerSentEventsResponse(stream, { abortController });
		},
		{
			body: t.Object({
				messages: t.Array(t.Any()),
				provider: t.String(),
				model: t.String(),
				conversationId: t.Optional(t.String()),
				systemPrompt: t.Optional(t.String()),
				modelOptions: t.Optional(t.Any()),
			}),
			response: {
				400: t.String(),
				401: t.String(),
				499: t.String(),
				502: t.String(),
			},
		},
	);
}
