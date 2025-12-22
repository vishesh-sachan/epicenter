# Blob Registry

The blob registry is a Y.Map in the Y.Doc that tracks which servers have which blobs. It enables leaderless blob discovery by syncing availability information via Yjs.

## Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         BLOB REGISTRY                                       │
└─────────────────────────────────────────────────────────────────────────────┘

  Y.Doc structure:

  ┌─────────────────────────────────────────────────────────────────────────┐
  │                                                                         │
  │   posts: Y.Map { ... }              ◄── Your data                      │
  │   users: Y.Map { ... }                                                  │
  │                                                                         │
  │   _blobRegistry: Y.Map {            ◄── Blob availability              │
  │     "sha256:abc123": {                                                  │
  │       holders: [                                                        │
  │         "ws://laptop-a.tailnet:3913/sync",                             │
  │         "ws://laptop-b.tailnet:3913/sync"                              │
  │       ],                                                                │
  │       size: 307200,                                                     │
  │       chunkCount: 3                                                     │
  │     }                                                                   │
  │   }                                                                     │
  │                                                                         │
  └─────────────────────────────────────────────────────────────────────────┘
```

## Registry Entry Structure

```typescript
type BlobRegistryEntry = {
	/** Server URLs that have this blob */
	holders: string[];
	/** Total blob size in bytes */
	size: number;
	/** Number of chunks */
	chunkCount: number;
};

// The registry is a Y.Map
type BlobRegistry = Y.Map<string, BlobRegistryEntry>;
```

## How It Syncs

The registry is just another Y.Map in the Y.Doc. It syncs automatically via Yjs:

```
  Laptop A stores blob
       │
       ▼
  _blobRegistry.set("sha256:abc", { holders: ["laptop-a"], ... })
       │
       ▼
  Y.Doc update generated
       │
       ├───────────────────────────► Laptop B receives update
       │                             Now knows: "laptop-a has sha256:abc"
       │
       └───────────────────────────► Phone receives update
                                     Now knows: "laptop-a has sha256:abc"
```

## Operations

### Adding a Holder

When a server stores a blob, it announces itself:

```typescript
function announceHaveBlob(
	registry: Y.Map<string, BlobRegistryEntry>,
	hash: string,
	meta: { size: number; chunkCount: number },
	myUrl: string,
): void {
	const entry = registry.get(hash);

	if (entry) {
		// Blob exists; add ourselves if not already listed
		if (!entry.holders.includes(myUrl)) {
			registry.set(hash, {
				...entry,
				holders: [...entry.holders, myUrl],
			});
		}
	} else {
		// New blob; create entry
		registry.set(hash, {
			holders: [myUrl],
			size: meta.size,
			chunkCount: meta.chunkCount,
		});
	}
}
```

### Removing a Holder

When a server deletes a blob, it removes itself:

```typescript
function announceDeletedBlob(
	registry: Y.Map<string, BlobRegistryEntry>,
	hash: string,
	myUrl: string,
): void {
	const entry = registry.get(hash);
	if (!entry) return;

	const newHolders = entry.holders.filter((h) => h !== myUrl);

	if (newHolders.length === 0) {
		// No holders left; remove entry
		registry.delete(hash);
	} else {
		// Update holders list
		registry.set(hash, { ...entry, holders: newHolders });
	}
}
```

### Finding Holders

When a device needs a blob:

```typescript
function findHolders(
	registry: Y.Map<string, BlobRegistryEntry>,
	hash: string,
): string[] {
	const entry = registry.get(hash);
	return entry?.holders ?? [];
}

