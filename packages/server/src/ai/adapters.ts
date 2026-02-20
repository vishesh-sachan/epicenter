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
 * Providers supported by the AI plugin.
 *
 * This is a string literal union — not derived from a runtime object — so
 * TypeScript narrows it properly in switch statements and discriminated checks.
 */
export type SupportedProvider =
	| 'openai'
	| 'anthropic'
	| 'gemini'
	| 'ollama'
	| 'grok';

export const SUPPORTED_PROVIDERS: SupportedProvider[] = [
	'openai',
	'anthropic',
	'gemini',
	'ollama',
	'grok',
];

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
 */
const ADAPTER_FACTORIES: Record<
	SupportedProvider,
	(model: string, apiKey: string) => AnyTextAdapter
> = {
	openai: (model, apiKey) => createOpenaiChat(model as OpenAIChatModel, apiKey),
	anthropic: (model, apiKey) =>
		createAnthropicChat(model as AnthropicChatModel, apiKey),
	gemini: (model, apiKey) => createGeminiChat(model as GeminiTextModel, apiKey),
	ollama: (model, _apiKey) => createOllamaChat(model),
	grok: (model, apiKey) => createGrokText(model as GrokChatModel, apiKey),
};

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
