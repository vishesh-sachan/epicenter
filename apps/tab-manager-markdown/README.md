# Tab Manager Markdown Exporter

A standalone sync client that connects to the Epicenter sync server and exports tab-manager's browser tab state to markdown files in real-time.

## What This Does

This app acts as a **peer client** alongside the tab-manager browser extension:

```
┌─────────────────────┐
│   Tab Manager       │  Browser Extension (Client 1)
│                     │
│  • Reads browser    │
│  • Writes to Y.Doc  │
└──────────┬──────────┘
           │
           │ ws://localhost:3913/workspaces/tab-manager/sync
           │
           ▼
┌─────────────────────┐
│   Sync Server       │  Holds authoritative Y.Doc in memory
│   (packages/server) │
└──────────┬──────────┘
           │
           │ ws://localhost:3913/workspaces/tab-manager/sync
           │
           ▼
┌─────────────────────┐
│ Markdown Exporter   │  Peer Client (Client 2 - THIS APP)
│                     │
│  • Reads Y.Doc      │
│  • Writes markdown  │
│  • ONE-WAY sync     │
└─────────────────────┘
```

**Key Features:**
- 📝 **One markdown file per device** with all tabs, windows, and groups
- 🔄 **Real-time updates** - markdown files update as you browse
- 📊 **Structured data + human-readable summary** - JSON payload + formatted view
- ⚡ **Debounced writes** - batches rapid tab changes (1-second delay)
- ↘️ **One-way sync** - Y.Doc → Markdown only (read-only export, no bidirectional complexity)

## Installation

```bash
cd apps/tab-manager-markdown
bun install
```

## Usage

### Starting the Stack

You need three things running:

**Terminal 1: Start sync server**
```bash
cd packages/server
bun run dev-server.ts
```

You should see:
```
Starting tab-manager sync server...

✓ Server running on http://localhost:3913
✓ Sync endpoint: ws://localhost:3913/workspaces/tab-manager/sync

Press Ctrl+C to stop
```

**Terminal 2: Load tab-manager browser extension**

1. Open Chrome or Firefox
2. Go to `chrome://extensions` (or `about:debugging#/runtime/this-firefox` for Firefox)
3. Enable "Developer mode"
4. Click "Load unpacked" (Chrome) or "Load Temporary Add-on" (Firefox)
5. Select `apps/tab-manager/.output/chrome-mv3` (or `firefox-mv3`)

The extension auto-connects to `ws://localhost:3913` and starts syncing browser tabs.

**Terminal 3: Start markdown exporter**
```bash
cd apps/tab-manager-markdown
bun run dev
```

You should see:
```
Tab Manager Markdown Exporter starting...
✓ Connected to sync server at ws://localhost:3913
✓ Workspace: tab-manager
✓ Listening for tab changes...
✓ Exporting to ./markdown/devices/
```

Now open/close/move tabs in your browser and watch `markdown/devices/*.md` files update automatically!

### Stopping

Press `Ctrl+C` in the markdown exporter terminal. It will flush any pending writes before exiting:

```
^C

Shutting down...
Exporting markdown files...
✓ Exported 2 devices
✓ Graceful shutdown complete
```

## Output Format

Markdown files are created at `markdown/devices/<deviceId>.md`:

```markdown
# Device: Chrome on MacBook Pro

**Device ID:** `xK2mP9qL`  
**Browser:** chrome  
**Last Seen:** 2026-02-18T17:15:30Z

---

## Data

\`\`\`json
{
  "device": { ... },
  "windows": [ ... ],
  "tabs": [ ... ],
  "tabGroups": [ ... ]
}
\`\`\`

---

## Summary

### Windows (2)

**Window 1** (focused)
- 5 tabs

**Window 2**
- 3 tabs

### Tabs (8)

1. **[Epicenter - GitHub](https://github.com/EpicenterHQ/epicenter)** (active, pinned)
2. **[TypeScript Handbook](https://www.typescriptlang.org/docs/handbook/intro.html)**
3. **[Yjs Documentation](https://docs.yjs.dev/)**
...

### Tab Groups (1)

**Work** (blue)
- 4 tabs

---

**Exported:** 2026-02-18T17:22:45Z
```