// Usage
const holders = findHolders(blobRegistry, 'sha256:abc123');
// ["ws://laptop-a.tailnet:3913/sync", "ws://laptop-b.tailnet:3913/sync"]
```

## Auto-Fetch on BlobRef Detection

The BlobSyncProvider watches the Y.Doc for new BlobRefs:

```typescript
function observeYDocForBlobs(
	ydoc: Y.Doc,
	registry: Y.Map<string, BlobRegistryEntry>,
	contentStore: ContentStore,
): void {
	ydoc.on('update', async () => {
		// Scan all Y.Maps for BlobRef-shaped objects
		const blobRefs = findAllBlobRefs(ydoc);

		for (const ref of blobRefs) {
			const hasLocally = await contentStore.has(ref.hash);

			if (!hasLocally) {
				// Find holders and fetch
				const holders = findHolders(registry, ref.hash);
				if (holders.length > 0) {
					fetchBlobFromHolders(ref.hash, holders);
				}
			}
		}
	});
}
```

### Finding BlobRefs in Y.Doc

```typescript
function findAllBlobRefs(ydoc: Y.Doc): BlobRef[] {
	const refs: BlobRef[] = [];

	// Recursively scan all Y.Maps
	function scan(value: unknown): void {
		if (value instanceof Y.Map) {
			// Check if this looks like a BlobRef
			const hash = value.get('hash');
			if (typeof hash === 'string' && hash.startsWith('sha256:')) {
				refs.push({
					hash: hash as `sha256:${string}`,
					size: value.get('size') as number,
					mimeType: value.get('mimeType') as string,
					filename: value.get('filename') as string,
					chunkCount: value.get('chunkCount') as number,
				});
			}

			// Recurse into nested maps
			value.forEach(scan);
		} else if (value instanceof Y.Array) {
			value.forEach(scan);
		}
	}

	ydoc.share.forEach(scan);
	return refs;
}
```

## Replication

When a device fetches a blob, it becomes a new holder:

```
  BEFORE: holders = ["laptop-a"]

  Phone fetches from laptop-a
  Phone stores locally (but can't serve; no server)

  Laptop B fetches from laptop-a
  Laptop B stores locally
  Laptop B announces: holders += "laptop-b"

  AFTER: holders = ["laptop-a", "laptop-b"]
```

This creates **automatic replication**: blobs spread to servers as they're accessed.

## CRDT Properties

The registry inherits Yjs CRDT semantics:

### Concurrent Holder Addition

```
  Laptop A adds itself          Laptop B adds itself
       │                              │
       ▼                              ▼
  holders: ["a"]                holders: ["b"]
       │                              │
       └──────────► MERGE ◄───────────┘
                      │
                      ▼
              holders: ["a", "b"]   ✓ Both preserved
```

### Last-Writer-Wins for Entry Fields

If two devices update the same entry differently:

```
  Laptop A: { holders: ["a"], size: 100 }
  Laptop B: { holders: ["b"], size: 200 }

  Result: The entry with the latest Yjs timestamp wins
```

**Note**: This is why we use `holders: [...entry.holders, myUrl]` rather than replacing the array; it preserves existing holders.

## Stale Entries

If a server crashes without cleanup, stale entries remain. Handle gracefully:

```typescript
async function fetchBlob(hash: string): Promise<Blob | null> {
	const holders = findHolders(blobRegistry, hash);

	for (const holder of shuffle(holders)) {
		try {
			return await requestBlobFrom(holder, hash);
		} catch {
			// Holder unreachable; try next
			// (Don't remove from registry; might be temporary)
			continue;
		}
	}

	return null;
}
```

### Optional Cleanup

Periodically prune unreachable holders:

```typescript
async function pruneStaleHolders(
	registry: Y.Map<string, BlobRegistryEntry>,
	maxAge: number = 24 * 60 * 60 * 1000, // 24 hours
): Promise<void> {
	for (const [hash, entry] of registry.entries()) {
		const reachable: string[] = [];

		for (const holder of entry.holders) {
			if (await isReachable(holder)) {
				reachable.push(holder);
			}
		}

		if (reachable.length !== entry.holders.length) {
			if (reachable.length === 0) {
				registry.delete(hash);
			} else {
				registry.set(hash, { ...entry, holders: reachable });
			}
		}
	}
}
```

## Registry Key: `_blobRegistry`

The underscore prefix indicates a system-level map:

```typescript
const BLOB_REGISTRY_KEY = '_blobRegistry';

function getBlobRegistry(ydoc: Y.Doc): Y.Map<string, BlobRegistryEntry> {
	return ydoc.getMap(BLOB_REGISTRY_KEY);
}
```

## Related Documentation

- [Sync Protocol](./sync-protocol.md): How blobs are transferred
- [Content Addressing](./content-addressing.md): Hash-based identification
- [Device Identity](../architecture/device-identity.md): Server URL format
- [Network Topology](../architecture/network-topology.md): Who can serve blobs
