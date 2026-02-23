# Multi-Conversation AI Chat Redesign

**Date**: 2026-02-23
**Status**: Draft
**Author**: AI-assisted

## Overview

Redesign `ai-chat-state.svelte.ts` from a single-conversation singleton into a multi-conversation manager. One `createChat()` instance, message swapping via `setMessages()` on conversation switch, per-conversation provider/model settings persisted in the `conversations` table.

## Motivation

### Current State

```typescript
// ai-chat-state.svelte.ts — today
function createAiChatState() {
  let provider = $state('openai');
  let model = $state('gpt-4o-mini');
  const conversationId = 'default'; // hardcoded

  const chatInstance = createChat({
    initialMessages: loadPersistedMessages(),
    connection: fetchServerSentEvents(...),
    onFinish: (message) => { /* persist to chatMessages table */ },
  });

  return { messages, sendMessage, reload, stop, clear, provider, model };
}

export const aiChatState = createAiChatState(); // singleton
```

Problems:

1. **Single conversation only**: Hardcoded `conversationId = 'default'` — no way to have multiple threads
2. **Provider/model are ephemeral**: Stored in `$state`, lost on reload — not tied to the conversation
3. **No conversation lifecycle**: No create/delete/switch/rename — everything goes to one thread
4. **conversations table exists but is unused**: We added it in the data model phase but nothing writes to it

### Desired State

```typescript
// Usage from components:
aiChatState.createConversation({ title: 'Debug auth flow' });
aiChatState.switchConversation(someId);
aiChatState.conversations; // reactive sorted list
aiChatState.activeConversation; // current conversation metadata
aiChatState.provider; // reads from active conversation
aiChatState.model; // reads from active conversation
aiChatState.sendMessage('hello'); // writes to active conversation
```

## Design Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Chat instances | Single `createChat()`, swap via `setMessages()` | TanStack AI ChatClient is per-conversation; recreating is wasteful. `setMessagesManually()` replaces state cleanly. |
| Provider/model storage | Per-conversation in `conversations` table | Different threads may use different models. Survives reload. |
| Conversation creation | Explicit "New Chat" + auto-create on first message if none exist | No empty conversations. User types → conversation created lazily. |
| Active conversation on empty | `null` — show welcome state | Don't auto-create. Let user start typing or pick from history. |
| Conversation list reactivity | Y.Doc observer on `conversations` table | Same pattern as `savedTabState`. |
| Message loading on switch | Synchronous read from Y.Doc | Messages already in-memory. Filter + sort + map. |
| Streaming on switch | Stop active stream | Background streaming is future work. |
| Auto-title | First user message text, truncated to 50 chars | Simple, immediate, no AI call. |
| Conversation deletion | Batch in Y.Doc transaction | Same pattern as `savedTabState.restoreAll()`. |
| New conversation defaults | Copy provider/model from last active | Follows user's current preference. |

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                  aiChatState                         │
│                                                     │
│  conversations[] ←── Y.Doc observer                 │
│  activeConversationId                               │
│  activeConversation (derived)                       │
│                                                     │
│  chatInstance = createChat() ── single instance     │
│    └── setMessages() on conversation switch         │
│                                                     │
│  provider/model ←── activeConversation fields       │
│                                                     │
│  Writes ──→ conversations table (metadata)          │
│         ──→ chatMessages table (message parts)      │
└─────────────────────────────────────────────────────┘
```

### Conversation Switch Flow

```
switchConversation(newId)
  1. chatInstance.stop()           — halt any active stream
  2. activeConversationId = newId  — update reactive state
  3. load messages from Y.Doc     — filter chatMessages by newId
  4. chatInstance.setMessages()    — swap TanStack AI state
```

### Send Message Flow

```
sendMessage(content)
  1. if no active conversation → create one (auto-title from content)
  2. write user message to chatMessages table
  3. chatInstance.sendMessage({ content, id })
  4. onFinish → write assistant message + update conversation.updatedAt
