import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
	CallToolRequestSchema,
	type CallToolResult,
	ErrorCode,
	ListToolsRequestSchema,
	McpError,
} from '@modelcontextprotocol/sdk/types.js';
import type { JsonSchema } from 'arktype';
import type { TaggedError } from 'wellcrafted/error';
import { isResult, type Result } from 'wellcrafted/result';
import type { Action } from '../core/actions';
import { type EpicenterClient, iterActions } from '../core/epicenter';
import { generateJsonSchema } from '../core/schema/generate-json-schema';
import type { AnyWorkspaceConfig } from '../core/workspace';

/**
 * Pre-computed MCP tool entry with action and its JSON Schema.
 * Schema is computed once during registry build and reused for ListTools.
 */
export type McpToolEntry = {
	action: Action;
	/** Pre-computed JSON Schema for the action's input (guaranteed to be object type) */
	inputSchema: JsonSchema;
};

/** Default schema for actions without input: empty object */
const EMPTY_OBJECT_SCHEMA: JsonSchema = { type: 'object', properties: {} };

/**
 * Setup MCP tool handlers on an existing MCP server instance.
 *
 * This configures the MCP server with ListTools and CallTool handlers
 * that expose all workspace actions as MCP tools using a flat namespace
 * (e.g., `workspace_action`).
 *
 * Uses the underlying Server instance (via mcpServer.server) to register
 * handlers with raw JSON schemas, bypassing McpServer's Zod-based API.
 *
 * @param mcpServer - The MCP server instance to configure (from elysia-mcp or similar)
 * @param toolRegistry - Pre-built registry of MCP tools from buildMcpToolRegistry
 *
 * @see {@link buildMcpToolRegistry} for building the tool registry
 * @see {@link createServer} in server.ts for how this is used with elysia-mcp
 */
export function setupMcpTools(
	mcpServer: McpServer,
	toolRegistry: Map<string, McpToolEntry>,
): void {
	// Access the underlying Server instance for low-level JSON Schema support
	const server: Server = mcpServer.server;

	// List tools handler - uses pre-computed schemas from registry
	server.setRequestHandler(ListToolsRequestSchema, () => {
		const tools = Array.from(toolRegistry.entries()).map(
			([name, { action, inputSchema }]) => ({
				name,
				title: name,
				description: action.description ?? `Execute ${name}`,
				inputSchema,
			}),
		);
		return { tools };
	});

	// Call tool handler
	server.setRequestHandler(
		CallToolRequestSchema,
		async (request): Promise<CallToolResult> => {
			const entry = toolRegistry.get(request.params.name);

			if (!entry) {
				throw new McpError(
					ErrorCode.InvalidParams,
					`Unknown tool: ${request.params.name}`,
				);
			}

			const { action } = entry;

			const args = request.params.arguments || {};

			// Validate input with Standard Schema
			let validatedInput: unknown;
			if (action.input) {
				let result = action.input['~standard'].validate(args);
				if (result instanceof Promise) result = await result;
				if (result.issues) {
					throw new McpError(
						ErrorCode.InvalidParams,
						`Invalid input for ${request.params.name}: ${JSON.stringify(
							result.issues.map((issue) => ({
								path: issue.path
									? issue.path
											.map((s) => (typeof s === 'object' ? s.key : s))
											.join('.')
									: 'root',
								message: issue.message,
							})),
						)}`,
					);
				}
				validatedInput = result.value;
			}

			// Execute action
			const maybeResult = (await action(validatedInput)) as
				| Result<unknown, TaggedError>
				| unknown;

			// Extract the actual output data and check for errors
			const outputChannel = isResult(maybeResult)
				? maybeResult.data
				: maybeResult;
			const errorChannel = isResult(maybeResult)
				? (maybeResult.error as TaggedError)
				: undefined;

			// Validate output schema if present (only validate when we have data)
			if (action.output && outputChannel !== undefined) {
				let result = action.output['~standard'].validate(outputChannel);
				if (result instanceof Promise) result = await result;
				if (result.issues) {
					throw new McpError(
						ErrorCode.InternalError,
						`Output validation failed for ${request.params.name}: ${JSON.stringify(
							result.issues.map((issue) => ({
								path: issue.path
									? issue.path
											.map((s) => (typeof s === 'object' ? s.key : s))
											.join('.')
									: 'root',
								message: issue.message,
							})),
						)}`,
					);
				}
			}

			// Handle error case
			if (errorChannel) {
				return {
					content: [
						{
							type: 'text',
							text: JSON.stringify({
								error: errorChannel.message ?? 'Unknown error',
							}),
						},
					],
					isError: true,
				} satisfies CallToolResult;
			}

			// Handle void/undefined returns (successful operations with no data)
			if (outputChannel === undefined || outputChannel === null) {
				return {
					content: [],
				} satisfies CallToolResult;
			}

			// MCP protocol requires structuredContent to be an object, not an array
			// Wrap arrays in an object with a semantic key derived from the action name
			const structuredContent = (
				Array.isArray(outputChannel)
					? { [deriveCollectionKey(request.params.name)]: outputChannel }
					: outputChannel
			) as Record<string, unknown>;

			return {
				content: [
					{
						type: 'text',
						text: JSON.stringify(outputChannel),
					},
				],
				structuredContent,
			} satisfies CallToolResult;
		},
	);
}

