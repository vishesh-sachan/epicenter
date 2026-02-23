/**
 * Reactive AI chat state with multi-conversation support.
 *
 * Manages multiple AI conversations backed by Y.Doc persistence.
 * Uses a single TanStack AI `createChat()` instance with `setMessages()`
 * swapping for conversation switching — no instance recreation.
 *
 * Provider and model are stored per-conversation in the `conversations`
 * table, surviving reloads and syncing across devices.
 *
 * Reactivity model:
 * - `conversations` table observer → wholesale-replace `$state` array
 * - `activeConversation` is `$derived` from active ID + conversations
 * - `chatInstance.messages` provides the reactive message list
 *
 * @example
 * ```svelte
 * <script>
 *   import { aiChatState } from '$lib/state/chat.svelte';
 * </script>
 *
 * {#each aiChatState.conversations as conv (conv.id)}
 *   <button onclick={() => aiChatState.switchConversation(conv.id)}>
 *     {conv.title}
 *   </button>
 * {/each}
 *
 * {#each aiChatState.messages as message (message.id)}
 *   <ChatBubble {message} />
 * {/each}
 * ```
 */

import { generateId } from '@epicenter/hq';
import { ANTHROPIC_MODELS } from '@tanstack/ai-anthropic';
import { GeminiTextModels } from '@tanstack/ai-gemini';
import { GROK_CHAT_MODELS } from '@tanstack/ai-grok';
import { OPENAI_CHAT_MODELS } from '@tanstack/ai-openai';
import { createChat, fetchServerSentEvents } from '@tanstack/ai-svelte';
import { getHubServerUrl } from '$lib/state/settings';
import { rowToUIMessage } from '$lib/ui-message';
import type { Conversation } from '$lib/workspace';
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
} as const;

type Provider = keyof typeof PROVIDER_MODELS;

const DEFAULT_PROVIDER: Provider = 'openai';
const DEFAULT_MODEL = 'gpt-4o-mini';
const AVAILABLE_PROVIDERS = Object.keys(PROVIDER_MODELS) as Provider[];

// ─────────────────────────────────────────────────────────────────────────────
// Hub Server URL Cache
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Cached hub server URL for synchronous access.
 *
 * `fetchServerSentEvents` requires a synchronous URL getter (`string | (() => string)`).
 * We initialize with the default and update asynchronously from settings.
 * AI chat routes through the hub server (auth + AI + keys), not the local server.
 */
let hubUrlCache = 'http://127.0.0.1:3913';
void getHubServerUrl().then((url) => {
	hubUrlCache = url;
});

// ─────────────────────────────────────────────────────────────────────────────
// State Factory
// ─────────────────────────────────────────────────────────────────────────────

