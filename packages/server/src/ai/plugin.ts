import { chat, toServerSentEventsResponse } from '@tanstack/ai';
import { Elysia, t } from 'elysia';
import { Err, trySync } from 'wellcrafted/result';
import {
	createAdapter,
	isSupportedProvider,
	PROVIDER_ENV_VARS,
	resolveApiKey,
} from './adapters';

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
 * **API key handling**: Keys are sent per-request in the `x-provider-api-key`
 * header. The server never stores, logs, or syncs API keys.
 *
 * @example
 * ```typescript
 * import { createAIPlugin } from '@epicenter/server/ai';
 *
 * const app = new Elysia()
 *   .use(new Elysia({ prefix: '/ai' }).use(createAIPlugin()))
 *   .listen(3913);
 *
 * // POST /ai/chat → SSE stream
 * ```
 */
export function createAIPlugin() {
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

			const apiKey = resolveApiKey(provider, headerApiKey);

			if (provider !== 'ollama' && !apiKey) {
				const envVarName = PROVIDER_ENV_VARS[provider];
				return status(
					'Unauthorized',
					`Missing API key: set x-provider-api-key header or configure ${envVarName} environment variable`,
				);
			}

			const adapter = createAdapter(provider, model, apiKey ?? '');
			if (!adapter) {
				return status('Bad Request', `Unsupported provider: ${provider}`);
			}

			// AbortController for cleanup when client disconnects mid-stream.
			// Passed to both chat() and toServerSentEventsResponse() so the
			// LLM API call and the SSE stream are both cancelled on disconnect.
			// This is the recommended TanStack AI pattern (see api.tanchat.ts).
			const abortController = new AbortController();

			// `chat()` can throw synchronously on adapter/config errors
			// (e.g. invalid model name, malformed options). Streaming errors
			// (rate limits, network drops) are handled internally by TanStack
			// AI—they arrive as `RUN_ERROR` SSE events, not thrown exceptions.
			//
			// We wrap only `chat()` because `toServerSentEventsResponse()` is
			// pure construction (builds a Response around a ReadableStream) and
			// doesn't throw. This keeps the error boundary surgical: one
			// trySync for the one call that can fail.
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
				// 499 "Client Closed Request" (nginx convention) — the client
				// disconnected before chat() could start streaming.
				if (chatError.name === 'AbortError' || abortController.signal.aborted) {
					return status(499, 'Client closed request');
				}
				// 502 "Bad Gateway" — we're proxying to the AI provider and
				// it rejected the request (bad API key, unknown model, etc.).
				return status('Bad Gateway', `Provider error: ${chatError.message}`);
			}

			return toServerSentEventsResponse(stream, { abortController });
		},
		{
			body: t.Object({
				messages: t.Array(t.Any()), // ModelMessage[] — validated by TanStack AI at runtime
				provider: t.String(),
				model: t.String(),
				conversationId: t.Optional(t.String()),
				systemPrompt: t.Optional(t.String()),
				modelOptions: t.Optional(t.Any()), // Provider-specific options (temperature, thinking, etc.)
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