```

## Implementation Plan

### Phase 1: State Layer Refactor

- [ ] **1.1** Verify `setMessages` API on `createChat()` return type
- [ ] **1.2** Add conversation list state with Y.Doc observer
- [ ] **1.3** Add `activeConversationId` + `activeConversation` derived
- [ ] **1.4** Move provider/model from local `$state` to active conversation read/write
- [ ] **1.5** Implement `switchConversation()` — stop, set ID, load messages, setMessages
- [ ] **1.6** Implement `createConversation()` — write to table, switch to it
- [ ] **1.7** Implement `deleteConversation()` — batch delete messages + convo, switch away
- [ ] **1.8** Implement `renameConversation()` — update title
- [ ] **1.9** Update `sendMessage()` — auto-create if none active, auto-title
- [ ] **1.10** Update `onFinish` — correct conversation, update `updatedAt`
- [ ] **1.11** Update `reload()` — delete from correct conversation
- [ ] **1.12** Initialization — load most recent conversation on startup

### Phase 2: UI Changes

- [ ] **2.1** Conversation selector in `AiChat.svelte` header (collapsible list)
- [ ] **2.2** "New Chat" button
- [ ] **2.3** Conversation rename
- [ ] **2.4** Conversation delete with confirmation
- [ ] **2.5** Empty state when no conversations exist
- [ ] **2.6** ModelCombobox reads from per-conversation state (already does via aiChatState)

### Phase 3: Server Integration

- [ ] **3.1** Pass `conversationId` and `systemPrompt` in SSE body (server already accepts them)

## Edge Cases

### Mid-Stream Conversation Switch
User switches while streaming → `stop()` halts stream → partial message NOT persisted (onFinish never fired) → switching back shows messages up to last complete response. Acceptable tradeoff.

### Delete Active Conversation
Batch delete messages + row → switch to most recent remaining → or `null` if none → show welcome state.

### First Message Auto-Creation
No conversations exist → user types → `sendMessage()` auto-creates conversation titled from message text → message goes to new conversation.

### Cross-Device Sync
Device A creates conversation → Device B's observer fires → appears in list → B can open and see messages → if both chat, messages interleave via Y.Doc.

## Open Questions

1. **`setMessages` vs `setMessagesManually` — exact method name?**
   - Must verify against actual `createChat()` return type before implementing.

2. **Conversation list UI: dropdown vs collapsible header?**
   - Extension sidepanel is narrow. Full sidebar eats too much space.
   - **Recommendation**: Collapsible list above messages. Shows on click, hides on selection.

3. **Should "New Chat" button always be visible or only in the conversation list?**
   - **Recommendation**: Always visible in the header, next to conversation selector.

## Success Criteria

- [ ] Multiple conversations: create, switch, persist, survive reload
- [ ] Provider/model per-conversation, persisted
- [ ] Switching mid-stream doesn't crash
- [ ] Deleting a conversation cleans up messages
- [ ] TypeScript compiles clean
- [ ] Existing UI patterns preserved (provider select, model combobox, send/stop/regenerate)

## References

- `apps/tab-manager/src/lib/state/ai-chat-state.svelte.ts` — being redesigned
- `apps/tab-manager/src/lib/state/saved-tab-state.svelte.ts` — pattern to follow
- `apps/tab-manager/src/lib/workspace.ts` — table definitions
- `apps/tab-manager/src/lib/ai-message-types.ts` — `toUiMessage` boundary
- `apps/tab-manager/src/lib/components/AiChat.svelte` — UI consuming state
- `apps/tab-manager/src/lib/components/ModelCombobox.svelte` — model selector
- `packages/server/src/ai/plugin.ts` — server already accepts conversationId, systemPrompt

## Review

### Changes Made

**`apps/tab-manager/src/lib/state/ai-chat-state.svelte.ts`** — Full rewrite from single-conversation singleton to multi-conversation manager:
- Conversation list via Y.Doc observer (same `savedTabState` pattern)
- `activeConversationId` + `activeConversation` ($derived) reactive state
- Provider/model now read/write from active conversation in Y.Doc (persistent, per-conversation)
- `createConversation()` — writes to conversations table, inherits provider/model, switches to new conversation
- `switchConversation()` — stops stream, swaps messages via `chatInstance.setMessages()`
- `deleteConversation()` — batch deletes messages + conversation in Y.Doc transaction, auto-switches
- `renameConversation()` — updates title in Y.Doc
- `sendMessage()` — auto-creates conversation if none active (title from first 50 chars of message)
- `onFinish` — persists assistant message + touches conversation `updatedAt`
- `fetchServerSentEvents` body callback now sends `conversationId` + `systemPrompt` to server

**`apps/tab-manager/src/lib/components/AiChat.svelte`** — Added conversation bar:
- Thin header bar with dropdown conversation selector + "New Chat" button
- Dropdown shows all conversations (most recent first), active one is bold
- Each dropdown item has a delete button (trash icon, visible on hover)
- Empty state text adapts: "start chatting" vs "continue the conversation"
- All existing UI preserved (provider/model selects, input, send/stop/regenerate)

### API Surface

Backward-compatible. Everything `AiChat.svelte` and `ModelCombobox.svelte` already used still works (`messages`, `isLoading`, `error`, `status`, `provider`, `model`, `sendMessage`, `reload`, `stop`, `availableProviders`, `modelsForProvider`). New additions:
- `conversations`, `activeConversationId`, `activeConversation`
- `createConversation()`, `switchConversation()`, `deleteConversation()`, `renameConversation()`

### Removed
- `clear()` — was not used by any UI component. Natural replacements: `deleteConversation()` or `createConversation()`.
- `conversationId` getter — replaced by `activeConversationId`.

### Verification
- All 6 relevant files pass `lsp_diagnostics` with zero errors
- `svelte-check` shows zero errors in our files (73 pre-existing errors all in `packages/ui` import aliases)