/**
 * Build a registry of MCP-compatible tools from workspace actions.
 *
 * Flattens hierarchical workspace actions into MCP tool names (underscore-joined),
 * pre-computes JSON Schemas for each action's input, and filters out actions with
 * non-object inputs (MCP requires object type at root).
 *
 * @example
 * // Flat export: { getAll: defineQuery(...) }
 * // → MCP tool name: "workspace_getAll"
 *
 * // Nested export: { users: { crud: { create: defineMutation(...) } } }
 * // → MCP tool name: "workspace_users_crud_create"
 */
export function buildMcpToolRegistry<
	TWorkspaces extends readonly AnyWorkspaceConfig[],
>(client: EpicenterClient<TWorkspaces>): Map<string, McpToolEntry> {
	const entries = iterActions(client).map(
		({ workspaceId, actionPath, action }) => {
			const toolName = [workspaceId, ...actionPath].join('_');

			// Build input schema - MCP requires object type at root
			if (!action.input) {
				return [
					toolName,
					{ action, inputSchema: EMPTY_OBJECT_SCHEMA },
				] as const;
			}

			const schema = generateJsonSchema(action.input);
			const schemaType = 'type' in schema ? schema.type : undefined;
			if (schemaType !== 'object' && schemaType !== undefined) {
				console.warn(
					`[MCP] Skipping tool "${toolName}": input has type "${schemaType}" but MCP requires "object". ` +
						`This action will still work via HTTP and TypeScript clients.`,
				);
				return undefined;
			}

			return [toolName, { action, inputSchema: schema }] as const;
		},
	);

	return new Map(entries.filter((e) => e !== undefined));
}

/**
 * Derives a semantic collection key from an MCP tool name for wrapping array responses.
 *
 * MCP protocol requires `structuredContent` to be an object, not an array. When an action
 * returns an array, we wrap it in an object with a semantically meaningful key derived from
 * the action name using deterministic transformation rules.
 *
 * @param mcpToolName - The full MCP tool name in format `${workspaceId}_${actionName}`
 * @returns A camelCase key for wrapping arrays, or "items" if derivation fails
 *
 * @example
 * deriveCollectionKey("pages_getPages")           // → "pages"
 * deriveCollectionKey("content_listArticles")     // → "articles"
 * deriveCollectionKey("users_fetchActiveUsers")   // → "activeUsers"
 * deriveCollectionKey("posts_searchByTag")        // → "byTag"
 * deriveCollectionKey("workspace_get")            // → "items" (empty after prefix removal)
 * deriveCollectionKey("invalid")                  // → "items" (no underscore separator)
 *
 * Transformation rules:
 * 1. Extract action name by taking everything after the last underscore
 * 2. Remove common query verb prefixes: get, list, fetch, find, search, query
 * 3. Convert first character to lowercase for camelCase convention
 * 4. Return "items" as fallback for edge cases (no action name or empty result)
 */
function deriveCollectionKey(mcpToolName: string): string {
	const DEFAULT_KEY = 'items';

	// Extract action name after workspace prefix (e.g., "pages_getPages" → "getPages")
	const actionName = mcpToolName.split('_').pop();
	if (!actionName) return DEFAULT_KEY;

	// Remove common query/fetch verb prefixes
	const cleaned = actionName.replace(/^(get|list|fetch|find|search|query)/, '');
	if (!cleaned) return DEFAULT_KEY;

	// Lowercase first character
	return cleaned.charAt(0).toLowerCase() + cleaned.slice(1);
}
