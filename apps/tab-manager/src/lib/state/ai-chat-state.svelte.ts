/**
 * Reactive AI chat state for the sidepanel.
 *
 * Manages a TanStack AI chat connection with SSE streaming, backed by
 * Y.Doc persistence for message history. Uses a unidirectional persistence
 * model: write to Y.Doc on send/complete, read from Y.Doc on panel open.
 *
 * The TanStack AI `createChat` provides reactive Svelte 5 state via runes —
 * `.messages`, `.isLoading`, `.error` are all reactive getters that update
 * automatically as streaming progresses.
 *
 * @example
 * ```svelte
 * <script>
 *   import { aiChatState } from '$lib/state/ai-chat-state.svelte';
 * </script>
 *
 * {#each aiChatState.messages as message (message.id)}
 *   <ChatBubble {message} />
 * {/each}
 * ```
 */

import { generateId } from '@epicenter/hq';
import {
	createChat,
	fetchServerSentEvents,
	type UIMessage,
} from '@tanstack/ai-svelte';
import { ANTHROPIC_MODELS } from '@tanstack/ai-anthropic';
import { GeminiTextModels } from '@tanstack/ai-gemini';
import { GROK_CHAT_MODELS } from '@tanstack/ai-grok';
import { OPENAI_CHAT_MODELS } from '@tanstack/ai-openai';
import { getServerUrl } from '$lib/state/settings';
import { popupWorkspace } from '$lib/workspace-popup';

// ─────────────────────────────────────────────────────────────────────────────
// Provider / Model Configuration
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Model arrays imported from TanStack AI provider packages.
 *
 * These are maintained by the TanStack AI team — no local hardcoded lists.
 * To update model lists, run: `bun update @tanstack/ai-openai @tanstack/ai-anthropic ...`
 *
 * Arrays are ordered newest-first by the upstream packages.
 */
const PROVIDER_MODELS = {
	openai: OPENAI_CHAT_MODELS,
	anthropic: ANTHROPIC_MODELS,
	gemini: GeminiTextModels,
	grok: GROK_CHAT_MODELS,
	// Ollama models are curated here (not imported from @tanstack/ai-ollama)
	// because that package pulls in the `ollama` SDK which depends on node:fs,
	// breaking the browser extension build. Users can type any model name
	// via the combobox's freeform input.
	ollama: [
		'deepseek-r1',
		'qwen3',
		'llama4',
		'gemma3',
		'phi4',
		'mistral',
		'codellama',
		'llama3',
	] as const,
} as const;

type Provider = keyof typeof PROVIDER_MODELS;

const AVAILABLE_PROVIDERS = Object.keys(PROVIDER_MODELS) as Provider[];

// ─────────────────────────────────────────────────────────────────────────────
// Server URL Cache
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Cached server URL for synchronous access.
 *
 * `fetchServerSentEvents` requires a synchronous URL getter (`string | (() => string)`).
 * We initialize with the default and update asynchronously from settings.
 * For 99% of users the default never changes.
 */
let serverUrlCache = 'http://127.0.0.1:3913';
void getServerUrl().then((url) => {
	serverUrlCache = url;
});

// ─────────────────────────────────────────────────────────────────────────────
// State Factory
// ─────────────────────────────────────────────────────────────────────────────

