# AI Tools via Command Queue

**Date**: 2026-02-23
**Status**: Draft
**Author**: AI-assisted design session

---

## Overview

Add AI tool calling to the tab manager chat. Read tools query the Y.Doc on the server for cross-device tab state. Mutation tools write to a `commands` table with a discriminated union schema — the target device's background worker observes, executes the Chrome API action, and writes the result. The `action` field discriminates the union; payload fields and result types are flattened and fully typed per action (no JSON strings).

---

## Motivation

### Current State

The AI chat endpoint (`packages/server/src/ai/plugin.ts`) passes zero tools to `chat()`:

```typescript
const stream = chat({
	adapter,
	messages,
	conversationId,
	abortController,
});
```

The extension chat (`apps/tab-manager/src/lib/state/chat.svelte.ts`) sends messages to the server but has no way to act on tabs. The AI can only generate text — it can't search, close, or organize tabs.

### Problems

1. **No tab awareness**: The AI can't see what tabs are open. It can only respond to what the user types.
2. **No tab actions**: "Close my YouTube tabs" requires 15 manual clicks. The AI could do it in one sentence.
3. **No cross-device reach**: The background worker has `browser.tabs.*` APIs, but only for its own device. The Y.Doc already syncs all devices' tabs to the server — read tools get a global view for free.

### Desired State

User types "close my YouTube tabs on my work laptop" → AI calls `searchTabs` (server reads Y.Doc) → finds 5 YouTube tabs on device "abc" → calls `closeTabs` (server writes command row targeting device "abc") → background worker on work laptop observes, executes `browser.tabs.remove()`, writes result → AI reports "Closed 5 YouTube tabs on your MacBook."

---

## Research Findings

### Arktype Discriminated Unions

Arktype supports discriminated unions natively via `.or()` chaining, with automatic discrimination on literal-typed keys.

Three patterns for combining base fields with variants:

| Pattern                      | Syntax                                                                              | Tradeoff                                                                       |
| ---------------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| **`type.or()` + `.merge()`** | `type.or(base.merge({action: "'foo'", ...}), base.merge({action: "'bar'", ...}))`   | Cleanest for 5+ variants — flat list, no nesting, base is a real `Type`        |
| **`.merge().or()` chaining** | `base.merge({action: "'foo'", ...}).or(base.merge({action: "'bar'", ...}))`         | Good for 2-4 variants — base is a real `Type`, merge is first-class            |
| **`"..."` spread key**       | `type({"...": base, action: "'foo'", ...}).or({"...": base, action: "'bar'", ...})` | Also clean, inline syntax                                                      |
| **JS object spread**         | `type({...baseObj, action: "'foo'", ...}).or({...baseObj, action: "'bar'", ...})`   | Works but base is a plain object, not a Type — loses arktype-level composition |

**Recommendation**: `type.or()` + `.merge()` — for 5+ variants (like our 8 command actions), the static `type.or()` form avoids deeply nested `.or()` chaining and reads as a flat list of variants. Each variant still uses `.merge()` to combine the base type with variant-specific fields.

**Important**: `.merge()` only accepts object types, not unions. You cannot do `commandBase.merge(variantA.or(variantB))` — you must merge each variant individually, then union the results.

```typescript
const commandBase = type({
	id: 'string',
	deviceId: DeviceId,
	createdAt: 'number',
	_v: '1' as const,
});

// Static type.or() — preferred for 5+ variants
const Command = type.or(
	commandBase.merge({
		action: "'closeTabs'",
		tabIds: 'string[]',
		'result?': type({ closedCount: 'number' }).or('undefined'),
	}),
	commandBase.merge({
		action: "'openTab'",
		url: 'string',
		'result?': type({ tabId: 'string' }).or('undefined'),
	}),
);
// arktype auto-discriminates on `action`
```

### TanStack AI Tool Pattern

TanStack AI uses `toolDefinition()` to define tool contracts with Zod schemas, then `.server()` / `.client()` to attach implementations.

For this feature, all tools use `.server()` implementations:

- **Read tools**: Query the Y.Doc tables directly on the server
- **Mutation tools**: Write to the `commands` table and await the result via Y.Doc observation