function createAiChatState() {
	// ── Conversation List (Y.Doc-backed) ──────────────────────────────

	/** Read all conversations sorted by most recently updated first. */
	const readAllConversations = (): Conversation[] =>
		popupWorkspace.tables.conversations
			.getAllValid()
			.sort((a, b) => b.updatedAt - a.updatedAt);

	let conversations = $state<Conversation[]>(readAllConversations());

	// Re-read on every Y.Doc change — observer fires on persistence load
	// and any subsequent remote/local modification.
	popupWorkspace.tables.conversations.observe(() => {
		conversations = readAllConversations();
	});

	// ── Active Conversation ───────────────────────────────────────────

	/** Initialize to the most recent conversation, or null if none exist. */
	let activeConversationId = $state<string | null>(
		conversations[0]?.id ?? null,
	);

	/**
	 * Derived from `activeConversationId` + `conversations`.
	 *
	 * Re-evaluates when either changes — e.g. when provider/model is
	 * updated in the table, the observer fires, `conversations` updates,
	 * and this re-derives with the new metadata.
	 */
	const activeConversation = $derived(
		conversations.find((c) => c.id === activeConversationId) ?? null,
	);

	// ── Helpers ───────────────────────────────────────────────────────

	/**
	 * Get the active conversation by reading `$state` directly.
	 *
	 * Used in non-reactive contexts (async callbacks, event handlers)
	 * where `$derived` tracking isn't needed.
	 */
	const getActiveConversation = (): Conversation | null =>
		conversations.find((c) => c.id === activeConversationId) ?? null;

	/** Load persisted messages for a conversation from Y.Doc. */
	const loadMessagesForConversation = (conversationId: string) =>
		popupWorkspace.tables.chatMessages
			.getAllValid()
			.filter((m) => m.conversationId === conversationId)
			.sort((a, b) => a.createdAt - b.createdAt)
			.map(rowToUIMessage);

	// ── TanStack AI Chat Instance ─────────────────────────────────────

	/**
	 * Single chat instance — reused across conversation switches.
	 *
	 * - `connection`: SSE adapter. The async options callback reads from
	 *   reactive state closures, so it always sends the current
	 *   conversation's provider/model without instance recreation.
	 * - `initialMessages`: Seeded from the most recent conversation (if any).
	 * - `onFinish`: Persists the completed assistant message to Y.Doc.
	 */
	const chatInstance = createChat({
		initialMessages: activeConversationId
			? loadMessagesForConversation(activeConversationId)
			: [],
		connection: fetchServerSentEvents(
			() => `${hubUrlCache}/ai/chat`,
			async () => {
				const conv = getActiveConversation();
				return {
					body: {
						provider: conv?.provider ?? DEFAULT_PROVIDER,
						model: conv?.model ?? DEFAULT_MODEL,
						conversationId: activeConversationId ?? undefined,
						systemPrompt: conv?.systemPrompt ?? undefined,
					},
				};
			},
		),
		onFinish: (message) => {
			const convId = activeConversationId;
			if (!convId) return;

			// Persist assistant message
			popupWorkspace.tables.chatMessages.set({
				id: message.id,
				conversationId: convId,
				role: 'assistant',
				parts: message.parts,
				createdAt: message.createdAt?.getTime() ?? Date.now(),
				_v: 1,
			});

			// Touch conversation's updatedAt so it floats to top of list
			const conv = getActiveConversation();
			if (conv) {
				popupWorkspace.tables.conversations.set({
					...conv,
					updatedAt: Date.now(),
				});
			}
		},
	});

	// ── Conversation CRUD ─────────────────────────────────────────────

	/**
	 * Create a new conversation and switch to it.
	 *
	 * Inherits provider/model from the current conversation so new
	 * threads continue with the user's preferred settings.
	 *
	 * @returns The new conversation's ID.
	 */
	function createConversation(opts?: {
		title?: string;
		parentId?: string;
		sourceMessageId?: string;
		systemPrompt?: string;
	}): string {
		const id = generateId();
		const now = Date.now();
		const current = getActiveConversation();

		popupWorkspace.tables.conversations.set({
			id,
			title: opts?.title ?? 'New Chat',
			parentId: opts?.parentId,
			sourceMessageId: opts?.sourceMessageId,
			systemPrompt: opts?.systemPrompt,
			provider: current?.provider ?? DEFAULT_PROVIDER,
			model: current?.model ?? DEFAULT_MODEL,
			createdAt: now,
			updatedAt: now,
			_v: 1,
		});

		switchConversation(id);
		return id;
	}

	/**
	 * Switch to a different conversation.
	 *
	 * Stops any active stream, updates the active ID, and swaps the
	 * chat instance's messages to the target conversation's history.
	 */
	function switchConversation(conversationId: string) {
		chatInstance.stop();
		activeConversationId = conversationId;
		const messages = loadMessagesForConversation(conversationId);
		chatInstance.setMessages(messages);
	}

	/**
	 * Delete a conversation and all its messages.
	 *
	 * Uses a Y.Doc batch so the observer fires once (not N+1 times).
	 * If the deleted conversation was active, switches to the most
	 * recent remaining one or clears state if none remain.
	 */
	function deleteConversation(conversationId: string) {
		const messages = popupWorkspace.tables.chatMessages
			.getAllValid()
			.filter((m) => m.conversationId === conversationId);

		popupWorkspace.batch(() => {
			for (const m of messages) {
				popupWorkspace.tables.chatMessages.delete(m.id);
			}
			popupWorkspace.tables.conversations.delete(conversationId);
		});

		// Switch away if we deleted the active conversation
		if (activeConversationId === conversationId) {
			const remaining = popupWorkspace.tables.conversations
				.getAllValid()
				.sort((a, b) => b.updatedAt - a.updatedAt);

			if (remaining.length > 0) {
				switchConversation(remaining[0]!.id);
			} else {
				activeConversationId = null;
				chatInstance.clear();
			}
		}
	}

	/**
	 * Rename a conversation.
	 *
	 * Writes to Y.Doc — the observer propagates the change to the
	 * reactive `conversations` list and `activeConversation` derived.
	 */
	function renameConversation(conversationId: string, title: string) {
		const conv = conversations.find((c) => c.id === conversationId);
		if (!conv) return;

		popupWorkspace.tables.conversations.set({
			...conv,
			title,
			updatedAt: Date.now(),
		});
	}

	// ── Provider / Model (per-conversation) ───────────────────────────

	/**
	 * Update the active conversation's provider.
	 *
	 * Auto-selects the first model for the new provider so the user
	 * always has a valid model selected after switching providers.
	 */
	function setProvider(providerName: string) {
		const conv = getActiveConversation();
		if (!conv) return;

		const models = PROVIDER_MODELS[providerName as Provider];
		popupWorkspace.tables.conversations.set({
			...conv,
			provider: providerName,
			model: models?.[0] ?? conv.model,
			updatedAt: Date.now(),
		});
	}

	/** Update the active conversation's model. */
	function setModel(modelName: string) {
		const conv = getActiveConversation();
		if (!conv) return;

		popupWorkspace.tables.conversations.set({
			...conv,
			model: modelName,
			updatedAt: Date.now(),
		});
	}

	// ── Public API ────────────────────────────────────────────────────

	return {
		// ── Chat State (reactive via TanStack AI runes) ───────────────

		/** The current conversation's messages (reactive). */
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

		// ── Conversation Management ───────────────────────────────────

		/** All conversations, sorted by most recently updated first (reactive). */
		get conversations() {
			return conversations;
		},

		/** The active conversation's ID, or null if none. */
		get activeConversationId() {
			return activeConversationId;
		},

		/** The active conversation's full metadata, or null if none (reactive). */
		get activeConversation() {
			return activeConversation;
		},

		createConversation,
		switchConversation,
		deleteConversation,
		renameConversation,

		// ── Provider / Model (per-conversation) ───────────────────────

		/** Current provider name (reads from active conversation). */
		get provider() {
			return activeConversation?.provider ?? DEFAULT_PROVIDER;
		},
		set provider(value: string) {
			setProvider(value);
		},

		/** Current model name (reads from active conversation). */
		get model() {
			return activeConversation?.model ?? DEFAULT_MODEL;
		},
		set model(value: string) {
			setModel(value);
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

		// ── Chat Actions ──────────────────────────────────────────────

		/**
		 * Send a user message and begin streaming the assistant response.
		 *
		 * If no conversation is active, one is auto-created with the
		 * message text as its title (truncated to 50 characters).
		 *
		 * Writes the user message to Y.Doc before sending, and persists
		 * the assistant response via `onFinish`.
		 */
		sendMessage(content: string) {
			if (!content.trim()) return;

			// Auto-create conversation if none active
			let convId = activeConversationId;
			if (!convId) {
				convId = createConversation({
					title: content.trim().slice(0, 50),
				});
			}

			const userMessageId = generateId();

			// Write user message to Y.Doc
			popupWorkspace.tables.chatMessages.set({
				id: userMessageId,
				conversationId: convId,
				role: 'user',
				parts: [{ type: 'text', content }],
				createdAt: Date.now(),
				_v: 1,
			});

			// Touch updatedAt so this conversation floats to top
			const conv = getActiveConversation();
			if (conv) {
				popupWorkspace.tables.conversations.set({
					...conv,
					updatedAt: Date.now(),
				});
			}

			// Send via TanStack AI (triggers SSE streaming)
			void chatInstance.sendMessage({ content, id: userMessageId });
		},

		/**
		 * Regenerate the last assistant message.
		 *
		 * Deletes the old assistant message from Y.Doc, then calls
		 * `reload()` which re-requests a response from the server.
		 * The new response is persisted via `onFinish`.
		 */
		reload() {
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
	};
}

export const aiChatState = createAiChatState();
