# Content Addressing

Blobs in Epicenter are stored using content-addressing: the file's cryptographic hash becomes its identifier. This enables deduplication, integrity verification, and efficient sync.

## How It Works

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         CONTENT ADDRESSING                                  │
└─────────────────────────────────────────────────────────────────────────────┘

  INPUT: photo.jpg (307,200 bytes)

  PROCESS:
  ┌────────────────────────────────────────────────────────────────────────┐
  │  1. Hash entire file:  SHA-256(bytes) → "abc123..."                   │
  │  2. Identifier becomes: "sha256:abc123..."                            │
  └────────────────────────────────────────────────────────────────────────┘

  PROPERTIES:
  • Same file → same hash (deduplication)
  • Different file → different hash (collision-resistant)
  • Tampered file → hash mismatch (integrity check)
```

## Chunking

Large files are split into fixed-size chunks for efficient transfer and storage.

### Chunk Size

```typescript
const CHUNK_SIZE = 256 * 1024; // 256 KiB (like IPFS default)
```

| File Size | Chunks | Rationale                          |
| --------- | ------ | ---------------------------------- |
| 100 KB    | 1      | Small files: single chunk          |
| 1 MB      | 4      | Medium files: few chunks           |
| 10 MB     | 40     | Large files: many chunks           |
| 1 GB      | 4,096  | Very large: manageable chunk count |

### Chunking Algorithm

```typescript
import { sha256 } from 'hash-wasm';

const CHUNK_SIZE = 256 * 1024;

async function* chunkBlob(
	data: ArrayBuffer,
	onProgress?: (progress: number) => void,
): AsyncGenerator<BlobChunk> {
	const bytes = new Uint8Array(data);
	const totalChunks = Math.ceil(bytes.length / CHUNK_SIZE);

	for (let i = 0; i < totalChunks; i++) {
		const start = i * CHUNK_SIZE;
		const end = Math.min(start + CHUNK_SIZE, bytes.length);
		const chunkData = bytes.slice(start, end);
		const chunkHash = await sha256(chunkData);

		yield {
			index: i,
			hash: `sha256:${chunkHash}`,
			data: chunkData,
		};

		onProgress?.((i + 1) / totalChunks);
	}
}
```

### Why Chunk?

| Benefit             | Explanation                                   |
| ------------------- | --------------------------------------------- |
| Resumable transfers | If connection drops, only retry failed chunks |
| Parallel downloads  | Request multiple chunks simultaneously        |
| Progress tracking   | Know exactly how much has transferred         |
| Memory efficiency   | Don't load entire file into memory            |
| Partial validation  | Verify chunks as they arrive                  |

## Storage Layout

### Directory Structure

```
.epicenter/
└── blobs/
    ├── sha256:abc123def456.../     # Directory per blob
    │   ├── meta.json               # Metadata
    │   ├── 0                       # Chunk 0 (raw bytes)
    │   ├── 1                       # Chunk 1
    │   └── 2                       # Chunk 2
    │
    └── sha256:789xyz.../
        ├── meta.json
        └── 0                       # Single chunk (small file)
```

### Metadata File

```json
{
	"size": 307200,
	"mimeType": "image/jpeg",
	"filename": "photo.jpg",
	"chunkCount": 3
}
```

### Platform-Specific Storage

| Platform | Location   | API                                |
| -------- | ---------- | ---------------------------------- |
| Browser  | OPFS       | `navigator.storage.getDirectory()` |
| Bun/Node | Filesystem | `Bun.write()` / `fs.writeFile()`   |

## Hash Function

### SHA-256

```typescript
import { sha256 } from 'hash-wasm'; // WASM implementation

async function computeBlobHash(data: ArrayBuffer): Promise<`sha256:${string}`> {
	const hash = await sha256(new Uint8Array(data));
	return `sha256:${hash}`;
}
```

### Why SHA-256?

| Property             | Value                   |
| -------------------- | ----------------------- |
| Output size          | 256 bits (64 hex chars) |
| Collision resistance | ~2^128 operations       |
| Speed                | ~400 MB/s (WASM)        |
| Adoption             | Industry standard       |

### Hash Format

```
sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
└────┘ └────────────────────────────────────────────────────────────────────┘
prefix                          64 hex characters
```

The prefix allows future algorithm upgrades (e.g., `sha3:...`, `blake3:...`).

## Deduplication

Same content always produces the same hash:

```
┌────────────────────────────────────────────────────────────────────────────┐
│  User A uploads: vacation.jpg (sha256:abc123)                             │
│  User B uploads: same-photo.jpg (sha256:abc123)  ← Same hash!             │
│                                                                           │
│  Storage: Only ONE copy exists                                            │
│  Registry: Both users' BlobRefs point to sha256:abc123                    │
└────────────────────────────────────────────────────────────────────────────┘
```

### Cross-Workspace Deduplication

Blobs are stored globally (not per-workspace), so identical files across workspaces share storage.

## Integrity Verification

### On Upload

```typescript
async function storeBlob(data: ArrayBuffer): Promise<BlobRef> {
  const hash = await computeBlobHash(data);

  for await (const chunk of chunkBlob(data)) {
    // Each chunk has its own hash for verification
    await contentStore.putChunk(hash, chunk);
  }

  return { hash, size: data.byteLength, ... };
}
```

### On Download

```typescript
async function verifyChunk(chunk: BlobChunk): Promise<boolean> {
	const computed = await sha256(chunk.data);
	return chunk.hash === `sha256:${computed}`;
}

// Reject tampered chunks
if (!(await verifyChunk(receivedChunk))) {
	throw new Error('Chunk failed integrity check');
}
```

### Blob-Level Verification

After reassembling all chunks, verify the complete blob:

```typescript
async function verifyBlob(hash: string, blob: Blob): Promise<boolean> {
	const data = await blob.arrayBuffer();
	const computed = await computeBlobHash(data);
	return computed === hash;
}
```

## Types

```typescript
/**
 * Content-addressed blob reference stored in Y.Doc.
 */
type BlobRef = {
	/** SHA-256 hash of the complete blob */
	hash: `sha256:${string}`;
	/** Total size in bytes */
	size: number;
	/** MIME type */
	mimeType: string;
	/** Original filename */
	filename: string;
	/** Number of chunks */
	chunkCount: number;
};

/**
 * A chunk of blob data.
 */
type BlobChunk = {
	/** Index in the chunk array (0-based) */
	index: number;
	/** SHA-256 hash of this chunk */
	hash: `sha256:${string}`;
	/** The actual bytes */
	data: Uint8Array;
};
```

## Related Documentation

- [Sync Protocol](./sync-protocol.md): How chunks are transferred
- [Registry](./registry.md): How blob availability is tracked
- [Security](../architecture/security.md): Integrity guarantees
