/**
 * Create Workspace Tests
 *
 * This file verifies the dynamic workspace factory creates a usable client,
 * correctly composes extensions, and honors lifecycle guarantees.
 * These tests protect the core runtime contract that all higher-level workspace
 * features build on.
 *
 * Key behaviors:
 * - Creates immediately usable workspace clients with tables and kv helpers
 * - Composes extension exports and lifecycle hooks in predictable order
 */
import { describe, expect, test } from 'bun:test';
import * as Y from 'yjs';
import { boolean, Id, id, integer, select, table, text } from '../schema';
import { defineWorkspace } from '../schema/workspace-definition';
import { createWorkspace } from './create-workspace';

// ════════════════════════════════════════════════════════════════════════════
// TEST FIXTURES
// ════════════════════════════════════════════════════════════════════════════

const postsTable = table({
	id: 'posts',
	name: 'Posts',
	fields: [
		id(),
		text({ id: 'title' }),
		integer({ id: 'view_count' }),
		boolean({ id: 'published' }),
	] as const,
});

const settingsKv = select({
	id: 'theme',
	name: 'Theme',
	options: ['light', 'dark'] as const,
	default: 'light',
});

const testDefinition = defineWorkspace({
	id: 'test-workspace',
	name: 'Test Workspace',
	description: 'A test workspace',
	icon: null,
	tables: [postsTable],
	kv: [settingsKv],
});

// ════════════════════════════════════════════════════════════════════════════
// TESTS
// ════════════════════════════════════════════════════════════════════════════

