/**
 * createWorkspace() - Instantiate a workspace client.
 *
 * Returns a client that IS usable directly AND has `.withExtension()` for chaining.
 *
 * ## Extension chaining vs action maps
 *
 * Extensions use chainable `.withExtension(key, factory)` because they build on each
 * other progressively — each factory receives previously added extensions as typed context.
 * You may be importing extensions you don't control and want to compose on top of them.
 *
 * Actions use a single `.withActions(factory)` because they don't build on each other,
 * are always defined by the app author, and benefit from being declared in one place.
 *
 * @example
 * ```typescript
 * // Direct use (no extensions)
 * const client = createWorkspace({ id: 'my-app', tables: { posts } });
 * client.tables.posts.set({ id: '1', title: 'Hello' });
 *
 * // With extensions (chained)
 * const client = createWorkspace({ id: 'my-app', tables: { posts } })
 *   .withExtension('persistence', indexeddbPersistence)
 *   .withExtension('sync', ySweetSync({ auth: directAuth('...') }));
 *
 * // With actions (terminal)
 * const client = createWorkspace({ id: 'my-app', tables: { posts } })
 *   .withExtension('persistence', indexeddbPersistence)
 *   .withActions((client) => ({
 *     createPost: defineMutation({ ... }),
 *   }));
 *
 * // From reusable definition
 * const def = defineWorkspace({ id: 'my-app', tables: { posts } });
 * const client = createWorkspace(def);
 * ```
 */

import * as Y from 'yjs';
import type { Actions } from '../shared/actions.js';
import { createAwareness } from './create-awareness.js';
import { createDocumentBinding } from './create-document-binding.js';
import { createKv } from './create-kv.js';
import { createTables } from './create-tables.js';
import {
	type DocumentContext,
	defineExtension,
	type MaybePromise,
} from './lifecycle.js';
import type {
	AwarenessDefinitions,
	BaseRow,
	DocBinding,
	DocumentBinding,
	DocumentExtensionRegistration,
	ExtensionContext,
	KvDefinitions,
	TableDefinitions,
	TableHelper,
	WorkspaceClient,
	WorkspaceClientBuilder,
	WorkspaceClientWithActions,
	WorkspaceDefinition,
} from './types.js';

/**
 * Create a workspace client with chainable extension support.
 *
 * The returned client IS directly usable (no extensions required) AND supports
 * chaining `.withExtension()` calls to progressively add extensions, each with
 * typed access to all previously added extensions.
 *
 * Single code path — no overloads, no branches. Awareness is always created
 * (like tables and KV). When no awareness fields are defined, the helper has
 * zero accessible field keys but `raw` is still available for sync providers.
 *
 * @param config - Workspace config (or WorkspaceDefinition from defineWorkspace())
 * @returns WorkspaceClientBuilder - a client that can be used directly or chained with .withExtension()
 */
export function createWorkspace<
	TId extends string,
	TTableDefinitions extends TableDefinitions = Record<string, never>,
	TKvDefinitions extends KvDefinitions = Record<string, never>,
	TAwarenessDefinitions extends AwarenessDefinitions = Record<string, never>,
>(
	config: WorkspaceDefinition<
		TId,
		TTableDefinitions,
		TKvDefinitions,
		TAwarenessDefinitions
	>,
): WorkspaceClientBuilder<
	TId,
	TTableDefinitions,
	TKvDefinitions,
	TAwarenessDefinitions,
	Record<string, never>