The server already has the Y.Doc via the sync plugin's `dynamicDocs` map. The AI plugin needs access to this map (or the specific tab-manager Y.Doc) to create table helpers for read tools and command writing.

### Server Y.Doc Access

The hub server creates ephemeral Y.Docs in `dynamicDocs`:

```typescript
// hub.ts — current
const dynamicDocs = new Map<string, Y.Doc>();
// ...
getDoc: (room) => {
  if (!dynamicDocs.has(room)) dynamicDocs.set(room, new Y.Doc());
  return dynamicDocs.get(room);
},
```

The AI plugin needs the tab-manager Y.Doc to:

1. Read tables (tabs, windows, devices, tabGroups) for read tools
2. Write to the `commands` table for mutation tools
3. Observe the `commands` table for results

This means `createAIPlugin()` needs the `dynamicDocs` map (or a `getDoc` callback) passed in from the hub.

---

## Design Decisions

| Decision                 | Choice                                                      | Rationale                                                                                                                   |
| ------------------------ | ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Tool execution location  | Server-side `.server()` for all tools                       | Read tools query Y.Doc directly; mutation tools write commands. No client tools needed — avoids sidepanel↔background relay. |
| Mutation mechanism       | `commands` table in Y.Doc                                   | Persists across brief disconnects (within TTL). Cross-device by design. Background worker already observes Y.Doc tables.    |
| Command schema           | Discriminated union on `action` key                         | Type-safe dispatch, no JSON.parse, payload/result typed per action. Arktype auto-discriminates.                             |
| Union pattern            | `type.or()` + `.merge()`                                    | Static `type.or()` for flat readability with 8 variants. `.merge()` per variant to compose base fields.                     |
| TTL strategy             | Constant `COMMAND_TTL_MS = 30_000` derived from `createdAt` | All commands have the same urgency. No per-command expiry field needed (YAGNI).                                             |
| Status tracking          | Implicit from `result?` field                               | No result = pending, has result = done, expired = `createdAt + TTL < now && no result`. Fewer fields.                       |
| Pin/mute commands        | Bidirectional (`pinned: boolean`, `muted: boolean`)         | One command instead of two (pinTabs/unpinTabs → pinTabs with `pinned` flag). Fewer union variants.                          |
| Server-side Y.Doc access | Pass `getDoc` callback to `createAIPlugin()`                | Hub already has `dynamicDocs`. Plugin gets the tab-manager doc on demand.                                                   |
| Tool schema library      | Zod (required by TanStack AI `toolDefinition`)              | `toolDefinition()` requires Zod schemas for `inputSchema`/`outputSchema`. Arktype is used for the Y.Doc table schema.       |

---

## Architecture

### System Overview

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  Extension Side Panel (Svelte UI)                                            │
│  ┌─────────────────────────────────────────┐                                 │
│  │ chat.svelte.ts                          │                                 │
│  │ createChat({ connection: SSE })         │                                 │
│  │ No client tools — server handles all    │                                 │
│  └──────────────┬──────────────────────────┘                                 │
│                 │ POST /ai/chat                                              │
└─────────────────┼────────────────────────────────────────────────────────────┘
                  │
                  ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│  Hub Server (Elysia, localhost:3913)                                         │
│                                                                              │
│  /ai/chat endpoint                                                           │
│    │                                                                         │
│    ▼                                                                         │
│  chat({                                                                      │
│    adapter,                                                                  │
│    messages,                                                                 │
│    tools: [                                                                  │
│      ── Read Tools (instant, cross-device) ──                                │
│      searchTabs    → query tabs table in Y.Doc                               │
│      listTabs      → query tabs table in Y.Doc                               │
│      listWindows   → query windows table in Y.Doc                            │
│      listDevices   → awareness + devices table                               │
│      countByDomain → aggregate from tabs table                               │
│                                                                              │
│      ── Mutation Tools (command queue) ──                                     │
│      closeTabs     → write command → await result                            │
│      openTab       → write command → await result                            │
│      activateTab   → write command → await result                            │
│      saveTabs      → write command → await result                            │
│      groupTabs     → write command → await result                            │
│      pinTabs       → write command → await result                            │
│      muteTabs      → write command → await result                            │
│      reloadTabs    → write command → await result                            │
│    ],                                                                        │
│  })                                                                          │
│    │                 │                                                        │
│    │ SSE stream      │ Y.Doc sync                                            │
│    ▼                 ▼                                                        │
└──────────────────────┬───────────────────────────────────────────────────────┘
                       │
                       ▼ commands table syncs via Y.Doc
