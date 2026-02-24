import { chat, maxIterations, toServerSentEventsResponse } from '@tanstack/ai';
import { Elysia, t } from 'elysia';
import { Err, trySync } from 'wellcrafted/result';
import type * as Y from 'yjs';
import {
	createAdapter,
	isSupportedProvider,
	PROVIDER_ENV_VARS,
	resolveApiKey,
} from './adapters';
import { createMutationTools } from './tools/mutation-tools';
import { createReadTools } from './tools/read-tools';

export type AIPluginConfig = {
	/**
	 * Retrieve a Y.Doc by room name.
	 *
	 * Used to create table helpers for the tab-manager workspace,
	 * enabling read tools (query tabs/windows/devices) and mutation tools
	 * (write commands to the commands table).
	 */
	getDoc: (room: string) => Y.Doc | undefined;
};

/**
 * Creates an Elysia plugin that provides a streaming AI chat endpoint with tools.
 *
 * Registers a single route:
 *
 * | Method | Route   | Description                                         |
 * | ------ | ------- | --------------------------------------------------- |
 * | `POST` | `/chat` | Streaming chat via SSE (Server-Sent Events)         |
 *
 * The client sends messages, provider name, model, and API key (via header).
 * The server creates the appropriate TanStack AI adapter, calls `chat()` with
 * read and mutation tools, and streams the response back as SSE.
 *
 * **API key resolution chain:**
 * 1. `x-provider-api-key` header (per-request BYOK — user's own billing)
 * 2. Environment variable (`OPENAI_API_KEY`, etc.) — operator's key
 *
 * All providers require an API key — there are no exceptions.
 *
 * @example
 * ```typescript
 * import { createAIPlugin } from '@epicenter/server/ai';
 *
 * const app = new Elysia()
 *   .use(new Elysia({ prefix: '/ai' }).use(createAIPlugin({ getDoc })))
 *   .listen(3913);
 * ```
 */
export function createAIPlugin({ getDoc }: AIPluginConfig) {
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

			// Build tools from the tab-manager Y.Doc (if available)
			const doc = getDoc('tab-manager');
			const tools = doc
				? [...createReadTools(doc), ...createMutationTools(doc)]
				: [];

			const abortController = new AbortController();

			const { data: stream, error: chatError } = trySync({
				try: () =>
					chat({
						adapter,
						messages,
						conversationId,
						abortController,
						tools,
						agentLoopStrategy: maxIterations(10),
						systemPrompts: [
							SYSTEM_PROMPT,
							...(systemPrompt ? [systemPrompt] : []),
						],
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

const SYSTEM_PROMPT = `You are a helpful browser tab manager assistant. You can search, list, organize, and manage browser tabs across the user's devices.

Available capabilities:
- Search and list tabs, windows, and devices across all synced browsers
- Close, open, activate, pin, mute, group, save, and reload tabs
- Aggregate tab counts by domain

Guidelines:
- When the user asks to close/manage tabs, use searchTabs first to find the right ones
- When a device is ambiguous, use listDevices to show options and ask the user
- Tab IDs are composite (deviceId_tabId) — always use the full composite ID from search results
- For mutations, all tabs in a single command must belong to the same device
- Be concise in responses — confirm what you did, don't over-explain`;
