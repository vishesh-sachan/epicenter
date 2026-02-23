/**
 * Compile-time drift detection for TanStack AI message types.
 *
 * The workspace schema stores message parts as `unknown[]` because:
 * 1. Parts are always produced by TanStack AI — never user-constructed
 * 2. Runtime validation of guaranteed-correct data wastes CPU
 * 3. Replicating 8 complex part types in arktype is fragile to upgrades
 *
 * Instead, we use compile-time assertions to catch drift when upgrading
 * TanStack AI. If the MessagePart shape changes, these assertions fail
 * and the build breaks — forcing us to update our understanding.
 *
 * @see https://tanstack.com/ai/latest — UIMessage / MessagePart types
 */

import type { UIMessage } from '@tanstack/ai-svelte';

// ── Derive the actual MessagePart type from UIMessage ─────────────────
// This is the type that gets stored in Y.Doc via onFinish/sendMessage.

type TanStackMessagePart = UIMessage['parts'][number];

// ── Compile-time drift detection ──────────────────────────────────────
// If TanStack AI adds, removes, or renames a part type, one of these
// assertions becomes `never` and the build fails.

type ExpectedPartTypes =
	| 'text'
	| 'image'
	| 'audio'
	| 'video'
	| 'document'
	| 'tool-call'
	| 'tool-result'
	| 'thinking';

type ActualPartTypes = TanStackMessagePart['type'];

/** Fails if TanStack AI adds a part type we don't know about. */
type _ActualExtendsExpected = ActualPartTypes extends ExpectedPartTypes
	? true
	: never;

/** Fails if TanStack AI removes a part type we still expect. */
type _ExpectedExtendsActual = ExpectedPartTypes extends ActualPartTypes
	? true
	: never;

// Force TypeScript to evaluate the assertions (unused types are sometimes skipped).
// If either assertion is `never`, this line errors.
const _driftCheck: [_ActualExtendsExpected, _ExpectedExtendsActual] = [
	true,
	true,
];
void _driftCheck;

// ── Typed boundary: unknown[] → MessagePart[] ─────────────────────────

/**
 * Convert a persisted chat message row to a TanStack AI UIMessage.
 *
 * This is the single boundary where `unknown[]` is cast to `MessagePart[]`.
 * Safe because parts are always produced by TanStack AI and round-tripped
 * through Y.Doc serialization (structuredClone-compatible, lossless for
 * plain objects).
 */
export function rowToUIMessage(row: {
	id: string;
	role: 'user' | 'assistant' | 'system';
	parts: unknown[];
	createdAt: number;
}): UIMessage {
	return {
		id: row.id,
		role: row.role,
		parts: row.parts as TanStackMessagePart[],
		createdAt: new Date(row.createdAt),
	};
}
