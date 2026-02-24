/**
 * Server-side read tool implementations.
 *
 * Each tool queries the tab-manager Y.Doc tables directly. Instant,
 * cross-device global view — no command queue needed.
 *
 * @see specs/20260223T200500-ai-tools-command-queue.md
 */

import { createTables } from '@epicenter/hq';
import { definition } from '@epicenter/tab-manager/workspace';
import type * as Y from 'yjs';
import {
	countByDomainDef,
	listDevicesDef,
	listTabsDef,
	listWindowsDef,
	searchTabsDef,
} from './definitions';

/**
 * Create server-side read tools bound to a Y.Doc.
 *
 * Uses `createTables()` to bind the tab-manager table definitions to the
 * given doc. Each tool queries tables directly — no Chrome APIs needed.
 *
 * @param doc - The tab-manager Y.Doc (from the sync plugin's dynamicDocs)
 * @returns Array of server tools ready for `chat({ tools })`
 */
export function createReadTools(doc: Y.Doc) {
	// biome-ignore lint/style/noNonNullAssertion: tab-manager definition always has tables
	const tables = createTables(doc, definition.tables!);

	return [
		searchTabsDef.server(async ({ query, deviceId }) => {
			const lower = query.toLowerCase();
			const tabs = tables.tabs.filter((tab) => {
				if (deviceId && tab.deviceId !== deviceId) return false;
				const title = tab.title?.toLowerCase() ?? '';
				const url = tab.url?.toLowerCase() ?? '';
				return title.includes(lower) || url.includes(lower);
			});
			return {
				results: tabs.map((tab) => ({
					id: tab.id,
					deviceId: tab.deviceId,
					windowId: tab.windowId,
					title: tab.title ?? '(untitled)',
					url: tab.url ?? '',
					active: tab.active,
					pinned: tab.pinned,
				})),
			};
		}),

		listTabsDef.server(async ({ deviceId, windowId }) => {
			const tabs = tables.tabs.filter((tab) => {
				if (deviceId && tab.deviceId !== deviceId) return false;
				if (windowId && tab.windowId !== windowId) return false;
				return true;
			});
			return {
				tabs: tabs.map((tab) => ({
					id: tab.id,
					deviceId: tab.deviceId,
					windowId: tab.windowId,
					title: tab.title ?? '(untitled)',
					url: tab.url ?? '',
					active: tab.active,
					pinned: tab.pinned,
					audible: tab.audible ?? false,
					muted: tab.mutedInfo?.muted ?? false,
					groupId: tab.groupId ?? null,
				})),
			};
		}),

		listWindowsDef.server(async ({ deviceId }) => {
			const windows = tables.windows.filter((w) => {
				if (deviceId && w.deviceId !== deviceId) return false;
				return true;
			});
			const allTabs = tables.tabs.getAllValid();
			return {
				windows: windows.map((w) => ({
					id: w.id,
					deviceId: w.deviceId,
					focused: w.focused,
					state: w.state ?? 'normal',
					type: w.type ?? 'normal',
					tabCount: allTabs.filter((t) => t.windowId === w.id).length,
				})),
			};
		}),

		listDevicesDef.server(async () => {
			const devices = tables.devices.getAllValid();
			return {
				devices: devices.map((d) => ({
					id: d.id,
					name: d.name,
					browser: d.browser,
					lastSeen: d.lastSeen,
				})),
			};
		}),

		countByDomainDef.server(async ({ deviceId }) => {
			const tabs = tables.tabs.filter((tab) => {
				if (deviceId && tab.deviceId !== deviceId) return false;
				return true;
			});
			const counts = new Map<string, number>();
			for (const tab of tabs) {
				if (!tab.url) continue;
				try {
					const domain = new URL(tab.url).hostname;
					counts.set(domain, (counts.get(domain) ?? 0) + 1);
				} catch {
					// Skip tabs with invalid URLs (e.g. chrome:// pages)
				}
			}
			const domains = Array.from(counts.entries())
				.map(([domain, count]) => ({ domain, count }))
				.sort((a, b) => b.count - a.count);
			return { domains };
		}),
	];
}
