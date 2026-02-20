/**
 * AI plugin public API.
 *
 * This is the entry point for `@epicenter/server/ai`.
 */

export {
	createAdapter,
	SUPPORTED_PROVIDERS,
	type SupportedProvider,
} from './adapters';
export { type AIPluginConfig, createAIPlugin } from './plugin';
