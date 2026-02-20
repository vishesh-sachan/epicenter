import { createAnthropicChat } from '@tanstack/ai-anthropic';
import { createGeminiChat } from '@tanstack/ai-gemini';
import { createGrokText } from '@tanstack/ai-grok';
import { createOllamaChat } from '@tanstack/ai-ollama';
import { createOpenaiChat } from '@tanstack/ai-openai';

type AnyModel = Parameters<typeof createOpenaiChat>[0];

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
	string,
	(model: string, apiKey: string) => unknown
> = {
	openai: (model, apiKey) => createOpenaiChat(model as AnyModel, apiKey),
	anthropic: (model, apiKey) =>
		createAnthropicChat(
			model as Parameters<typeof createAnthropicChat>[0],
			apiKey,
		),
	gemini: (model, apiKey) =>
		createGeminiChat(model as Parameters<typeof createGeminiChat>[0], apiKey),
	ollama: (model, _apiKey) => createOllamaChat(model),
	grok: (model, apiKey) =>
		createGrokText(model as Parameters<typeof createGrokText>[0], apiKey),
};

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
) {
	const factory = ADAPTER_FACTORIES[provider as SupportedProvider];
	if (!factory) return undefined;
	return factory(model, apiKey);
}
