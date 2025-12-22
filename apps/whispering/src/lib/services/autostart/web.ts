import { Ok } from 'wellcrafted/result';
import type { AutostartService } from './types';

/**
 * Web stub for autostart service.
 * Returns false/no-op since browsers don't support system autostart.
 */
export function createAutostartServiceWeb(): AutostartService {
	return {
		isEnabled: async () => Ok(false),
		enable: async () => Ok(undefined),
		disable: async () => Ok(undefined),
	};
}