┌──────────────────────────────────────────────────────────────────────────────┐
│  Extension Background Worker (target device)                                 │
│                                                                              │
│  client.tables.commands.observe((changedIds) => {                            │
│    for each command where:                                                   │
│      deviceId === myDeviceId                                                 │
│      && !result                                                              │
│      && createdAt + COMMAND_TTL_MS > Date.now()                              │
│    → dispatch(command)                                                       │
│    → write result                                                            │
│  })                                                                          │
└──────────────────────────────────────────────────────────────────────────────┘
```

### Command Lifecycle

```
1. AI tool execute()
   │
   ▼
2. Server writes command to Y.Doc:
   commands.set({ id, deviceId, action: 'closeTabs', tabIds, createdAt })
   │
   ▼
3. Y.Doc syncs to all devices
   │
   ▼
4. Target device's background worker observes new row
   Checks: deviceId === mine? No result? Within TTL?
   │
   ▼
5. Executes: browser.tabs.remove(nativeTabIds)
   │
   ▼
6. Writes result: commands.set({ ...cmd, result: { closedCount: 5 } })
   │
   ▼
7. Server observes result appearing (Promise-based Y.Doc observer)
   Deletes command row → returns result to AI
   │
   ▼
8. AI generates response: "Closed 5 YouTube tabs on your MacBook."
```

### Server-Side Command Awaiting

The server blocks (async) inside a tool's `.server()` execute function until the target device writes the result or TTL expires:

```typescript
function waitForCommandResult(
	commandsTable: TableHelper,
	commandId: string,
	ttlMs: number,
	abortSignal?: AbortSignal,
): Promise<unknown> {
	return new Promise((resolve, reject) => {
		let unobserve: (() => void) | undefined;

		const cleanup = () => {
			clearTimeout(timeout);
			unobserve?.();
		};

		const timeout = setTimeout(() => {
			cleanup();
			reject(new Error('Command timed out — device may be offline'));
		}, ttlMs);

		// Abort when client disconnects
		abortSignal?.addEventListener(
			'abort',
			() => {
				cleanup();
				commandsTable.delete(commandId);
				reject(new DOMException('Client disconnected', 'AbortError'));
			},
			{ once: true },
		);

		unobserve = commandsTable.observe((changedIds) => {
			if (!changedIds.has(commandId)) return;
			const result = commandsTable.get(commandId);
			if (result.status !== 'valid') return;
			if (!result.row.result) return;

			cleanup();
			resolve(result.row.result);
		});
	});
}
```

---

## Commands Table Schema

### Discriminated Union with `type.or()` + `.merge()`

The `commands` table uses arktype's static `type.or()` with per-variant `.merge()` to create a discriminated union on the `action` key. Base fields are shared; payload fields and result types are flattened and typed per action.

Note: `.merge()` only accepts object types — you cannot pass a union into `.merge()`. Each variant must be merged individually, then combined via `type.or()`.

```typescript
import { type } from 'arktype';

// ─── Shared base fields ──────────────────────────────────────────────
const commandBase = type({
  id: 'string',
  deviceId: DeviceId,
  createdAt: 'number',
  _v: '1' as const,
});

// ─── Tab group color (reusable) ──────────────────────────────────────
const tabGroupColor = "'grey' | 'blue' | 'red' | 'yellow' | 'green' | 'pink' | 'purple' | 'cyan' | 'orange'";