describe('createWorkspace', () => {
	describe('direct usage (no extensions)', () => {
		test('returns a usable client immediately', () => {
			const workspace = createWorkspace(testDefinition);

			// Should be usable immediately
			expect(workspace.id).toBe('test-workspace');
			expect(workspace.ydoc).toBeInstanceOf(Y.Doc);
			expect(workspace.tables).toBeDefined();
			expect(workspace.kv).toBeDefined();
			expect(workspace.extensions).toEqual({});
			expect(workspace.whenReady).toBeInstanceOf(Promise);
			expect(typeof workspace.destroy).toBe('function');
		});

		test('creates Y.Doc with workspace guid and gc enabled', () => {
			const workspace = createWorkspace(testDefinition);

			// guid should be definition.id
			expect(workspace.ydoc.guid).toBe('test-workspace');
			// gc should be true for efficient YKeyValueLww storage
			expect(workspace.ydoc.gc).toBe(true);
		});

		test('tables are usable without extensions', () => {
			const workspace = createWorkspace(testDefinition);
			const posts = workspace.tables.get('posts');

			// Insert a row
			posts.upsert({
				id: '1',
				title: 'Hello World',
				view_count: 0,
				published: false,
			} as Parameters<typeof posts.upsert>[0]);

			// Read back
			const result = workspace.tables.get('posts').get(Id('1'));
			expect(result.status).toBe('valid');
			if (result.status === 'valid') {
				const row = result.row as {
					title: string;
					view_count: number;
					published: boolean;
				};
				expect(row.title).toBe('Hello World');
				expect(row.view_count).toBe(0);
				expect(row.published).toBe(false);
			}
		});

		test('kv is usable without extensions', () => {
			const workspace = createWorkspace(testDefinition);

			// Set a KV value
			workspace.kv.set('theme', 'dark');

			// Read back
			const result = workspace.kv.get('theme');
			expect(result.status).toBe('valid');
			if (result.status === 'valid') {
				expect(result.value).toBe('dark');
			}
		});

		test('whenReady resolves immediately without extensions', async () => {
			const workspace = createWorkspace(testDefinition);

			// Should resolve immediately since there are no extensions
			await expect(workspace.whenReady).resolves.toBeUndefined();
		});
	});

	describe('.withExtension()', () => {
		test('returns a new client with extensions', () => {
			const baseWorkspace = createWorkspace(testDefinition);

			// Use inline factory for better type inference
			const workspace = baseWorkspace.withExtension('mock', ({ id }) => ({
				greeting: `Hello from ${id}`,
			}));

			// Should have extension exports
			expect(workspace.extensions.mock).toBeDefined();
			expect(workspace.extensions.mock.greeting).toBe(
				'Hello from test-workspace',
			);
		});

		test('extensions receive correct context', () => {
			const baseWorkspace = createWorkspace(testDefinition);

			let receivedContext: Record<string, unknown> | undefined;
			baseWorkspace.withExtension('capture', ({ id, ydoc, tables, kv }) => {
				receivedContext = {
					id,
					hasYdoc: ydoc instanceof Y.Doc,
					hasTables: typeof tables.get === 'function',
					hasKv: typeof kv.get === 'function',
				};
				return {};
			});

			expect(receivedContext).toBeDefined();
			expect(receivedContext?.id).toBe('test-workspace');
			expect(receivedContext?.hasYdoc).toBe(true);
			expect(receivedContext?.hasTables).toBe(true);
			expect(receivedContext?.hasKv).toBe(true);
		});

		test('whenReady aggregates all extension promises', async () => {
			const baseWorkspace = createWorkspace(testDefinition);

			let resolved1 = false;
			let resolved2 = false;

			const workspace = baseWorkspace
				.withExtension('ext1', () => ({
					whenReady: new Promise<void>((resolve) => {
						setTimeout(() => {
							resolved1 = true;
							resolve();
						}, 10);
					}),
				}))
				.withExtension('ext2', () => ({
					whenReady: new Promise<void>((resolve) => {
						setTimeout(() => {
							resolved2 = true;
							resolve();
						}, 20);
					}),
				}));

			// Before awaiting, neither should be resolved
			expect(resolved1).toBe(false);
			expect(resolved2).toBe(false);

			// After awaiting, both should be resolved
			await workspace.whenReady;
			expect(resolved1).toBe(true);
			expect(resolved2).toBe(true);
		});

		test('context.whenReady resolves after prior extensions', async () => {
			const order: string[] = [];

			const workspace = createWorkspace(testDefinition)
				.withExtension('slow', () => ({
					tag: 'slow',
					whenReady: new Promise<void>((resolve) =>
						setTimeout(() => {
							order.push('slow-ready');
							resolve();
						}, 50),
					),
				}))
				.withExtension('dependent', ({ whenReady }) => {
					// whenReady should be a promise representing all prior extensions
					expect(whenReady).toBeInstanceOf(Promise);

					const whenReadyPromise = (async () => {
						await whenReady;
						order.push('dependent-ready');
					})();

					return {
						tag: 'dependent',
						whenReady: whenReadyPromise,
					};
				});

			await workspace.whenReady;
			// 'slow' must resolve before 'dependent' starts
			expect(order).toEqual(['slow-ready', 'dependent-ready']);
		});

		test('context includes whenReady and destroy', () => {
			createWorkspace(testDefinition).withExtension(
				'inspector',
				({ id, ydoc, tables, kv, extensions, whenReady }) => {
					expect(id).toBe('test-workspace');
					expect(ydoc).toBeDefined();
					expect(tables).toBeDefined();
					expect(kv).toBeDefined();
					expect(extensions).toBeDefined();
					expect(whenReady).toBeInstanceOf(Promise);
					return {};
				},
			);
		});

		test('keeps base client extensions empty after chaining', () => {
			const baseWorkspace = createWorkspace(testDefinition);

			const chainedWorkspace = baseWorkspace.withExtension('mock', () => ({
				data: 'test',
			}));

			// Base should still have empty extensions
			expect(baseWorkspace.extensions).toEqual({});
			// Chained should have the extension
			expect(chainedWorkspace.extensions.mock.data).toBe('test');
		});
	});

	describe('lifecycle', () => {
		test('destroy() cleans up Y.Doc', async () => {
			const workspace = createWorkspace(testDefinition);
			const posts = workspace.tables.get('posts');

			// Add some data
			posts.upsert({
				id: '1',
				title: 'Test',
				view_count: 0,
				published: false,
			} as Parameters<typeof posts.upsert>[0]);

			// Destroy
			await workspace.destroy();

			// Y.Doc should be destroyed (no way to directly check, but shouldn't throw)
		});

		test('destroy() calls extension destroy functions', async () => {
			const baseWorkspace = createWorkspace(testDefinition);

			let destroyed1 = false;
			let destroyed2 = false;

			const workspace = baseWorkspace
				.withExtension('ext1', () => ({
					destroy: () => {
						destroyed1 = true;
					},
				}))
				.withExtension('ext2', () => ({
					destroy: () => {
						destroyed2 = true;
					},
				}));

			// Before destroy
			expect(destroyed1).toBe(false);
			expect(destroyed2).toBe(false);

			// After destroy
			await workspace.destroy();
			expect(destroyed1).toBe(true);
			expect(destroyed2).toBe(true);
		});

		test('Symbol.asyncDispose works for await using', async () => {
			let destroyed = false;

			const workspace = createWorkspace(testDefinition).withExtension(
				'tracker',
				() => ({
					destroy: () => {
						destroyed = true;
					},
				}),
			);

			// Manually call asyncDispose (simulate await using)
			await workspace[Symbol.asyncDispose]();

			expect(destroyed).toBe(true);
		});
	});

	describe('type inference', () => {
		test('returns persisted row values for typed table fields', () => {
			const workspace = createWorkspace(testDefinition);
			const posts = workspace.tables.get('posts');

			// Insert data
			posts.upsert({
				id: '1',
				title: 'Test',
				view_count: 100,
				published: true,
			} as Parameters<typeof posts.upsert>[0]);

			const result = workspace.tables.get('posts').get(Id('1'));
			if (result.status === 'valid') {
				const row = result.row as {
					title: string;
					view_count: number;
					published: boolean;
				};
				expect(row.title).toBe('Test');
				expect(row.view_count).toBe(100);
				expect(row.published).toBe(true);
			}
		});

		test('extension types are inferred correctly', () => {
			const workspace = createWorkspace(testDefinition).withExtension(
				'myExt',
				() => ({
					version: 1,
					getName: () => 'my-extension',
				}),
			);

			// These should be correctly typed via inference
			expect(workspace.extensions.myExt.version).toBe(1);
			expect(workspace.extensions.myExt.getName()).toBe('my-extension');
		});
	});

	describe('progressive type safety', () => {
		test('extension N+1 can access extension N exports via context', () => {
			const workspace = createWorkspace(testDefinition)
				.withExtension('first', () => ({
					value: 42,
					helper: () => 'from-first',
				}))
				.withExtension('second', ({ extensions }) => {
					// extensions.first is fully typed — no casts needed
					const doubled = extensions.first.value * 2;
					const msg = extensions.first.helper();
					return { doubled, msg };
				})
				.withExtension('third', ({ extensions }) => {
					// extensions.first AND extensions.second are both fully typed
					const tripled = extensions.first.value * 3;
					const fromSecond = extensions.second.doubled;
					return { tripled, fromSecond };
				});

			// All extensions accessible and typed on the final client
			expect(workspace.extensions.first.value).toBe(42);
			expect(workspace.extensions.first.helper()).toBe('from-first');
			expect(workspace.extensions.second.doubled).toBe(84);
			expect(workspace.extensions.second.msg).toBe('from-first');
			expect(workspace.extensions.third.tripled).toBe(126);
			expect(workspace.extensions.third.fromSecond).toBe(84);

			// Type-level assertions: these assignments would fail to compile if types were wrong
			const _num: number = workspace.extensions.first.value;
			const _str: string = workspace.extensions.first.helper();
			const _doubled: number = workspace.extensions.second.doubled;
			const _msg: string = workspace.extensions.second.msg;
			const _tripled: number = workspace.extensions.third.tripled;
			const _fromSecond: number = workspace.extensions.third.fromSecond;
			void [_num, _str, _doubled, _msg, _tripled, _fromSecond];
		});

		test('destroy runs in reverse order (LIFO)', async () => {
			const order: string[] = [];

			const workspace = createWorkspace(testDefinition)
				.withExtension('a', () => ({
					destroy: () => {
						order.push('a');
					},
				}))
				.withExtension('b', () => ({
					destroy: () => {
						order.push('b');
					},
				}))
				.withExtension('c', () => ({
					destroy: () => {
						order.push('c');
					},
				}));

			await workspace.destroy();
			expect(order).toEqual(['c', 'b', 'a']);
		});
	});
});
