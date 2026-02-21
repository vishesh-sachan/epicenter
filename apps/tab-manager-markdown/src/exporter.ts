/**
 * Markdown generation for tab-manager data.
 *
 * Pure functions that convert tab-manager tables into markdown files.
 * One file per device with structured JSON + human-readable summary.
 */

import type {
	Device,
	Tab,
	TabGroup,
	Window,
} from '@epicenter/tab-manager/workspace';

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

export function generateMarkdown({
	device,
	windows,
	tabs,
	tabGroups,
}: DeviceData): string {
	// Generate structured JSON payload (sorted keys for stable diffs)
	const jsonPayload = JSON.stringify(
		{ device, windows, tabs, tabGroups },
		null,
		2,
	);

	// Generate human-readable summary
	const summary = generateSummary({ device, windows, tabs, tabGroups });

	return `# Device: ${device.name}

**Device ID:** \`${device.id}\`  
**Browser:** ${device.browser}  
**Last Seen:** ${device.lastSeen}

---

## Data

\`\`\`json
${jsonPayload}
\`\`\`

---

${summary}

---

**Exported:** ${new Date().toISOString()}
`;
}

function generateSummary(data: DeviceData): string {
	const { windows, tabs, tabGroups } = data;

	let summary = `## Summary\n\n`;

	// Windows summary
	summary += `### Windows (${windows.length})\n\n`;
	if (windows.length === 0) {
		summary += `_No windows_\n\n`;
	} else {
		for (const window of windows) {
			const windowTabs = tabs.filter((t) => t.windowId === window.id);
			summary += `**Window ${window.windowId}**${window.focused ? ' (focused)' : ''}\n`;
			summary += `- ${windowTabs.length} tab${windowTabs.length === 1 ? '' : 's'}\n\n`;
		}
	}

	// Tabs summary
	summary += `### Tabs (${tabs.length})\n\n`;
	if (tabs.length === 0) {
		summary += `_No tabs_\n\n`;
	} else {
		const sortedTabs = [...tabs].sort((a, b) => a.index - b.index);
		for (const tab of sortedTabs) {
			const flags = [];
			if (tab.active) flags.push('active');
			if (tab.pinned) flags.push('pinned');
			if (tab.incognito) flags.push('incognito');
			const flagStr = flags.length ? ` (${flags.join(', ')})` : '';

			const title = tab.title || 'Untitled';
			const url = tab.url || '#';

			summary += `${tab.index + 1}. **[${title}](${url})**${flagStr}\n`;
		}
		summary += '\n';
	}

	// Tab groups summary
	summary += `### Tab Groups (${tabGroups.length})\n\n`;
	if (tabGroups.length === 0) {
		summary += `_No tab groups_\n`;
	} else {
		for (const group of tabGroups) {
			const groupTabs = tabs.filter((t) => t.groupId === group.id);
			const title = group.title || 'Untitled Group';
			summary += `**${title}** (${group.color})${group.collapsed ? ' [collapsed]' : ''}\n`;
			summary += `- ${groupTabs.length} tab${groupTabs.length === 1 ? '' : 's'}\n\n`;
		}
	}

	return summary;
}
