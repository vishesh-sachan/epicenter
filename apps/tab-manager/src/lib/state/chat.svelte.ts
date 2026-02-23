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
 * Background streaming: When a user switches conversations mid-stream,
 * the generation finishes silently in the background. The completed
 * response appears in Y.Doc when the user switches back. This avoids
 * lost responses and wasted API spend.
 *
 * Reactivity model:
 * - `conversations` table observer → wholesale-replace `$state` array
 * - `activeConversation` is `$derived` from active ID + conversations
 * - `chatInstance.messages` provides the reactive message list
 * - `streamingConversationId` tracks what ChatClient is streaming for
 *   (decoupled from `activeConversationId` which tracks the user's view)
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
import { createChat, fetchServerSentEvents } from '@tanstack/ai-svelte';
import { ANTHROPIC_MODELS } from '@tanstack/ai-anthropic';
import { GeminiTextModels } from '@tanstack/ai-gemini';
import { GROK_CHAT_MODELS } from '@tanstack/ai-grok';
import { OPENAI_CHAT_MODELS } from '@tanstack/ai-openai';
import { toUiMessage } from '$lib/ui-message';
import { getServerUrl } from '$lib/state/settings';
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

const DEFAULT_PROVIDER: Provider = 'openai';
const DEFAULT_MODEL = 'gpt-4o-mini';
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

	// ── Background Streaming ──────────────────────────────────────────

	/**
	 * Tracks which conversation the ChatClient is currently streaming for.
	 *
	 * Decoupled from `activeConversationId` (what the user is viewing) to
	 * allow streams to finish in the background when switching conversations.
	 * Null when idle (no active stream).
	 */
	let streamingConversationId = $state<string | null>(null);

	/**
	 * Whether the ChatClient is streaming for a conversation the user isn't viewing.
	 *
	 * Used to gate getters (messages, isLoading, error, status) so the user's
	 * current view isn't polluted by a background stream's state.
	 */
	const isBackgroundStreaming = $derived(
		streamingConversationId !== null &&
			streamingConversationId !== activeConversationId,
	);

	/**
	 * Realign ChatClient to the currently viewed conversation.
	 *
	 * Called after a background stream finishes or is stopped, so the
	 * ChatClient's internal messages match what the user is viewing.
	 */
	function realignChatClient() {
		if (activeConversationId) {
			chatInstance.setMessages(
				loadMessagesForConversation(activeConversationId),
			);
		}
	}

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
			.map(toUiMessage);

	// ── TanStack AI Chat Instance ─────────────────────────────────────

	/**
	 * Single chat instance — reused across conversation switches.
	 *
	 * - `connection`: SSE adapter. The async options callback reads from
	 *   reactive state closures, so it always sends the current
	 *   conversation's provider/model without instance recreation.
	 * - `initialMessages`: Seeded from the most recent conversation (if any).
	 * - `onFinish`: Persists the completed assistant message to Y.Doc,
	 *   using `streamingConversationId` (not `activeConversationId`) so
	 *   background-completed responses go to the right conversation.
	 */
	const chatInstance = createChat({
		initialMessages: activeConversationId
			? loadMessagesForConversation(activeConversationId)
			: [],
		connection: fetchServerSentEvents(
			() => `${serverUrlCache}/ai/chat`,
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
			const convId = streamingConversationId;
			if (!convId) return;

			const wasBackground =
				streamingConversationId !== activeConversationId;

			// Persist assistant message to the conversation that was streaming
			popupWorkspace.tables.chatMessages.set({
				id: message.id,
				conversationId: convId,
				role: 'assistant',
				parts: message.parts,
				createdAt: message.createdAt?.getTime() ?? Date.now(),
				_v: 1,
			});

			// Touch conversation's updatedAt so it floats to top of list
			const conv = conversations.find((c) => c.id === convId);
			if (conv) {
				popupWorkspace.tables.conversations.set({
					...conv,
					updatedAt: Date.now(),
				});
			}

			// Clear streaming state
			streamingConversationId = null;

			// Realign ChatClient to the currently viewed conversation.
			// Without this, ChatClient would still hold the background
			// conversation's messages after the stream finishes.
			if (wasBackground) {
				realignChatClient();
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
	 * If a stream is active, it continues in the background — only the
	 * user's view changes. If idle, stops any pending state and swaps
	 * the ChatClient's messages to the target conversation's history.
	 */
	function switchConversation(conversationId: string) {
		if (streamingConversationId !== null) {
			// Streaming — let it continue in background, just change the view.
			// The messages getter will route to loadMessagesForConversation()
			// for the new conversation, or reconnect to the live stream if
			// the user switches back to the streaming conversation.
			activeConversationId = conversationId;
		} else {
			// Idle — normal switch with ChatClient realignment
			chatInstance.stop();
			activeConversationId = conversationId;
			chatInstance.setMessages(
				loadMessagesForConversation(conversationId),
			);
		}
	}

	/**
	 * Delete a conversation and all its messages.
	 *
	 * Uses a Y.Doc batch so the observer fires once (not N+1 times).
	 * If the deleted conversation was active, switches to the most
	 * recent remaining one or clears state if none remain.
	 * If the deleted conversation is background-streaming, stops the stream.
	 */
	function deleteConversation(conversationId: string) {
		// Stop background stream if we're deleting the conversation it targets
		if (streamingConversationId === conversationId) {
			chatInstance.stop();
			streamingConversationId = null;
		}

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

		/**
		 * The current conversation's messages (reactive).
		 *
		 * Routes between two sources:
		 * - Live stream / idle: `chatInstance.messages` (ChatClient owns the data)
		 * - Background streaming: `loadMessagesForConversation()` (Y.Doc snapshot
		 *   for the viewed conversation, since ChatClient is busy with another)
		 */
		get messages() {
			if (isBackgroundStreaming) {
				return activeConversationId
					? loadMessagesForConversation(activeConversationId)
					: [];
			}
			return chatInstance.messages;
		},

		/**
		 * Whether a response is currently streaming.
		 *
		 * Returns `false` when streaming is happening in the background,
		 * since the user's current view isn't loading.
		 */
		get isLoading() {
			if (isBackgroundStreaming) return false;
			return chatInstance.isLoading;
		},

		/**
		 * The latest error from the chat connection, if any.
		 *
		 * Suppressed during background streaming — errors from a stream
		 * the user isn't viewing shouldn't interrupt their current view.
		 */
		get error() {
			if (isBackgroundStreaming) return null;
			return chatInstance.error;
		},

		/**
		 * Fine-grained connection status.
		 *
		 * More granular than `isLoading` — distinguishes between idle,
		 * streaming, and other states. Useful for nuanced UI indicators
		 * (e.g., "connecting..." vs "generating...").
		 *
		 * Returns `'ready'` during background streaming since the user's
		 * current view is idle.
		 */
		get status() {
			if (isBackgroundStreaming) return 'ready' as const;
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
		 * If a background stream is running (user switched away from a
		 * streaming conversation), it is stopped before sending. The
		 * partial response is discarded (matches current stop behavior).
		 *
		 * Writes the user message to Y.Doc before sending, and persists
		 * the assistant response via `onFinish`.
		 */
		sendMessage(content: string) {
			if (!content.trim()) return;

			// If background streaming, stop it and realign ChatClient
			// so it has the correct messages for the conversation we're
			// about to send in.
			if (isBackgroundStreaming) {
				chatInstance.stop();
				streamingConversationId = null;
				realignChatClient();
			}

			// Auto-create conversation if none active
			let convId = activeConversationId;
			if (!convId) {
				convId = createConversation({
					title: content.trim().slice(0, 50),
				});
			}

			// Track which conversation this stream belongs to
			streamingConversationId = convId;

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
		 *
		 * Blocked when ChatClient is streaming for a different conversation
		 * (background streaming) since the ChatClient can't serve two streams.
		 */
		reload() {
			// Can't reload when ChatClient is busy with another conversation
			if (isBackgroundStreaming) return;

			const lastMessage = chatInstance.messages.at(-1);
			if (lastMessage?.role === 'assistant') {
				popupWorkspace.tables.chatMessages.delete({ id: lastMessage.id });
			}

			// Track streaming for the active conversation
			if (activeConversationId) {
				streamingConversationId = activeConversationId;
			}

			void chatInstance.reload();
		},

		/**
		 * Stop the current streaming response.
		 *
		 * Works whether the stream is foreground or background. If stopping
		 * a background stream, realigns the ChatClient to the currently
		 * viewed conversation afterward.
		 */
		stop() {
			const wasBackground = isBackgroundStreaming;
			chatInstance.stop();
			streamingConversationId = null;

			if (wasBackground) {
				realignChatClient();
			}
		},
	};
}

export const aiChatState = createAiChatState();
