import type { AnyTextAdapter } from '@tanstack/ai';
import {
	type AnthropicChatModel,
	createAnthropicChat,
} from '@tanstack/ai-anthropic';
import { createGeminiChat, type GeminiTextModel } from '@tanstack/ai-gemini';
import { createGrokText, type GrokChatModel } from '@tanstack/ai-grok';
import { createOpenaiChat, type OpenAIChatModel } from '@tanstack/ai-openai';
import type { KeyStore } from '../keys/store';

/**
 * Factory functions for each supported provider.
 *
 * Uses the explicit-key variants (`createOpenaiChat`, `createAnthropicChat`, etc.)
 * instead of the env-auto-detect variants (`openaiText`, `anthropicText`) because
 * API keys are resolved server-side from the encrypted key store or env vars,
 * not auto-detected from conventional env var names.
 *
 * Model names come from the client as arbitrary strings. Invalid model names
 * will fail at the provider API level with a descriptive error — they won't
 * crash the server.
 *
 * API key presence is validated by the plugin layer before calling `createAdapter`,
 * so factories receive a non-empty string.
 *
 * `SupportedProvider` and `SUPPORTED_PROVIDERS` are derived from this object —
 * adding or removing a provider here automatically updates the type and array.
 */
const ADAPTER_FACTORIES = {
	openai: (model: string, apiKey: string) =>
		createOpenaiChat(model as OpenAIChatModel, apiKey),
	anthropic: (model: string, apiKey: string) =>
		createAnthropicChat(model as AnthropicChatModel, apiKey),
	gemini: (model: string, apiKey: string) =>
		createGeminiChat(model as GeminiTextModel, apiKey),
	grok: (model: string, apiKey: string) =>
		createGrokText(model as GrokChatModel, apiKey),
} as const satisfies Record<
	string,
	(model: string, apiKey: string) => AnyTextAdapter
>;

/**
 * Providers supported by the AI plugin.
 *
 * Derived from `ADAPTER_FACTORIES` — not manually maintained.
 * Adding a new provider factory automatically extends this type.
 */
export type SupportedProvider = keyof typeof ADAPTER_FACTORIES;

export const SUPPORTED_PROVIDERS = Object.keys(
	ADAPTER_FACTORIES,
) as SupportedProvider[];

/**
 * Create a TanStack AI text adapter for the given provider.
 *
 * @returns The adapter instance, or `undefined` if the provider is not supported.
 */
export function createAdapter(
	provider: string,
	model: string,
	apiKey: string = '',
): AnyTextAdapter | undefined {
	if (!isSupportedProvider(provider)) return undefined;
	return ADAPTER_FACTORIES[provider](model, apiKey);
}

/** Type guard for narrowing an arbitrary string to a known provider. */
export function isSupportedProvider(
	provider: string,
): provider is SupportedProvider {
	return SUPPORTED_PROVIDERS.includes(provider as SupportedProvider);
}

/** Environment variable names for each provider's API key. */
export const PROVIDER_ENV_VARS: Record<SupportedProvider, string> = {
	openai: 'OPENAI_API_KEY',
	anthropic: 'ANTHROPIC_API_KEY',
	gemini: 'GEMINI_API_KEY',
	grok: 'GROK_API_KEY',
};

/**
 * Resolve an API key for the given provider.
 *
 * Resolution chain:
 * 1. Per-request header key (x-provider-api-key)
 * 2. Server key store (encrypted, if provided)
 * 3. Server environment variable
 * 4. undefined (triggers 401)
 *
 * Every supported provider requires an API key. The key store is async
 * because it decrypts from disk. When no store is configured, this
 * falls through to env vars synchronously.
 *
 * @param provider - The provider to resolve a key for
 * @param headerKey - Key from the x-provider-api-key request header
 * @param keyStore - Optional encrypted key store (hub server)
 */
export async function resolveApiKey(
	provider: SupportedProvider,
	headerKey?: string,
	keyStore?: KeyStore,
): Promise<string | undefined> {
	// 1. Per-request header (highest priority, backward compat)
	if (headerKey) return headerKey;

	// 2. Server key store (hub server)
	if (keyStore) {
		const storeKey = await keyStore.get(provider);
		if (storeKey) return storeKey;
	}

	// 3. Environment variable
	const envVarName = PROVIDER_ENV_VARS[provider];
	if (envVarName) return process.env[envVarName];

	return undefined;
}
