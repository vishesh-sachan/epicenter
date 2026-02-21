/**
 * Unified extensions export for Epicenter (Node.js/Bun only).
 *
 * Exports persistence extensions and utilities. For browser persistence,
 * use the conditional export:
 *
 * ```typescript
 * import { indexeddbPersistence } from '@epicenter/hq/extensions/sync/web';
 * ```
 *
 * @example Node.js/Bun usage
 * ```typescript
 * import { persistence } from '@epicenter/hq/extensions';
 * ```
 *
 * @packageDocumentation
 */

// ═══════════════════════════════════════════════════════════════════════════════
// PERSISTENCE (Desktop/Node.js only)
// ═══════════════════════════════════════════════════════════════════════════════

export {
	type PersistenceConfig,
	persistence,
} from './sync/desktop.js';
export { indexeddbPersistence as webPersistence } from './sync/web.js';

// ═══════════════════════════════════════════════════════════════════════════════
// ERROR LOGGING (Utility)
// ═══════════════════════════════════════════════════════════════════════════════

export { createIndexLogger } from './error-logger.js';
