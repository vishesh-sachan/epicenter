/**
 * createDocumentBinding() — runtime factory for bidirectional document bindings.
 *
 * Creates a binding between a table and its associated content Y.Docs.
 * The binding:
 * 1. Manages Y.Doc creation and provider lifecycle for each content doc
 * 2. Watches content docs → automatically bumps `updatedAt` on the row
 * 3. Watches the table → automatically cleans up documents when rows are deleted
 *
 * Most users never call this directly — `createWorkspace()` wires it automatically
 * when tables have `.withDocument()` declarations. Advanced users can use it standalone.
 *
 * @example
 * ```typescript
 * import { createDocumentBinding, createTables, defineTable } from '@epicenter/hq/static';
 * import * as Y from 'yjs';
 * import { type } from 'arktype';
 *
 * const filesTable = defineTable(
 *   type({ id: 'string', name: 'string', updatedAt: 'number', _v: '1' }),
 * ).withDocument('content', { guid: 'id', updatedAt: 'updatedAt' });
 *
 * const ydoc = new Y.Doc({ guid: 'my-workspace' });
 * const tables = createTables(ydoc, { files: filesTable });
 *
 * const contentBinding = createDocumentBinding({
 *   guidKey: 'id',
 *   updatedAtKey: 'updatedAt',
 *   tableHelper: tables.files,
 *   ydoc,
 * });
 *
 * const handle = await contentBinding.open(someRow);
 * const text = handle.read();
 * handle.write('new content');
 * ```
 *
 * @module
 */

import * as Y from 'yjs';
import type { MaybePromise } from '../shared/lifecycle.js';
import type {
	BaseRow,
	DocumentBinding,
	DocumentExtensionRegistration,
	DocumentHandle,
	TableHelper,
} from './types.js';

/**
 * Sentinel symbol used as the Y.js transaction origin when the document binding
 * bumps `updatedAt` on a row. Consumers can check `transaction.origin === DOCUMENT_BINDING_ORIGIN`
 * to distinguish auto-bumps from user-initiated row changes.
 *
 * @example
 * ```typescript
 * import { DOCUMENT_BINDING_ORIGIN } from '@epicenter/hq/static';
 *
 * client.tables.files.observe((changedIds, transaction) => {
 *   if (transaction.origin === DOCUMENT_BINDING_ORIGIN) {
 *     // This was an auto-bump from a content doc edit
 *     return;
 *   }
 *   // This was a direct row change
 * });
 * ```
 */
export const DOCUMENT_BINDING_ORIGIN = Symbol('document-binding');

/**
 * Normalized lifecycle hooks from a single document extension result.
 */
type NormalizedLifecycle = {
	whenReady?: Promise<unknown>;
	destroy?: () => MaybePromise<void>;
};

/**
 * Internal entry for an open document.
 * Tracks the Y.Doc, normalized lifecycle hooks, accumulated exports,
 * the updatedAt observer teardown, and the composite whenReady promise.
 */
type DocEntry = {
	ydoc: Y.Doc;
	lifecycles: NormalizedLifecycle[];
	exports: Record<string, Record<string, unknown>>;
	unobserve: () => void;
	whenReady: Promise<DocumentHandle>;
};

/**
 * Create a lightweight handle wrapping an open Y.Doc and its extension exports.
 *
 * Handles are cheap (4 properties). The Y.Doc underneath is the expensive
 * shared resource. Calling `open()` twice returns fresh handles backed
 * by the same cached Y.Doc.
 */
function makeHandle(
	ydoc: Y.Doc,
	exports: Record<string, Record<string, unknown>>,
): DocumentHandle {
	return {
		ydoc,
		exports,
		read() {
			return ydoc.getText('content').toString();
		},
		write(text: string) {
			const ytext = ydoc.getText('content');
			ydoc.transact(() => {
				ytext.delete(0, ytext.length);
				ytext.insert(0, text);
			});
		},
	};
}

/**
 * Configuration for `createDocumentBinding()`.
 *
 * @typeParam TRow - The row type of the bound table
 */
