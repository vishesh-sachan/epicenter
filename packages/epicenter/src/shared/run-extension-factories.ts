/**
 * Shared factory execution logic for workspace and document extension lifecycles.
 *
 * Both `withExtension()` (workspace-level) and `open()` (document-level) need
 * identical semantics: void skip, defineExtension normalization, LIFO cleanup
 * on factory throw, and incremental whenReady composition. This module provides
 * the single source of truth for that logic.
 *
 * @module
 */

import {
	defineExtension,
	type Extension,
	type MaybePromise,
} from './lifecycle.js';

/**
 * A factory entry to be executed by the runner.
 *
 * The `factory` receives a context built by the caller (via `buildContext`)
 * and returns extension exports or void (skip).
 */
export type ExtensionFactoryEntry = {
	key: string;
	// biome-ignore lint/suspicious/noExplicitAny: factories return varying shapes; type safety enforced at call sites
	factory: (ctx: any) =>
		| (Record<string, unknown> & {
				whenReady?: Promise<unknown>;
				destroy?: () => MaybePromise<void>;
		  })
		| void;
};

/**
 * Result of running extension factories.
 */
export type RunExtensionFactoriesResult = {
	// biome-ignore lint/suspicious/noExplicitAny: runtime storage uses wide type
	extensions: Record<string, Extension<any>>;
	destroys: (() => MaybePromise<void>)[];
	whenReadyPromises: Promise<unknown>[];
};

/**
 * Run extension factories sequentially with shared lifecycle semantics.
 *
 * Handles:
 * - **Void skip**: Factories returning void/undefined are skipped entirely
 * - **defineExtension normalization**: Raw returns get whenReady/destroy defaults
 * - **LIFO cleanup on throw**: If factory N throws, factories 0..N-1 are
 *   destroyed in reverse order. Prior destroys (from `priorDestroys`) are also
 *   cleaned up.
 * - **Incremental context**: `buildContext` is called per factory with the
 *   accumulated state, enabling incremental whenReady composition
 *
 * @param options.entries - Factory entries to execute (in order)
 * @param options.buildContext - Called per factory to construct the factory's context.
 *   Receives accumulated whenReadyPromises and extensions.
 * @param options.priorDestroys - Destroy functions from prior builder state.
 *   Included in LIFO cleanup on factory throw (workspace builder passes prior
 *   extensions here; document binding passes nothing).
 *
 * @returns Accumulated extensions, destroys, and whenReadyPromises
 * @throws Re-throws the factory error after LIFO cleanup
 */
export function runExtensionFactories(options: {
	entries: ExtensionFactoryEntry[];
	buildContext: (state: {
		whenReadyPromises: Promise<unknown>[];
		// biome-ignore lint/suspicious/noExplicitAny: runtime storage
		extensions: Record<string, Extension<any>>;
	}) => unknown;
	priorDestroys?: (() => MaybePromise<void>)[];
}): RunExtensionFactoriesResult {
	const { entries, buildContext, priorDestroys = [] } = options;

	// biome-ignore lint/suspicious/noExplicitAny: runtime storage
	const extensions: Record<string, Extension<any>> = {};
	const destroys: (() => MaybePromise<void>)[] = [];
	const whenReadyPromises: Promise<unknown>[] = [];

	try {
		for (const { key, factory } of entries) {
			const ctx = buildContext({ whenReadyPromises, extensions });
			const raw = factory(ctx);

			// Void return means "not installed" — skip registration
			if (!raw) continue;

			const resolved = defineExtension(raw);
			extensions[key] = resolved;
			destroys.push(resolved.destroy);
			whenReadyPromises.push(resolved.whenReady);
		}
	} catch (err) {
		// LIFO cleanup: new destroys first, then prior destroys
		const allDestroys = [...priorDestroys, ...destroys];
		const errors: unknown[] = [];
		for (let i = allDestroys.length - 1; i >= 0; i--) {
			try {
				const result = allDestroys[i]!();
				if (result instanceof Promise) {
					result.catch(() => {}); // Fire and forget in sync context
				}
			} catch (cleanupErr) {
				errors.push(cleanupErr);
			}
		}

		if (errors.length > 0) {
			console.error('Extension cleanup errors during factory failure:', errors);
		}

		throw err;
	}

	return { extensions, destroys, whenReadyPromises };
}
