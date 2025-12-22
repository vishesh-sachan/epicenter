import { createAutostartServiceDesktop } from './desktop';
import { createAutostartServiceWeb } from './web';

export type { AutostartService, AutostartServiceError } from './types';

export const AutostartServiceLive = window.__TAURI_INTERNALS__
	? createAutostartServiceDesktop()
	: createAutostartServiceWeb();
