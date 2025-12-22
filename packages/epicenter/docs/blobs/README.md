# Blob Sync System

Epicenter's blob system enables syncing binary files (images, PDFs, videos) across devices using content-addressed storage and a leaderless sync protocol.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         BLOB SYNC ARCHITECTURE                              │
└─────────────────────────────────────────────────────────────────────────────┘

  TWO SYNC CHANNELS (same WebSocket, multiplexed):

  ┌─────────────────────────────────────────────────────────────────────────┐
  │                                                                         │
  │   CHANNEL 1: YJS (msg types 0-3)         CHANNEL 2: BLOBS (msg 10+)    │
  │   ─────────────────────────────          ──────────────────────────────│
  │   • Y.Doc state & updates                • Blob uploads                 │
  │   • BlobRefs (pointers to blobs)         • Blob requests                │
  │   • _blobRegistry (who has what)         • Blob chunk transfers         │
  │   • Awareness (cursors)                  • Actual bytes                 │
  │                                                                         │
  │   Syncs: METADATA                        Syncs: DATA                    │
  │                                                                         │
  └─────────────────────────────────────────────────────────────────────────┘
```

## Key Concepts

### BlobRef

A pointer to a blob stored in the Y.Doc:

```typescript
type BlobRef = {
	hash: `sha256:${string}`; // Content address
	size: number; // Total bytes
	mimeType: string; // e.g., "image/png"
	filename: string; // Original filename
	chunkCount: number; // For progress tracking
};
```

BlobRefs are stored in your data (e.g., as a JSON column) and sync via Yjs like any other data.

### Content Store

Local storage for blob chunks, keyed by hash:

```
.epicenter/blobs/
├── sha256:abc123.../
│   ├── meta.json       # { size, mimeType, filename, chunkCount }
│   ├── 0               # Chunk 0
│   ├── 1               # Chunk 1
│   └── 2               # Chunk 2
└── sha256:def456.../
    └── ...
```

### Blob Registry

A Y.Map in the Y.Doc that tracks which servers have which blobs:

```typescript
_blobRegistry: Y.Map<
	string,
	{
		holders: string[]; // Server URLs
		size: number;
		chunkCount: number;
	}
>;
```

The registry syncs automatically via Yjs, enabling blob discovery.

## The Sync Flow

```
1. STORE     Device stores blob locally, gets BlobRef
2. REFERENCE Store BlobRef in Y.Doc (syncs via Yjs)
3. ANNOUNCE  Server adds itself to _blobRegistry.holders
4. DISCOVER  Other devices see BlobRef, check registry
5. FETCH     Request blob from any available holder
6. REPLICATE After fetching, server adds itself as holder
```

### Visual Flow

```
  DEVICE A (uploads)          SERVER              DEVICE B (downloads)
       │                         │                        │
       ├── Store locally         │                        │
       │                         │                        │
       ├── BlobRef → Y.Doc ─────►├─── Yjs sync ─────────►│
       │                         │                        │
       ├── BLOB_UPLOAD ─────────►│                        │
       │   (chunks)              ├── Store chunks         │
       │                         │                        │
       │                         │◄── BLOB_REQUEST ───────┤
       │                         │    "I need sha256:abc" │
       │                         │                        │
       │                         ├── BLOB_CHUNKS ────────►│
       │                         │                        ├── Store locally
       │                         │                        │
```

## Leaderless Design

There is no central server. Any server can:

- Accept blob uploads from clients
- Serve blobs to any device that requests them
- Connect to other servers for server-to-server sync

### Resilience

```typescript
async function fetchBlob(hash: string): Promise<Blob | null> {
	const holders = blobRegistry.get(hash)?.holders ?? [];

	// Shuffle for load balancing
	const shuffled = shuffle([...holders]);

	// Try each holder until success
	for (const holder of shuffled) {
		try {
			return await requestBlobFrom(holder, hash);
		} catch {
			continue; // Try next holder
		}
	}

	return null; // None available
}
```

If one server is down, others continue serving. Blobs replicate as devices fetch them.

## Usage Example

```typescript
const workspace = defineWorkspace({
	id: 'blog',

	tables: {
		posts: {
			id: id(),
			title: text(),
			attachment: json<BlobRef | null>({ nullable: true }),
		},
	},

	providers: {
		persistence: setupPersistence,
		sync: createWebsocketSyncProvider({ url: '...' }),
		blobSync: createBlobSyncProvider({ serverUrl: MY_URL }),
	},

	exports: ({ tables, providers }) => ({
		attachFile: defineMutation({
			input: type({ postId: 'string' }),
			handler: async ({ postId }, ctx) => {
				// Store blob and get reference
				const result = await providers.blobSync.putBlob(ctx.file);
				if (result.error) return result;

				// Store reference in Y.Doc
				tables.posts.update({
					id: postId,
					attachment: result.data,
				});

				return Ok({ hash: result.data.hash });
			},
		}),

		getAttachment: defineQuery({
			input: type({ postId: 'string' }),
			handler: async ({ postId }) => {
				const post = tables.posts.get({ id: postId });
				if (post.status !== 'valid' || !post.row.attachment) {
					return null;
				}

				// Fetch blob (from local or remote)
				const result = await providers.blobSync.getBlob(
					post.row.attachment.hash,
				);
				return result.data;
			},
		}),
	}),
});
```

## Documentation

- [Content Addressing](./content-addressing.md): Chunking, hashing, storage
- [Sync Protocol](./sync-protocol.md): Message types and flow
- [Registry](./registry.md): How blob discovery works

## Related Architecture Docs

- [Network Topology](../architecture/network-topology.md): Node types and connections
- [Device Identity](../architecture/device-identity.md): Server URLs and identity
- [Security](../architecture/security.md): Content-addressing integrity