function createAiChatState() {
	// Reactive state for provider/model selection
	let provider = $state('openai');
	let model = $state('gpt-4o-mini');

	// Stable conversation ID for v1 (single conversation).
	// Using a fixed string so Y.Doc messages persist across app reloads.
	const conversationId = 'default';

	// ── Y.Doc Persistence: Read existing messages on init ──────────────

	/**
	 * Load persisted messages for the active conversation from Y.Doc.
	 *
	 * This is the "read on open" part of unidirectional persistence.
	 * Called once at init to seed `initialMessages` in `createChat`.
	 */
	const loadPersistedMessages = () => {
		const rows = popupWorkspace.tables.chatMessages
			.getAllValid()
			.filter((m) => m.conversationId === conversationId)
			.sort((a, b) => a.createdAt - b.createdAt);

		return rows.map(
			(row) =>
				({
					id: row.id,
					role: row.role,
					parts: row.parts,
					createdAt: new Date(row.createdAt),
				}) as UIMessage,
		);
	};

	// ── TanStack AI Chat Connection ───────────────────────────────────

	/**
	 * The core chat instance from `@tanstack/ai-svelte`.
	 *
	 * - `connection`: SSE adapter pointing at the server's `/ai/chat` endpoint.
	 *   The URL getter is synchronous (reads from cache). The options callback
	 *   is async and injects the current provider/model as body params.
	 * - `initialMessages`: Seeded from Y.Doc on panel open.
	 * - `onFinish`: Writes the completed assistant message to Y.Doc.
	 */
	const chatInstance = createChat({
		initialMessages: loadPersistedMessages(),
		connection: fetchServerSentEvents(
			() => `${serverUrlCache}/ai/chat`,
			async () => ({
				body: {
					provider,
					model,
				},
			}),
		),
		onFinish: (message) => {
			// Write assistant message to Y.Doc on stream complete
			popupWorkspace.tables.chatMessages.set({
				id: message.id,
				conversationId,
				role: 'assistant',
				parts: message.parts,
				createdAt: message.createdAt?.getTime() ?? Date.now(),
				_v: 1,
			});
		},
	});

	return {
		/** The current list of chat messages (reactive via Svelte 5 runes). */
		get messages() {
			return chatInstance.messages;
		},

		/** Whether a response is currently streaming. */
		get isLoading() {
			return chatInstance.isLoading;
		},

		/** The latest error from the chat connection, if any. */
		get error() {
			return chatInstance.error;
		},

		/**
		 * Fine-grained connection status.
		 *
		 * More granular than `isLoading` — distinguishes between idle,
		 * streaming, and other states. Useful for nuanced UI indicators
		 * (e.g., "connecting…" vs "generating…").
		 */
		get status() {
			return chatInstance.status;
		},

		/** The active conversation ID. */
		get conversationId() {
			return conversationId;
		},

		/** Current provider name. */
		get provider() {
			return provider;
		},
		set provider(value: string) {
			provider = value;
			// Auto-select first model for new provider
			const models = PROVIDER_MODELS[value as Provider];
			if (models?.[0]) {
				model = models[0];
			}
		},

		/** Current model name. */
		get model() {
			return model;
		},
		set model(value: string) {
			model = value;
		},

		/** List of available provider names. */
		get availableProviders() {
			return AVAILABLE_PROVIDERS;
		},

		/**
		 * Get the curated model list for a given provider.
		 *
		 * @example
		 * ```typescript
		 * aiChatState.modelsForProvider('openai')
		 * // → ['gpt-4o', 'gpt-4o-mini', 'o3-mini']
		 * ```
		 */
		modelsForProvider(providerName: string): readonly string[] {
			return PROVIDER_MODELS[providerName as Provider] ?? [];
		},

		/**
		 * Send a user message and begin streaming the assistant response.
		 *
		 * Writes the user message to Y.Doc immediately before the TanStack AI
		 * `sendMessage` call. The assistant response is persisted via `onFinish`.
		 *
		 * Uses `MultimodalContent` format with a custom `id` so the Y.Doc row
		 * and the TanStack AI message share the same identifier.
		 */
		sendMessage(content: string) {
			if (!content.trim()) return;

			const userMessageId = generateId();

			// Write user message to Y.Doc (unidirectional: write on send)
			popupWorkspace.tables.chatMessages.set({
				id: userMessageId,
				conversationId,
				role: 'user',
				parts: [{ type: 'text', content }],
				createdAt: Date.now(),
				_v: 1,
			});

			// Send via TanStack AI (triggers SSE streaming).
			// Pass { content, id } to use our custom ID for the user message.
			void chatInstance.sendMessage({ content, id: userMessageId });
		},

		/**
		 * Regenerate the last assistant message.
		 *
		 * Deletes the old assistant message from Y.Doc, then calls TanStack AI's
		 * `reload()` which removes all messages after the last user message from
		 * memory and re-requests a response. The new response is persisted to
		 * Y.Doc via the `onFinish` callback when streaming completes.
		 *
		 * The Y.Doc delete happens eagerly (before the network request) to keep
		 * persistence and memory in sync. If the network request fails, the old
		 * response is lost — acceptable since the user explicitly asked to
		 * regenerate and can re-send.
		 *
		 * @example
		 * ```typescript
		 * // Typical flow:
		 * // 1. Delete old assistant message from Y.Doc (sync)
		 * // 2. TanStack removes it from memory (sync)
		 * // 3. New response streams in (async)
		 * // 4. onFinish writes new response to Y.Doc
		 * aiChatState.reload();
		 * ```
		 */
		reload() {
			// Delete the old assistant message from Y.Doc before regenerating,
			// so it does not resurface as a duplicate on next load.
			const lastMessage = chatInstance.messages.at(-1);
			if (lastMessage?.role === 'assistant') {
				popupWorkspace.tables.chatMessages.delete({ id: lastMessage.id });
			}
			void chatInstance.reload();
		},

		/** Stop the current streaming response. */
		stop() {
			chatInstance.stop();
		},

		/** Clear all messages from the chat (does not delete from Y.Doc). */
		clear() {
			chatInstance.clear();
		},
	};
}

export const aiChatState = createAiChatState();