// ─── Commands table: discriminated union on `action` ─────────────────
commands: defineTable(
  type.or(
    commandBase.merge({
      action: "'closeTabs'",
      tabIds: 'string[]',
      'result?': type({ closedCount: 'number' }).or('undefined'),
    }),
    commandBase.merge({
      action: "'openTab'",
      url: 'string',
      'windowId?': 'string',
      'result?': type({ tabId: 'string' }).or('undefined'),
    }),
    commandBase.merge({
      action: "'activateTab'",
      tabId: 'string',
      'result?': type({ activated: 'boolean' }).or('undefined'),
    }),
    commandBase.merge({
      action: "'saveTabs'",
      tabIds: 'string[]',
      close: 'boolean',
      'result?': type({ savedCount: 'number' }).or('undefined'),
    }),
    commandBase.merge({
      action: "'groupTabs'",
      tabIds: 'string[]',
      'title?': 'string',
      'color?': tabGroupColor,
      'result?': type({ groupId: 'string' }).or('undefined'),
    }),
    commandBase.merge({
      action: "'pinTabs'",
      tabIds: 'string[]',
      pinned: 'boolean',
      'result?': type({ pinnedCount: 'number' }).or('undefined'),
    }),
    commandBase.merge({
      action: "'muteTabs'",
      tabIds: 'string[]',
      muted: 'boolean',
      'result?': type({ mutedCount: 'number' }).or('undefined'),
    }),
    commandBase.merge({
      action: "'reloadTabs'",
      tabIds: 'string[]',
      'result?': type({ reloadedCount: 'number' }).or('undefined'),
    }),
  ),
),
```

### Type Exports

```typescript
export type Command = InferTableRow<Tables['commands']>;
// Command is a discriminated union — switch on `action` to narrow
```

### Why This Design

| Property                      | Benefit                                                                |
| ----------------------------- | ---------------------------------------------------------------------- |
| Flattened payload             | No `JSON.parse(cmd.payload)`. Fields are native Y.Map key-value pairs. |
| Typed result per action       | `closeTabs` result is `{ closedCount: number }`, not `string`.         |
| `action` discriminant         | `switch (cmd.action)` narrows the full type in TypeScript.             |
| `type.or()` + `.merge()`      | Flat list of 8 variants. No deeply nested `.or()` chains.              |
| Base is a real arktype `Type` | Reusable, composable, inspectable at runtime.                          |
| `result?` presence = status   | No separate `status` field. Pending = no result. Done = has result.    |
| `_v: '1'`                     | Ready for schema evolution if command shapes need to change.           |

---

## Tool Definitions

All tools use `toolDefinition()` from `@tanstack/ai` with Zod schemas (required by TanStack AI), then `.server()` implementations.

### Read Tools (5)

These query the tab-manager Y.Doc tables directly on the server. Instant, cross-device global view.

| Tool            | inputSchema                                | What it does                                                         |
| --------------- | ------------------------------------------ | -------------------------------------------------------------------- |
| `searchTabs`    | `{ query: string, deviceId?: string }`     | Filter tabs by URL/title match, optionally scoped to one device      |
| `listTabs`      | `{ deviceId?: string, windowId?: string }` | List all tabs, optionally filtered by device or window               |
| `listWindows`   | `{ deviceId?: string }`                    | List all windows with tab counts, optionally filtered by device      |
| `listDevices`   | `{}`                                       | Merge awareness (online status) with devices table (names, browsers) |
| `countByDomain` | `{ deviceId?: string }`                    | Aggregate tab counts by domain across devices                        |

### Mutation Tools (8)

These write to the `commands` table and await the result.

| Tool          | inputSchema                                            | Command action |
| ------------- | ------------------------------------------------------ | -------------- |
| `closeTabs`   | `{ tabIds: string[] }`                                 | `closeTabs`    |
| `openTab`     | `{ url: string, deviceId: string, windowId?: string }` | `openTab`      |
| `activateTab` | `{ tabId: string }`                                    | `activateTab`  |
| `saveTabs`    | `{ tabIds: string[], close?: boolean }`                | `saveTabs`     |
| `groupTabs`   | `{ tabIds: string[], title?: string, color?: string }` | `groupTabs`    |
| `pinTabs`     | `{ tabIds: string[], pinned: boolean }`                | `pinTabs`      |
| `muteTabs`    | `{ tabIds: string[], muted: boolean }`                 | `muteTabs`     |
| `reloadTabs`  | `{ tabIds: string[] }`                                 | `reloadTabs`   |

### deviceId Resolution

Mutation tools need a `deviceId` to target. The tool schemas accept tab composite IDs (e.g. `"abc_42"`) which embed the deviceId. The server extracts `deviceId` from the first tab ID's prefix — all tabs in a single command must belong to the same device.

For `openTab`, `deviceId` is explicit because there's no existing tab to derive it from.

The AI should call `listDevices` first when it needs to know which devices are available, then `searchTabs` or `listTabs` to find specific tab IDs.

---

## File Structure

```
packages/server/src/ai/
├── plugin.ts              ← Modified: accept getDoc, pass tools to chat()
├── adapters.ts            ← Unchanged
├── tools/
│   ├── definitions.ts     ← toolDefinition() contracts (Zod schemas)
│   ├── read-tools.ts      ← .server() implementations for read tools
│   ├── mutation-tools.ts  ← .server() implementations for mutation tools
│   └── wait-for-result.ts ← waitForCommandResult() helper

