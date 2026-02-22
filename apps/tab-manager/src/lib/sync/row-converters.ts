/**
 * Row converters for transforming Browser API objects to schema rows.
 *
 * These pure functions convert `chrome.tabs.Tab`, `chrome.windows.Window`,
 * and `chrome.tabGroups.TabGroup` into their Yjs table row equivalents.
 */

import {
	createGroupCompositeId,
	createTabCompositeId,
	createWindowCompositeId,
	TAB_ID_NONE,
	type Tab,
	type TabGroup,
	type Window,
} from '$lib/workspace';

// ─────────────────────────────────────────────────────────────────────────────
// Row Converters (Browser API → Schema Row)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Convert a browser tab to a schema row.
 *
 * Returns `null` if the tab has no usable ID — either `undefined` (foreign
 * tabs from the sessions API) or `-1` (`TAB_ID_NONE`, e.g. devtools windows).
 * Tabs without real IDs can't be activated, closed, or stored with a
 * composite key.
 *
 * @example
 * ```typescript
 * const row = tabToRow(deviceId, tab);
 * if (row) tables.tabs.set(row);
 * ```
 */
export function tabToRow(deviceId: string, tab: Browser.tabs.Tab): Tab | null {
	// tab.id is undefined for foreign tabs (sessions API) and TAB_ID_NONE (-1)
	// for non-browser tabs like devtools windows.
	if (tab.id === undefined || tab.id === TAB_ID_NONE) return null;

	const { id, windowId, groupId, openerTabId, selected, ...rest } = tab;
	return {
		...rest,
		id: createTabCompositeId(deviceId, id),
		deviceId,
		tabId: id,
		windowId: createWindowCompositeId(deviceId, windowId),
		// createGroupCompositeId returns undefined for -1 (TAB_GROUP_ID_NONE)
		groupId: createGroupCompositeId(deviceId, groupId),
		// openerTabId is absent/undefined when no opener exists (never -1)
		openerTabId:
			openerTabId !== undefined
				? createTabCompositeId(deviceId, openerTabId)
				: undefined,
		_v: 1,
	};
}

/**
 * Convert a browser window to a schema row.
 *
 * Returns `null` if the window has no ID.
 *
 * @example
 * ```typescript
 * const row = windowToRow(deviceId, window);
 * if (row) tables.windows.set(row);
 * ```
 */
export function windowToRow(
	deviceId: string,
	window: Browser.windows.Window,
): Window | null {
	if (window.id === undefined) return null;

	const { id, tabs: _tabs, ...rest } = window;
	return {
		...rest,
		id: createWindowCompositeId(deviceId, id),
		deviceId,
		windowId: id,
		_v: 1,
	};
}

/**
 * Convert a browser tab group to a schema row.
 *
 * Note: A `TabGroup` object always has a valid `id` (never
 * `TAB_GROUP_ID_NONE`). The `-1` sentinel only appears on
 * `Tab.groupId` for ungrouped tabs, not on group objects themselves.
 *
 * @example
 * ```typescript
 * const row = tabGroupToRow(deviceId, group);
 * tables.tabGroups.set(row);
 * ```
 */
export function tabGroupToRow(
	deviceId: string,
	group: Browser.tabGroups.TabGroup,
): TabGroup {
	const { id, windowId, ...rest } = group;
	return {
		...rest,
		// biome-ignore lint/style/noNonNullAssertion: TabGroup.id can't be TAB_GROUP_ID_NONE per spec — https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/tabGroups/TabGroup
		id: createGroupCompositeId(deviceId, id)!,
		deviceId,
		groupId: id,
		windowId: createWindowCompositeId(deviceId, windowId),
		_v: 1,
	};
}
