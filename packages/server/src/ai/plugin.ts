import {
	type AnyTextAdapter,
	chat,
	toServerSentEventsResponse,
} from '@tanstack/ai';
import { Elysia, t } from 'elysia';
import { createAdapter, SUPPORTED_PROVIDERS } from './adapters';

/**
 * Configuration for the AI plugin.
 *
 * All options are optional — the plugin works out-of-the-box with sensible defaults.
 */
export type AIPluginConfig = {
	/** Override the list of supported providers. Defaults to all built-in adapters. */
	providers?: string[];
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
export function createAIPlugin(config?: AIPluginConfig) {
	const allowedProviders = config?.providers ?? SUPPORTED_PROVIDERS;

	return new Elysia().post(
		'/chat',
		async ({ body, headers, set }) => {
			const apiKey = headers['x-provider-api-key'];
			const { messages, provider, model, conversationId, systemPrompt } = body;

			// Ollama is local — no API key needed
			if (provider !== 'ollama' && !apiKey) {
				set.status = 401;
				return { error: 'Missing x-provider-api-key header' };
			}

			if (!allowedProviders.includes(provider)) {
				set.status = 400;
				return { error: `Unsupported provider: ${provider}` };
			}

			const adapter = createAdapter(provider, model, apiKey) as
				| AnyTextAdapter
				| undefined;
			if (!adapter) {
				set.status = 400;
				return { error: `Unsupported provider: ${provider}` };
			}

			// AbortController for cleanup when client disconnects mid-stream.
			// Passed to both chat() and toServerSentEventsResponse() so the
			// LLM API call and the SSE stream are both cancelled on disconnect.
			const abortController = new AbortController();

			try {
				const stream = chat({
					adapter,
					messages,
					conversationId,
					abortController,
					...(systemPrompt ? { systemPrompts: [systemPrompt] } : {}),
				});

				return toServerSentEventsResponse(stream, { abortController });
			} catch (error) {
				// Provider errors (bad API key, rate limit, model not found)
				// may throw synchronously before streaming starts.
				const message =
					error instanceof Error ? error.message : 'Unknown error';
				set.status = 502;
				return { error: `Provider error: ${message}` };
			}
		},
		{
			body: t.Object({
				messages: t.Array(t.Any()), // ModelMessage[] — validated by TanStack AI at runtime
				provider: t.String(),
				model: t.String(),
				conversationId: t.Optional(t.String()),
				systemPrompt: t.Optional(t.String()),
			}),
		},
	);
}