apps/tab-manager/src/lib/
├── workspace.ts           ← Modified: add commands table (discriminated union)
├── commands/
│   ├── constants.ts       ← COMMAND_TTL_MS = 30_000
│   ├── consumer.ts        ← Background worker command observer + dispatcher
│   └── actions.ts         ← Per-action Chrome API execution functions
```

---

## Implementation Plan

### Phase 1: Commands Table Schema

- [ ] **1.1** Add `commandBase` type and discriminated union `commands` table to `apps/tab-manager/src/lib/workspace.ts` using `type.or()` + `.merge()` pattern
- [ ] **1.2** Export `Command` type and `COMMAND_TTL_MS` constant
- [ ] **1.3** Verify the union type works with `defineTable` — `table.set()`, `table.get()`, `table.getAllValid()` should all handle the discriminated union correctly

### Phase 2: Background Worker Command Consumer

- [ ] **2.1** Create `apps/tab-manager/src/lib/commands/constants.ts` — export `COMMAND_TTL_MS`
- [ ] **2.2** Create `apps/tab-manager/src/lib/commands/actions.ts` — per-action Chrome API execution functions (`closeTabs`, `openTab`, `activateTab`, etc.)
- [ ] **2.3** Create `apps/tab-manager/src/lib/commands/consumer.ts` — `commands.observe()` handler that dispatches to actions
- [ ] **2.4** Wire consumer into `apps/tab-manager/src/entrypoints/background.ts` — add observer after `whenReady`
- [ ] **2.5** Add TTL cleanup — delete stale rows (past TTL, no result) on any device

### Phase 3: Server-Side Read Tools

- [ ] **3.1** Modify `createAIPlugin()` to accept a `getDoc` callback for Y.Doc access
- [ ] **3.2** Modify `hub.ts` to pass `dynamicDocs` access to the AI plugin
- [ ] **3.3** Create `packages/server/src/ai/tools/definitions.ts` — Zod-based `toolDefinition()` contracts for all 13 tools
- [ ] **3.4** Create `packages/server/src/ai/tools/read-tools.ts` — `.server()` implementations that query Y.Doc tables
- [ ] **3.5** Create table helpers from the tab-manager workspace definition for server-side Y.Doc access (import `definition` from `@epicenter/tab-manager/workspace`)

### Phase 4: Server-Side Mutation Tools

- [ ] **4.1** Create `packages/server/src/ai/tools/wait-for-result.ts` — Promise-based Y.Doc observation with TTL timeout and abort signal cleanup
- [ ] **4.2** Create `packages/server/src/ai/tools/mutation-tools.ts` — `.server()` implementations that write commands and await results
- [ ] **4.3** Wire all tools into `chat()` call in `plugin.ts`
- [ ] **4.4** Add system prompt with tool descriptions and behavior guidelines

### Phase 5: Integration & Testing

- [ ] **5.1** End-to-end test: send chat message → AI calls searchTabs → returns tab data
- [ ] **5.2** End-to-end test: send "close tabs" → AI calls closeTabs → command written → background executes → result returned
- [ ] **5.3** Test TTL expiry — command written, device offline, timeout fires
- [ ] **5.4** Test abort — client disconnects, pending command cleaned up

---

## Edge Cases

### Command Expires (Target Device Offline)

1. AI calls `closeTabs` targeting device "abc" (shown online via awareness)
2. Server writes command row with `createdAt: Date.now()`
3. Device "abc" goes offline immediately after
4. After 30s, `waitForCommandResult` rejects with timeout error
5. AI responds: "Your work laptop didn't respond. It might be offline."
6. Next cleanup cycle on any device deletes the stale row

### Stale Commands on Device Wake

1. Laptop wakes from sleep, reconnects to Y.Doc
2. Y.Doc syncs — laptop sees 3 command rows targeting it
3. Background worker checks `createdAt + COMMAND_TTL_MS > Date.now()` on each
4. 2 expired → delete them. 1 still valid → execute it.
5. No surprise tab closures from old commands

### Client Disconnects Mid-Tool-Execution

1. User closes the side panel while AI is waiting for a command result
2. `request.signal` fires abort
3. `waitForCommandResult` cleans up: clears timeout, removes observer, deletes the pending command row
4. No orphaned commands

### Multiple Devices — Which One?

1. AI calls `closeTabs` with tab IDs like `["abc_42", "abc_55"]`
2. Server extracts deviceId from the tab ID prefix: `"abc"`
3. Command targets device `"abc"` specifically
4. If the user says "close all YouTube tabs" without specifying a device, the AI should call `listDevices` first, then ask which device (or target all)

### Composite ID Parsing

Tab IDs in the commands table use the composite format `${deviceId}_${tabId}`. The background worker needs to extract the native `tabId` (number) to call `browser.tabs.remove()`. Use the existing `parseTabId()`, `parseWindowId()` from `workspace.ts`.

---

## Open Questions

1. **Should `openTab` be able to target a specific position (index)?**
   - Current design only specifies `url` and optional `windowId`
   - **Recommendation**: Start without index. Add later if users ask "open this tab next to my current tab."

2. **Should the system prompt be hardcoded or configurable per conversation?**
   - The `conversations` table already has a `systemPrompt?` field
   - **Recommendation**: Use a base system prompt (tool descriptions, behavior guidelines) merged with the conversation-level `systemPrompt` if present.

3. **How to handle `agentLoopStrategy`?**
   - TanStack AI supports `maxIterations(N)` to prevent runaway tool loops
   - **Recommendation**: `maxIterations(10)` — generous enough for search → filter → act flows, low enough to prevent cost runaway.

4. **Should read tools return raw composite IDs or parsed human-readable output?**
   - Raw: `{ id: "abc_42", deviceId: "abc", tabId: 42, title: "YouTube", ... }`
   - Human: `{ id: "abc_42", device: "Chrome on MacBook", title: "YouTube", ... }`
   - **Recommendation**: Raw with device name included. The AI can present it however it wants.

5. **Zod dependency for tool definitions**
   - TanStack AI `toolDefinition()` requires Zod schemas, but the workspace uses arktype
   - The two don't conflict — Zod is for tool input/output schemas (AI layer), arktype is for Y.Doc table schemas (data layer)
   - **Recommendation**: Accept the dual-schema reality. They serve different purposes at different boundaries.

---

## Success Criteria

- [ ] `commands` table defined with discriminated union on `action`, validates correctly via arktype
- [ ] Background worker observes commands, dispatches by action, executes Chrome APIs, writes results
- [ ] Expired commands (past TTL) are ignored and cleaned up
- [ ] Server read tools query Y.Doc and return tab/window/device data
- [ ] Server mutation tools write commands, await results, return to AI
- [ ] AI can successfully answer "what tabs do I have open?" (read tool)
- [ ] AI can successfully close tabs when asked (mutation tool → command → execute → result)
- [ ] Client disconnect during tool execution cleans up gracefully (no orphaned commands)
- [ ] `switch (cmd.action)` in TypeScript narrows the type correctly (type-safe dispatch)

---

## References

- `apps/tab-manager/src/lib/workspace.ts` — Current workspace definition (add commands table here)
- `apps/tab-manager/src/entrypoints/background.ts` — Background worker (add command consumer here)
- `packages/server/src/ai/plugin.ts` — AI chat endpoint (add tools here)
- `packages/server/src/hub.ts` — Hub server (pass Y.Doc access to AI plugin)
- `docs/articles/tanstack-ai-isomorphic-tool-pattern.md` — Tool definition pattern reference
- `specs/20260214T174800-tanstack-ai-tab-manager-integration.md` (worktree) — Prior spec with command queue design, system prompt, streaming architecture
