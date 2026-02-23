import type { AnyTextAdapter } from '@tanstack/ai';
import {
	type AnthropicChatModel,
	createAnthropicChat,
} from '@tanstack/ai-anthropic';
import { createGeminiChat, type GeminiTextModel } from '@tanstack/ai-gemini';
import { createGrokText, type GrokChatModel } from '@tanstack/ai-grok';
import { createOllamaChat } from '@tanstack/ai-ollama';
import { createOpenaiChat, type OpenAIChatModel } from '@tanstack/ai-openai';

/**
 * Factory functions for each supported provider.
 *
 * Uses the explicit-key variants (`createOpenaiChat`, `createAnthropicChat`, etc.)
 * instead of the env-auto-detect variants (`openaiText`, `anthropicText`) because
 * API keys are sent per-request from the client, not read from server env vars.
 *
 * Model names come from the client as arbitrary strings. Invalid model names
 * will fail at the provider API level with a descriptive error — they won't
 * crash the server.
 *
 * API key presence is validated by the plugin layer before calling `createAdapter`,
 * so factories receive a non-empty string for providers that require one.
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
	ollama: (model: string, _apiKey: string) => createOllamaChat(model),
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
	ollama: '', // no key needed
};

/**
 * Resolve an API key for the given provider.
 *
 * Priority: (1) per-request header key, (2) server env var, (3) undefined.
 * Reads env vars at request time (not module load) so they can change at runtime.
 */
export function resolveApiKey(
	provider: SupportedProvider,
	headerKey?: string,
): string | undefined {
	if (headerKey) return headerKey;
	const envVarName = PROVIDER_ENV_VARS[provider];
	if (envVarName) return process.env[envVarName];
	return undefined;
}
