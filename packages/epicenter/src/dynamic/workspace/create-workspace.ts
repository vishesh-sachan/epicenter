/**
 * createWorkspace() - Instantiate a dynamic workspace client.
 *
 * Returns a client that IS usable directly AND has `.withExtension()` for chaining.
 *
 * ## Extension chaining vs action maps
 *
 * Extensions use chainable `.withExtension(key, factory)` because they build on each
 * other progressively — each factory receives previously added extensions as typed context.
 * You may be importing extensions you don't control and want to compose on top of them.
 *
 * @example
 * ```typescript
 * // Direct use (no extensions)
 * const workspace = createWorkspace(definition);
 * workspace.tables.get('posts').upsert({ id: '1', title: 'Hello' });
 *
 * // With extensions (chained)
 * const workspace = createWorkspace(definition)
 *   .withExtension('persistence', indexeddbPersistence)
 *   .withExtension('sync', ySweetSync({ auth: directAuth('...') }));
 *
 * 	await workspace.whenReady;
 * workspace.extensions.persistence.clearData();
 * ```
 */

import * as Y from 'yjs';
import type { MaybePromise } from '../../shared/lifecycle';
import { runExtensionFactories } from '../../shared/run-extension-factories';
import { createKv } from '../kv/create-kv';
import type { KvField, TableDefinition } from '../schema/fields/types';
import type { WorkspaceDefinition } from '../schema/workspace-definition';
import { createTables } from '../tables/create-tables';
import type {
	ExtensionContext,
	WorkspaceClient,
	WorkspaceClientBuilder,
} from './types';

/**
 * Create a workspace client with chainable extension support.
 *
 * The returned client IS directly usable (no extensions required) AND supports
 * chaining `.withExtension()` calls to progressively add extensions, each with
 * typed access to all previously added extensions.
 *
 * ## Y.Doc Structure
 *
 * ```
 * Y.Doc (guid = definition.id, gc: true)
 * +-- Y.Array('table:posts')  <- Table data (LWW entries)
 * +-- Y.Array('table:users')  <- Another table
 * +-- Y.Array('kv')           <- KV settings (LWW entries)
 * ```
 *
 * @example Direct use (no extensions)
 * ```typescript
 * const workspace = createWorkspace(definition);
 * workspace.tables.get('posts').upsert({ id: '1', title: 'Hello' });
 * ```
 *
 * @example With extensions (chained)
 * ```typescript
 * const workspace = createWorkspace(definition)
 *   .withExtension('persistence', ({ ydoc }) => persistenceExtension({ ydoc }))
 *   .withExtension('sync', ({ ydoc }) => syncExtension({ ydoc }));
 *
 * 	await workspace.whenReady;
 * ```
 *
 * @param definition - Workspace definition with id, tables, and kv
 * @returns WorkspaceClientBuilder - a client that can be used directly or chained with .withExtension()
 */
export function createWorkspace<
	const TTableDefinitions extends readonly TableDefinition[],
	const TKvFields extends readonly KvField[],
>(
	definition: WorkspaceDefinition<TTableDefinitions, TKvFields>,
): WorkspaceClientBuilder<TTableDefinitions, TKvFields> {
	const id = definition.id;

	// Create Y.Doc with guid = definition.id
	// gc: true enables garbage collection for efficient YKeyValueLww storage
	const ydoc = new Y.Doc({ guid: id, gc: true });

	// Create table and KV helpers bound to Y.Doc
	const tables = createTables(ydoc, definition.tables ?? []);
	const kv = createKv(ydoc, definition.kv ?? []);

	/**
	 * Immutable builder state passed through the builder chain.
	 * Each `withExtension` creates new arrays instead of mutating shared state,
	 * which fixes builder branching isolation.
	 */
	type BuilderState = {
		extensionCleanups: (() => MaybePromise<void>)[];
		whenReadyPromises: Promise<unknown>[];
	};

	function buildClient<TExtensions extends Record<string, unknown>>(
		extensions: TExtensions,
		state: BuilderState,
	): WorkspaceClientBuilder<TTableDefinitions, TKvFields, TExtensions> {
		const destroy = async (): Promise<void> => {
			// Destroy extensions in LIFO order (last added = first destroyed)
			const errors: unknown[] = [];
			for (let i = state.extensionCleanups.length - 1; i >= 0; i--) {
				try {
					await state.extensionCleanups[i]!();
				} catch (err) {
					errors.push(err);
				}
			}
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
			tables,
			kv,
			extensions,
			whenReady,
			destroy,
			[Symbol.asyncDispose]: destroy,
		};

		// The builder methods use generics at the type level for progressive accumulation,
		// but the runtime implementations use wider types for storage.
		// The cast at the end bridges the gap — type safety is enforced at call sites.
		const builder = Object.assign(client, {
			withExtension<
				TKey extends string,
				TExports extends Record<string, unknown>,
			>(
				key: TKey,
				factory: (
					context: ExtensionContext<TTableDefinitions, TKvFields, TExtensions>,
				) => TExports & {
					whenReady?: Promise<unknown>;
					destroy?: () => MaybePromise<void>;
				},
			) {
				const result = runExtensionFactories({
					entries: [{ key, factory }],
					buildContext: ({ whenReadyPromises }) => ({
						id,
						ydoc,
						tables,
						kv,
						batch: (fn: () => void) => ydoc.transact(fn),
						whenReady:
							state.whenReadyPromises.length === 0 &&
							whenReadyPromises.length === 0
								? Promise.resolve()
								: Promise.all([
										...state.whenReadyPromises,
										...whenReadyPromises,
									]).then(() => {}),
						extensions,
					}),
					priorDestroys: state.extensionCleanups,
				});

				// Void return means "not installed" — skip registration
				if (Object.keys(result.extensions).length === 0) {
					return buildClient(extensions, state);
				}

				const newExtensions = {
					...extensions,
					...result.extensions,
				} as TExtensions & Record<TKey, TExports>;

				return buildClient(newExtensions, {
					extensionCleanups: [...state.extensionCleanups, ...result.destroys],
					whenReadyPromises: [
						...state.whenReadyPromises,
						...result.whenReadyPromises,
					],
				});
			},
		});

		return builder as unknown as WorkspaceClientBuilder<
			TTableDefinitions,
			TKvFields,
			TExtensions
		>;
	}

	return buildClient({} as Record<string, never>, {
		extensionCleanups: [],
		whenReadyPromises: [],
	});
}

export type { WorkspaceClient, WorkspaceClientBuilder };