> {
	const { id } = config;
	const ydoc = new Y.Doc({ guid: id });
	const tableDefs = (config.tables ?? {}) as TTableDefinitions;
	const kvDefs = (config.kv ?? {}) as TKvDefinitions;
	const awarenessDefs = (config.awareness ?? {}) as TAwarenessDefinitions;

	const tables = createTables(ydoc, tableDefs);
	const kv = createKv(ydoc, kvDefs);
	const awareness = createAwareness(ydoc, awarenessDefs);
	const definitions = {
		tables: tableDefs,
		kv: kvDefs,
		awareness: awarenessDefs,
	};

	/**
	 * Immutable builder state passed through the builder chain.
	 * Each `withExtension` creates new arrays instead of mutating shared state,
	 * which fixes builder branching isolation.
	 */
	type BuilderState = {
		extensionCleanups: (() => MaybePromise<void>)[];
		whenReadyPromises: Promise<unknown>[];
	};

	// Accumulated document extension registrations (in chain order).
	// Mutable array — grows as .withDocumentExtension() is called. Document
	// bindings reference this array, so by the time user code calls .open(),
	// all document extensions are registered.
	const documentExtensionRegistrations: DocumentExtensionRegistration[] = [];

	// Create document bindings for tables that have .withDocument() declarations.
	// Bindings are created eagerly but reference documentExtensionRegistrations by closure,
	// so they pick up extensions added later via .withDocumentExtension().
	const documentBindingCleanups: (() => Promise<void>)[] = [];

	for (const [tableName, tableDef] of Object.entries(tableDefs)) {
		const docsDef = (tableDef as { docs?: Record<string, DocBinding> }).docs;
		if (!docsDef || Object.keys(docsDef).length === 0) continue;

		const tableHelper = (tables as Record<string, TableHelper<BaseRow>>)[
			tableName
		];
		if (!tableHelper) continue;

		const docsNamespace: Record<string, DocumentBinding<BaseRow>> = {};

		for (const [docName, docBinding] of Object.entries(docsDef)) {
			const docTags: readonly string[] = docBinding.tags ?? [];

			const binding = createDocumentBinding({
				id,
				guidKey: docBinding.guid as keyof BaseRow & string,
				updatedAtKey: docBinding.updatedAt as keyof BaseRow & string,
				tableHelper,
				ydoc,
				documentExtensions: documentExtensionRegistrations,
				documentTags: docTags,
			});

			docsNamespace[docName] = binding;
			documentBindingCleanups.push(() => binding.closeAll());
		}

		// Attach .docs namespace to the table helper
		Object.defineProperty(tableHelper, 'docs', {
			value: docsNamespace,
			enumerable: true,
			configurable: false,
			writable: false,
		});
	}

	function buildClient<TExtensions extends Record<string, unknown>>(
		extensions: TExtensions,
		state: BuilderState,
	): WorkspaceClientBuilder<
		TId,
		TTableDefinitions,
		TKvDefinitions,
		TAwarenessDefinitions,
		TExtensions
	> {
		const destroy = async (): Promise<void> => {
			// Destroy document bindings first (before extensions they depend on)
			for (const cleanup of documentBindingCleanups) {
				await cleanup();
			}
			// Destroy extensions in LIFO order (last added = first destroyed)
			const errors: unknown[] = [];
			for (let i = state.extensionCleanups.length - 1; i >= 0; i--) {
				try {
					await state.extensionCleanups[i]!();
				} catch (err) {
					errors.push(err);
				}
			}
			// Destroy awareness
			awareness.raw.destroy();
			ydoc.destroy();

			if (errors.length > 0) {
				throw new Error(`Extension cleanup errors: ${errors.length}`);
			}
		};

		const whenReady = Promise.all(state.whenReadyPromises)
			.then(() => {})
			.catch(async (err) => {
				// If any extension's whenReady rejects, clean up everything
				await destroy().catch(() => {}); // idempotent
				throw err;
			});

		const client = {
			id,
			ydoc,
			definitions,
			tables,
			kv,
			awareness,
			// Each extension entry is the exports object stored by reference.
			extensions,
			batch(fn: () => void): void {
				ydoc.transact(fn);
			},
			whenReady,
			destroy,
			[Symbol.asyncDispose]: destroy,
		};

		// The builder methods use generics at the type level for progressive accumulation,
		// but the runtime implementations use wider types for storage (registrations array).
		// The cast at the end bridges the gap — type safety is enforced at call sites.
		const builder = Object.assign(client, {
			withExtension<
				TKey extends string,
				TExports extends Record<string, unknown>,
			>(
				key: TKey,
				factory: (
					context: ExtensionContext<
						TId,
						TTableDefinitions,
						TKvDefinitions,
						TAwarenessDefinitions,
						TExtensions
					>,
				) => TExports & {
					whenReady?: Promise<unknown>;
					destroy?: () => MaybePromise<void>;
				},
			) {
				const ctx = {
					id,
					ydoc,
					definitions,
					tables,
					kv,
					awareness,
					batch: (fn: () => void) => ydoc.transact(fn),
					whenReady:
						state.whenReadyPromises.length === 0
							? Promise.resolve()
							: Promise.all(state.whenReadyPromises).then(() => {}),
					extensions,
				};

				try {
					const raw = factory(ctx);

					// Void return means "not installed" — skip registration
					if (!raw) return buildClient(extensions, state);

					const resolved = defineExtension(raw);

					return buildClient(
						{
							...extensions,
							[key]: resolved,
						} as TExtensions & Record<TKey, TExports>,
						{
							extensionCleanups: [...state.extensionCleanups, resolved.destroy],
							whenReadyPromises: [
								...state.whenReadyPromises,
								resolved.whenReady,
							],
						},
					);
				} catch (err) {
					// LIFO cleanup: prior extensions in reverse order
					const errors: unknown[] = [];
					for (let i = state.extensionCleanups.length - 1; i >= 0; i--) {
						try {
							const result = state.extensionCleanups[i]!();
							if (result instanceof Promise) {
								result.catch(() => {}); // Fire and forget in sync context
							}
						} catch (cleanupErr) {
							errors.push(cleanupErr);
						}
					}

					if (errors.length > 0) {
						console.error(
							'Extension cleanup errors during factory failure:',
							errors,
						);
					}

					throw err;
				}
			},

			withDocumentExtension(
				key: string,
				factory: (context: DocumentContext) =>
					| (Record<string, unknown> & {
							whenReady?: Promise<unknown>;
							destroy?: () => MaybePromise<void>;
					  })
					| void,
				options?: { tags?: string[] },
			) {
				documentExtensionRegistrations.push({
					key,
					factory,
					tags: options?.tags ?? [],
				});
				return buildClient(extensions, state);
			},

			withActions<TActions extends Actions>(
				factory: (
					client: WorkspaceClient<
						TId,
						TTableDefinitions,
						TKvDefinitions,
						TAwarenessDefinitions,
						TExtensions
					>,
				) => TActions,
			) {
				const actions = factory(client);
				return {
					...client,
					actions,
				} as WorkspaceClientWithActions<
					TId,
					TTableDefinitions,
					TKvDefinitions,
					TAwarenessDefinitions,
					TExtensions,
					TActions
				>;
			},
		});

		return builder as unknown as WorkspaceClientBuilder<
			TId,
			TTableDefinitions,
			TKvDefinitions,
			TAwarenessDefinitions,
			TExtensions
		>;
	}

	return buildClient({} as Record<string, never>, {
		extensionCleanups: [],
		whenReadyPromises: [],
	});
}

export type { WorkspaceClient, WorkspaceClientBuilder };
