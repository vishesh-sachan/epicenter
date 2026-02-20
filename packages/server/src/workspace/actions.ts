import type { Actions } from '@epicenter/hq';
import { iterateActions } from '@epicenter/hq';
import { Elysia } from 'elysia';

/**
 * Create an Elysia router for action definitions.
 *
 * @remarks
 * Actions are closure-based - they capture their dependencies (tables, extensions, etc.)
 * at definition time. The router invokes handlers directly.
 */
export function createActionsRouter(actions: Actions, prefix = '/actions') {
	const router = new Elysia({ prefix });

	for (const [action, path] of iterateActions(actions)) {
		const routePath = `/${path.join('/')}`;
		const namespaceTags = path.length > 1 ? [path[0] as string] : [];
		const tags = [...namespaceTags, action.type];

		const detail = {
			summary: path.join('.'),
			description: action.description,
			tags,
		};

		switch (action.type) {
			case 'query':
				router.get(
					routePath,
					async ({ query }) => ({
						data: await (action.input ? action(query) : action()),
					}),
					{ query: action.input, detail },
				);
				break;
			case 'mutation':
				router.post(
					routePath,
					async ({ body }) => ({
						data: await (action.input ? action(body) : action()),
					}),
					{ body: action.input, detail },
				);
				break;
			default: {
				const _exhaustive: never = action;
				throw new Error(
					`Unknown action type: ${(_exhaustive as { type: string }).type}`,
				);
			}
		}
	}

	return router;
}

/**
 * Collect action paths for logging/discovery.
 */
export function collectActionPaths(actions: Actions): string[] {
	return [...iterateActions(actions)].map(([, path]) => path.join('/'));
}