## How It Works

1. **Tab-manager browser extension** reads browser tabs and writes to Y.Doc
2. **Sync server** holds the authoritative Y.Doc in memory and relays updates
3. **This markdown exporter** connects as a peer client, observes Y.Doc changes, and exports markdown files
4. **Debouncing** batches rapid changes (1-second delay after last update before writing)
5. **Graceful shutdown** flushes pending writes when you press Ctrl+C

## Architecture

### Sync Model

The sync server holds the **authoritative Y.Doc** (the single source of truth). All clients (browser extension, markdown exporter) connect to it and sync their changes through it.

```
Browser tabs → Y.Doc (in browser) → Sync Server (holds master Y.Doc) → Markdown Exporter → Files
```

### ONE-WAY Sync

Markdown files are **read-only exports**. If you edit them manually, changes won't sync back to the browser. This is intentional:
- ✅ Simple, predictable behavior
- ✅ No risk of infinite loops
- ✅ No conflict resolution needed
- ✅ Deterministic output (markdown always reflects Y.Doc state)

If bidirectional sync is needed in the future, it can be added as a v2 feature.

## Troubleshooting

### "Cannot connect to sync server"

**Problem:** Markdown exporter can't connect to `ws://localhost:3913`

**Solution:** 
1. Check that `packages/server` is running
2. Verify it's listening on port 3913
3. Check for firewall blocking localhost connections

### "No devices found" / Empty markdown directory

**Problem:** Markdown files aren't being created

**Solution:**
1. Check that tab-manager browser extension is installed and running
2. Open the extension's side panel to verify it's syncing
3. Look for browser console errors in the extension
4. Restart the markdown exporter

### "Exporting too frequently"

**Problem:** Markdown files update too often, causing disk thrashing

**Solution:** The 1-second debounce should handle this. If it's still an issue, you can:
1. Increase `debounceMs` in `src/index.ts` (change from 1000 to 2000 or higher)
2. Check if you have an extension causing rapid tab updates

### Type errors when running

**Problem:** TypeScript errors about missing modules or types

**Solution:**
```bash
cd apps/tab-manager-markdown
bun install  # Reinstall dependencies
bun run typecheck  # Verify types
```

## Development

### Project Structure

```
apps/tab-manager-markdown/
├── src/
│   ├── index.ts       # Main: Connect to sync server + observe Y.Doc
│   └── exporter.ts    # Logic: Rows → Markdown serialization
├── markdown/
│   └── devices/       # Output: One .md file per device
├── package.json
├── tsconfig.json
└── README.md
```

### Modifying Export Format

Edit `src/exporter.ts`:

- `generateMarkdown()` - Overall file structure
- `generateSummary()` - Human-readable summary section

### Changing Debounce Delay

Edit `src/index.ts`:

```typescript
const exporter = createExporter({
	outputDir: './markdown/devices',
	debounceMs: 2000, // Change from 1000 to 2000 (2 seconds)
});
```

## Roadmap

Future enhancements:

- [ ] **Incremental writes** - Only write changed device files (not all devices every time)
- [ ] **Device cleanup** - Remove markdown files for devices no longer in Y.Doc
- [ ] **Custom output formats** - Support JSON-only, YAML frontmatter, different templates
- [ ] **Filtering** - Export only specific devices or tables
- [ ] **Statistics dashboard** - Track export counts, file sizes, last export times
- [ ] **Bidirectional sync** - Parse markdown changes and sync back to Y.Doc (v2 feature)

## Related

- [Tab Manager](../tab-manager/) - Browser extension this app syncs with
- [Sync Server](../../packages/server/) - WebSocket server holding authoritative Y.Doc
- [Sync Client](../../packages/sync/) - Y.Doc sync provider used by this app

## License

AGPL-3.0
