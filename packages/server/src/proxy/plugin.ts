import { Elysia } from 'elysia';
import { isSupportedProvider, type SupportedProvider } from '../ai/adapters';
import type { KeyStore } from '../keys/store';

/**
 * Provider API base URLs.
 *
 * Maps each supported provider to its real API endpoint.
 * OpenCode sends requests to `/proxy/{provider}/*` on the hub,
 * and the hub forwards them to these URLs with the real API key.
 */
const PROVIDER_BASE_URLS: Partial<Record<SupportedProvider, string>> = {
	openai: 'https://api.openai.com',
	anthropic: 'https://api.anthropic.com',
	gemini: 'https://generativelanguage.googleapis.com',
	grok: 'https://api.x.ai',
};

export type ProxyPluginConfig = {
	/**
	 * Key store for resolving real API keys.
	 *
	 * The proxy reads the real API key from the store and injects it
	 * into the forwarded request, replacing the session token.
	 */
	keyStore: KeyStore;

	/**
	 * Session validator function.
	 *
	 * Validates the Authorization header (which carries a session token,
	 * not an API key) before proxying the request.
	 *
	 * If not provided, the proxy does no auth validation (development only).
	 */
	validateSession?: (token: string) => Promise<{ valid: boolean }>;
};

/**
 * Create an Elysia plugin that provides provider-compatible reverse proxy endpoints.
 *
 * The proxy allows OpenCode instances to call LLM providers through the hub
 * without having direct access to API keys. OpenCode sends requests to
 * `{hubUrl}/proxy/{provider}/...` with a session token as the Authorization header.
 * The hub validates the session, resolves the real API key from the encrypted
 * store, and forwards the request unchanged to the real provider API.
 *
 * This is ~30 lines of proxy code per provider. No request parsing needed.
 *
 * Registers routes:
 *
 * | Method | Route                    | Description                        |
 * | ------ | ------------------------ | ---------------------------------- |
 * | `ALL`  | `/proxy/:provider/*`     | Reverse proxy to provider API      |
 *
 * @example
 * ```typescript
 * const store = createKeyStore();
 * const app = new Elysia()
 *   .use(createProxyPlugin({ keyStore: store }));
 *
 * // OpenCode calls: POST /proxy/anthropic/v1/messages
 * // Hub: validates session → resolves anthropic key → forwards to api.anthropic.com/v1/messages
 * ```
 */
export function createProxyPlugin(config: ProxyPluginConfig) {
	const { keyStore, validateSession } = config;

	return new Elysia({ prefix: '/proxy' }).all(
		'/:provider/*',
		async ({ params, request, status }) => {
			const provider = params.provider;
			const path = params['*'];

			// Validate provider
			if (!isSupportedProvider(provider)) {
				return status('Bad Request', `Unsupported provider: ${provider}`);
			}

			const baseUrl = PROVIDER_BASE_URLS[provider];
			if (!baseUrl) {
				return status(
					'Bad Request',
					`Provider ${provider} does not support proxying (no external API)`,
				);
			}

			// Validate session token from Authorization header
			if (validateSession) {
				const authHeader = request.headers.get('authorization');
				const token = authHeader?.startsWith('Bearer ')
					? authHeader.slice(7)
					: undefined;

				if (!token) {
					return status('Unauthorized', 'Bearer token required');
				}

				const result = await validateSession(token);
				if (!result.valid) {
					return status('Unauthorized', 'Invalid session token');
				}
			}

			// Resolve the real API key from the encrypted store
			const apiKey = await keyStore.get(provider);
			if (!apiKey) {
				return status(
					'Bad Gateway',
					`No API key configured for ${provider}. Add one via PUT /api/provider-keys/${provider}`,
				);
			}

			// Build the forwarded request to the real provider API
			const targetUrl = `${baseUrl}/${path}`;

			// Clone headers, replacing Authorization with the real API key.
			// Different providers use different header formats:
			const forwardHeaders = new Headers(request.headers);

			// Remove the session token — it's not a valid API key
			forwardHeaders.delete('authorization');

			// Set the real API key in the provider-specific format
			if (provider === 'anthropic') {
				forwardHeaders.set('x-api-key', apiKey);
			} else {
				forwardHeaders.set('Authorization', `Bearer ${apiKey}`);
			}

			// Remove host header (will be set by fetch for the target domain)
			forwardHeaders.delete('host');

			// Forward the request unchanged
			const proxyResponse = await fetch(targetUrl, {
				method: request.method,
				headers: forwardHeaders,
				body: request.body,
				
				
			});

			// Stream the response back to OpenCode
			return new Response(proxyResponse.body, {
				status: proxyResponse.status,
				statusText: proxyResponse.statusText,
				headers: proxyResponse.headers,
			});
		},
	);
}
