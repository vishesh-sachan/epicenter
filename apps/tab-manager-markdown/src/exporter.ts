/**
 * Markdown generation for tab-manager data.
 *
 * Pure functions that convert tab-manager tables into clean Markdown files
 * with YAML frontmatter. One file per device, tabs grouped by window in tables.
 *
 * Uses Bun's built-in `Bun.YAML.stringify()` for frontmatter serialization.
 */

import type {
	Device,
	Tab,
	TabGroup,
	Window,
} from '@epicenter/tab-manager/workspace';
import { YAML } from 'bun';

export type TableHelper<TRow> = {
	getAllValid(): TRow[];
	filter(predicate: (row: TRow) => boolean): TRow[];
};

export type Tables = {
	devices: TableHelper<Device>;
	tabs: TableHelper<Tab>;
	windows: TableHelper<Window>;
	tabGroups: TableHelper<TabGroup>;
};

export type DeviceData = {
	device: Device;
	windows: Window[];
	tabs: Tab[];
	tabGroups: TabGroup[];
};

/**
 * Generate a clean Markdown file for a device.
 *
 * Output format:
 * - YAML frontmatter with device metadata and counts
 * - Markdown body with tabs grouped by window in tables
 * - Tab groups summary at the bottom
 *
 * @example
 * ```markdown
 * ---
 * id: xK2mP9qL
 * name: Chrome on MacBook Pro
 * browser: chrome
 * lastSeen: "2026-02-18T17:15:30Z"
 * exported: "2026-02-18T17:22:45Z"
 * windows: 2
 * tabs: 8
 * tabGroups: 1
 * ---
 *
 * # Chrome on MacBook Pro
 *
 * ## Window 1 (focused)
 *
 * | # | Title | URL | Flags |
 * |---|-------|-----|-------|
 * | 1 | Epicenter | https://github.com/... | active, pinned |
 * ```
 */
export function generateMarkdown({
	device,
	windows,
	tabs,
	tabGroups,
}: DeviceData): string {
	const frontmatter = YAML.stringify(
		{
			id: device.id,
			name: device.name,
			browser: device.browser,
			lastSeen: device.lastSeen,
			exported: new Date().toISOString(),
			windows: windows.length,
			tabs: tabs.length,
			tabGroups: tabGroups.length,
		},
		null,
		2,
	);

	let body = `# ${device.name}\n`;

	// Tabs grouped by window
	if (windows.length === 0) {
		body += '\n_No windows_\n';
	} else {
		for (const window of windows) {
			const windowTabs = tabs
				.filter((t) => t.windowId === window.id)
				.sort((a, b) => a.index - b.index);

			const focusedLabel = window.focused ? ' (focused)' : '';
			body += `\n## Window ${window.windowId}${focusedLabel}\n\n`;

			if (windowTabs.length === 0) {
				body += '_No tabs_\n';
			} else {
				body += '| # | Title | URL | Flags |\n';
				body += '|---|-------|-----|-------|\n';
				for (const tab of windowTabs) {
					const flags = [];
					if (tab.active) flags.push('active');
					if (tab.pinned) flags.push('pinned');
					if (tab.incognito) flags.push('incognito');

					const title = escapeTableCell(tab.title || 'Untitled');
					const url = tab.url || '';
					const flagStr = flags.join(', ');

					body += `| ${tab.index + 1} | ${title} | ${url} | ${flagStr} |\n`;
				}
			}
		}
	}

	// Tab groups summary
	if (tabGroups.length > 0) {
		body += '\n## Tab Groups\n\n';
		for (const group of tabGroups) {
			const groupTabCount = tabs.filter((t) => t.groupId === group.id).length;
			const title = group.title || 'Untitled Group';
			const collapsed = group.collapsed ? ', collapsed' : '';
			body += `**${escapeTableCell(title)}** (${group.color}${collapsed}) - ${groupTabCount} tab${groupTabCount === 1 ? '' : 's'}\n`;
		}
	}

	return `---\n${frontmatter}---\n\n${body}`;
}

/** Escape pipe characters in Markdown table cells. */
function escapeTableCell(text: string): string {
	return text.replace(/\|/g, '\\|');
}