export type CreateDocumentBindingConfig<TRow extends BaseRow> = {
	/** Column name storing the Y.Doc GUID. */
	guidKey: keyof TRow & string;
	/** Column name to bump when the doc changes. */
	updatedAtKey: keyof TRow & string;
	/** The table helper — needed to bump updatedAt and observe row deletions. */
	tableHelper: TableHelper<TRow>;
	/** The workspace Y.Doc — needed for transact() when bumping updatedAt. */
	ydoc: Y.Doc;
	/**
	 * Document extension registrations (from `withDocumentExtension()` calls).
	 * Each registration has a key, factory, and optional tags for filtering.
	 * At open time, registrations are filtered by tag matching before firing.
	 */
	documentExtensions?: DocumentExtensionRegistration[];
	/**
	 * Tags declared on this document binding (from `withDocument(..., { tags })`).
	 * Used for tag matching against document extension registrations.
	 */
	documentTags?: readonly string[];
	/**
	 * Table name for the `DocumentContext.binding` metadata.
	 * Used by extensions to distinguish which table a doc belongs to.
	 */
	tableName?: string;
	/**
	 * Document binding name for the `DocumentContext.binding` metadata.
	 * Used by extensions to distinguish which binding a doc belongs to.
	 */
	documentName?: string;
	/**
	 * Called when a row is deleted from the table.
	 * Receives the GUID of the associated document.
	 * Default: close (free memory, preserve persisted data).
	 */
	onRowDeleted?: (binding: DocumentBinding<TRow>, guid: string) => void;
};

/**
 * Create a runtime document binding — a bidirectional link between table rows
 * and their content Y.Docs.
 *
 * The binding manages:
 * - Y.Doc creation with `gc: false` (required for Yjs provider compatibility)
 * - Provider lifecycle (persistence, sync) via document extension hooks
 * - Automatic `updatedAt` bumping when content docs change
 * - Automatic cleanup when rows are deleted from the table
 *
 * @param config - Binding configuration
 * @returns A `DocumentBinding<TRow>` with open/close/closeAll/guidOf methods
 */
