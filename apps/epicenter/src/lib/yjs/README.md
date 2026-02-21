# Workspace YJS Layer

Bridges workspace templates (Static API definitions) with Y.Doc persistence.

## Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                     WORKSPACE ARCHITECTURE                                   │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│   ┌──────────────────────┐          ┌──────────────────────┐               │
│   │  METADATA (JSON)     │          │    WORKSPACE DOC     │               │
│   │  {id, name, icon}    │          │    (Y.Doc data)      │               │
│   └──────────────────────┘          └──────────────────────┘               │
│           │                                  │                              │
│           ▼                                  ▼                              │
│     {id}/definition.json             {id}/workspace.yjs                     │
│                                                                             │
│   ┌──────────────────────┐                                                 │
│   │  SCHEMA (Code)       │                                                 │
│   │  defineTable(type()) │                                                 │
│   └──────────────────────┘                                                 │
│           │                                                                 │
│           ▼                                                                 │
│     $lib/templates/*.ts                                                     │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Storage Layout

```
{appLocalDataDir}/workspaces/
├── epicenter.whispering/
│   ├── definition.json              # Display metadata (name, description, icon)
│   └── workspace.yjs               # Y.Doc binary (source of truth)
└── epicenter.entries/
    ├── definition.json
    └── workspace.yjs
```

## Definition JSON Format

`{workspaceId}/definition.json` stores display metadata only (schemas are in code):

```json
{
	"id": "epicenter.whispering",
	"name": "Whispering",
	"description": "",
	"icon": null
}
```

## Y.Doc Structure

```typescript
// Y.Doc guid: workspace.id
// gc: true (for efficient YKeyValueLww storage)

// Table data (rows as LWW entries)
Y.Array('table:recordings');
Y.Array('table:entries');

// Workspace-level key-values
Y.Array('kv');
```

## API Usage

### Loading a Workspace

```typescript
import { getWorkspace } from '$lib/workspaces/dynamic/service';
import { createWorkspaceClient } from '$lib/yjs/workspace';

// 1. Load metadata from JSON file (for display: name, icon)
const definition = await getWorkspace(workspaceId);
if (!definition) throw new Error('Workspace not found');

// 2. Create workspace client (looks up Static definition from template registry)
const client = createWorkspaceClient(workspaceId);
await client.whenReady;

// 3. Use the client (property access, not .get())
client.tables.recordings.set({ id: '1', title: 'Hello', ... });
```

### Creating a Workspace

```typescript
import { createWorkspaceDefinition } from '$lib/workspaces/dynamic/service';

const definition = await createWorkspaceDefinition({
	id: 'epicenter.whispering',
	name: 'Whispering',
	description: '',
	icon: null,
});
```

## File Structure

```
$lib/
├── templates/
│   ├── index.ts                     # Template registry
│   ├── whispering.ts                # Whispering workspace (defineTable + defineWorkspace)
│   └── entries.ts                   # Entries workspace
├── yjs/
│   ├── README.md                    # This file
│   ├── workspace.ts                 # Creates workspace client from template registry
│   └── workspace-persistence.ts     # Y.Doc persistence extension
└── workspaces/
    └── dynamic/
        ├── service.ts               # CRUD operations for definition JSON files
        └── queries.ts               # TanStack Query wrappers
```

## Key Decisions

### GC Setting

Uses `gc: true` for efficient YKeyValueLww storage:

- Tombstones from updates get merged into tiny metadata
- 200-1000x smaller than Y.Map for update-heavy data
- Trade-off: No snapshot/time-travel capability

See `docs/articles/ykeyvalue-gc-the-hidden-variable.md` for details.

### Schema in Code, Metadata on Disk

Workspace schemas (table definitions, field types) live in TypeScript code
via `defineTable()` and `defineWorkspace()` from the Static API. Only display
metadata (name, description, icon) is stored as JSON on disk. This keeps
schemas type-safe and avoids runtime parsing of schema definitions.
