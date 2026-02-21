/**
 * Epicenter: YJS-First Collaborative Workspace System
 *
 * This root export provides the full workspace API and shared utilities.
 *
 * - `@epicenter/hq` - Full API (workspace creation, tables, KV, extensions)
 * - `@epicenter/hq/static` - Same exports (alias for migration convenience)
 * - `@epicenter/hq/extensions` - Extension plugins (persistence, sync)
 *
 * @example
 * ```typescript
 * import { createWorkspace, defineTable } from '@epicenter/hq';
 * import { type } from 'arktype';
 *
 * const posts = defineTable(type({ id: 'string', title: 'string', _v: '1' }));
 * const client = createWorkspace({ id: 'my-app', tables: { posts } });
 * ```
 *
 * @packageDocumentation
 */

// ════════════════════════════════════════════════════════════════════════════
// ACTION SYSTEM
// ════════════════════════════════════════════════════════════════════════════

export type { Action, Actions, Mutation, Query } from './shared/actions';
export {
	defineMutation,
	defineQuery,
	isAction,
	isMutation,
	isQuery,
	iterateActions,
} from './shared/actions';

// ════════════════════════════════════════════════════════════════════════════
// LIFECYCLE PROTOCOL
// ════════════════════════════════════════════════════════════════════════════

export type {
	DocumentContext,
	Extension,
	Lifecycle,
	MaybePromise,
} from './shared/lifecycle';

// ════════════════════════════════════════════════════════════════════════════
// ERROR TYPES
// ════════════════════════════════════════════════════════════════════════════

export type { ExtensionError } from './shared/errors';
export { ExtensionErr } from './shared/errors';

// ════════════════════════════════════════════════════════════════════════════
// CORE TYPES
// ════════════════════════════════════════════════════════════════════════════

export type { AbsolutePath, ProjectDir } from './shared/types';

// ════════════════════════════════════════════════════════════════════════════
// ID UTILITIES
// ════════════════════════════════════════════════════════════════════════════

export type { Guid, Id } from './shared/id';
export { generateGuid, generateId, Id as createId } from './shared/id';

// ════════════════════════════════════════════════════════════════════════════
// Y.DOC STORAGE KEYS
// ════════════════════════════════════════════════════════════════════════════

export type { KvKey, TableKey as TableKeyType } from './shared/ydoc-keys';
export { KV_KEY, TableKey } from './shared/ydoc-keys';

// ════════════════════════════════════════════════════════════════════════════
// SCHEMA DEFINITIONS (Pure)
// ════════════════════════════════════════════════════════════════════════════

export { defineKv } from './static/define-kv';
export { defineTable } from './static/define-table';
export { defineWorkspace } from './static/define-workspace';

// ════════════════════════════════════════════════════════════════════════════
// WORKSPACE CREATION
// ════════════════════════════════════════════════════════════════════════════

export type { CreateDocumentBindingConfig } from './static/create-document-binding';
export {
	createDocumentBinding,
	DOCUMENT_BINDING_ORIGIN,
} from './static/create-document-binding';
export { createWorkspace } from './static/create-workspace';

// ════════════════════════════════════════════════════════════════════════════
// LOWER-LEVEL APIs (Bring Your Own Y.Doc)
// ════════════════════════════════════════════════════════════════════════════

export { createAwareness } from './static/create-awareness';
export { createKv } from './static/create-kv';
export { createTables } from './static/create-tables';

// ════════════════════════════════════════════════════════════════════════════
// INTROSPECTION
// ════════════════════════════════════════════════════════════════════════════

export type {
	ActionDescriptor,
	AwarenessDescriptor,
	KvDescriptor,
	TableDescriptor,
	WorkspaceDescriptor,
} from './static/describe-workspace';
export { describeWorkspace } from './static/describe-workspace';

// ════════════════════════════════════════════════════════════════════════════
// VALIDATION UTILITIES
// ════════════════════════════════════════════════════════════════════════════

export { createUnionSchema } from './static/schema-union';

// ════════════════════════════════════════════════════════════════════════════
// TYPES
// ════════════════════════════════════════════════════════════════════════════

export type {
	AnyWorkspaceClient,
	AwarenessDefinitions,
	AwarenessHelper,
	AwarenessState,
	BaseRow,
	DeleteResult,
	DocBinding,
	DocsPropertyOf,
	DocumentBinding,
	DocumentHandle,
	ExtensionContext,
	ExtensionFactory,
	GetResult,
	InferAwarenessValue,
	InferKvValue,
	InferTableRow,
	InvalidRowResult,
	KvChange,
	KvDefinition,
	KvDefinitions,
	KvGetResult,
	KvHelper,
	NotFoundResult,
	NumberKeysOf,
	RowResult,
	StringKeysOf,
	TableDefinition,
	TableDefinitions,
	TableHelper,
	TablesHelper,
	UpdateResult,
	ValidRowResult,
	WorkspaceClient,
	WorkspaceClientBuilder,
	WorkspaceClientWithActions,
	WorkspaceDefinition,
} from './static/types';

// ════════════════════════════════════════════════════════════════════════════
// DRIZZLE RE-EXPORTS
// ════════════════════════════════════════════════════════════════════════════

// Commonly used Drizzle utilities for querying extensions
export {
	and,
	asc,
	desc,
	eq,
	gt,
	gte,
	inArray,
	isNotNull,
	isNull,
	like,
	lt,
	lte,
	ne,
	not,
	or,
	sql,
} from 'drizzle-orm';