export function createDocumentBinding<TRow extends BaseRow>(
	config: CreateDocumentBindingConfig<TRow>,
): DocumentBinding<TRow> {
	const {
		guidKey,
		updatedAtKey,
		tableHelper,
		ydoc: workspaceYdoc,
		documentExtensions = [],
		documentTags = [],
		tableName = '',
		documentName = '',
		onRowDeleted,
	} = config;

	const docs = new Map<string, DocEntry>();

	/**
	 * Extract the GUID from a row or use the string directly.
	 */
	function resolveGuid(input: TRow | string): string {
		if (typeof input === 'string') return input;
		return String(input[guidKey]);
	}

	/**
	 * Set up the table observer for row deletion cleanup.
	 * Fires the `onRowDeleted` callback when a row is deleted.
	 */
	const unobserveTable = tableHelper.observe((changedIds) => {
		for (const id of changedIds) {
			const result = tableHelper.get(id);
			if (result.status !== 'not_found') continue;

			// Row was deleted — find the matching open doc by searching
			// all open docs where the guid matches. For most tables, the
			// guid IS the row id, but it could be a different column.
			for (const [guid] of docs) {
				// Check if this guid corresponds to the deleted row.
				// Since we can't reverse-map guid→rowId without scanning,
				// we check if the deleted row ID matches any open doc's guid
				// OR if the guid key IS 'id' (common case).
				if (guid === id || guidKey === 'id') {
					const targetGuid = guidKey === 'id' ? id : guid;
					if (!docs.has(targetGuid)) continue;

					if (onRowDeleted) {
						onRowDeleted(binding, targetGuid);
					} else {
						// Default: close (free memory, preserve data)
						binding.close(targetGuid);
					}
					break;
				}
			}
		}
	});

	const binding: DocumentBinding<TRow> = {
		async open(input: TRow | string): Promise<DocumentHandle> {
			const guid = resolveGuid(input);

			const existing = docs.get(guid);
			if (existing) return existing.whenReady;

			const contentYdoc = new Y.Doc({ guid, gc: false });
			const lifecycles: NormalizedLifecycle[] = [];
			const docExports: Record<string, Record<string, unknown>> = {};

			// Filter document extensions by tag matching:
			// - No tags on extension → fire for all docs (universal)
			// - Has tags → fire only if doc tags and extension tags share ANY value
			const applicableExtensions = documentExtensions.filter((reg) => {
				if (reg.tags.length === 0) return true;
				return reg.tags.some((tag) => documentTags.includes(tag));
			});

			// Call document extension factories synchronously.
			// IMPORTANT: No await between docs.get() and docs.set() — ensures
			// concurrent open() calls for the same guid are safe.
			// Build the extensions map incrementally so each factory sees prior
			// extensions' exports + per-extension whenReady.
			const docExtensionsMap: Record<
				string,
				Record<string, unknown> & { whenReady: Promise<void> }
			> = {};

			try {
				for (const reg of applicableExtensions) {
					const compositeWhenReady: Promise<void> =
						lifecycles.length === 0
							? Promise.resolve()
							: Promise.all(
									lifecycles.map((l) => l.whenReady ?? Promise.resolve()),
								).then(() => {});

					const result = reg.factory({
						ydoc: contentYdoc,
						whenReady: compositeWhenReady,
						binding: { tableName, documentName, tags: documentTags },
						extensions: { ...docExtensionsMap },
					});

					if (result) {
						const lifecycle = result.lifecycle ?? {};
						lifecycles.push(lifecycle);

						// Normalize per-extension whenReady to Promise<void>
						const extWhenReady: Promise<void> = lifecycle.whenReady
							? lifecycle.whenReady.then(() => {})
							: Promise.resolve();

						if (result.exports) {
							docExports[reg.key] = result.exports;
							// Inject whenReady into exports (Option B: flat inject)
							Object.assign(result.exports, {
								whenReady: extWhenReady,
							});
							docExtensionsMap[reg.key] = result.exports as Record<
								string,
								unknown
							> & { whenReady: Promise<void> };
						} else {
							// Extension with no exports still gets an entry for whenReady
							docExtensionsMap[reg.key] = { whenReady: extWhenReady };
						}
					}
				}
			} catch (err) {
				await Promise.allSettled(
					lifecycles.map((l) => l.destroy?.()).filter(Boolean),
				);
				contentYdoc.destroy();
				throw err;
			}

			// Attach updatedAt observer — fires when content doc changes.
			// The Y.Doc 'update' handler receives (update, origin, doc, transaction).
			// We use transaction.local to skip remote sync updates — only local edits
			// should bump updatedAt. Remote devices receive the bumped value via
			// workspace ydoc sync; redundant bumping would cause unnecessary churn.
			const updateHandler = (
				_update: Uint8Array,
				origin: unknown,
				_doc: Y.Doc,
				transaction: Y.Transaction,
			) => {
				// Skip updates from the document binding itself to avoid loops
				if (origin === DOCUMENT_BINDING_ORIGIN) return;
				// Skip remote updates — only local edits bump updatedAt
				if (!transaction.local) return;

				// Find the row that references this guid and bump updatedAt
				// For guid === rowId (common case), we can update directly
				workspaceYdoc.transact(() => {
					tableHelper.update(guid, {
						[updatedAtKey]: Date.now(),
					} as Partial<Omit<TRow, 'id'>>);
				}, DOCUMENT_BINDING_ORIGIN);
			};

			contentYdoc.on('update', updateHandler);
			const unobserve = () => contentYdoc.off('update', updateHandler);

			// Cache entry SYNCHRONOUSLY before any promise resolution
			const whenReady =
				lifecycles.length === 0
					? Promise.resolve(makeHandle(contentYdoc, docExports))
					: Promise.all(lifecycles.map((l) => l.whenReady ?? Promise.resolve()))
							.then(() => makeHandle(contentYdoc, docExports))
							.catch(async (err) => {
								// If any provider's whenReady rejects, clean up everything
								await Promise.allSettled(
									lifecycles.map((l) => l.destroy?.()).filter(Boolean),
								);
								unobserve();
								contentYdoc.destroy();
								docs.delete(guid);
								throw err;
							});

			docs.set(guid, {
				ydoc: contentYdoc,
				lifecycles,
				exports: docExports,
				unobserve,
				whenReady,
			});
			return whenReady;
		},

		async close(input: TRow | string): Promise<void> {
			const guid = resolveGuid(input);
			const entry = docs.get(guid);
			if (!entry) return;

			// Remove from map SYNCHRONOUSLY so concurrent open() calls
			// create a fresh Y.Doc. Async cleanup follows.
			docs.delete(guid);
			entry.unobserve();

			await Promise.allSettled(
				entry.lifecycles.map((l) => l.destroy?.()).filter(Boolean),
			);
			entry.ydoc.destroy();
		},

		async closeAll(): Promise<void> {
			const entries = Array.from(docs.entries());
			// Clear map synchronously first
			docs.clear();
			unobserveTable();

			for (const [, entry] of entries) {
				entry.unobserve();
				await Promise.allSettled(
					entry.lifecycles.map((l) => l.destroy?.()).filter(Boolean),
				);
				entry.ydoc.destroy();
			}
		},

		guidOf(row: TRow): string {
			return String(row[guidKey]);
		},
	};

	return binding;
}
