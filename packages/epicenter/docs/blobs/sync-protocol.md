# Blob Sync Protocol

This document describes the protocol for syncing blobs between devices over WebSocket.

## Protocol Overview

Blob sync runs over the same WebSocket connection as Yjs sync, using different message type IDs:

```
┌────────────────────────────────────────────────────────────────────────────┐
│  Message Types                                                             │
│                                                                            │
│  0-3:   Yjs sync (SYNC, AWARENESS, AUTH, QUERY_AWARENESS)                 │
│  10+:   Blob sync (UPLOAD, REQUEST, CHUNKS, HAVE)                         │
└────────────────────────────────────────────────────────────────────────────┘
```

## Message Types

### BLOB_UPLOAD (10)

Client uploads a blob to a server.

```typescript
type BlobUploadMessage = {
	type: 10;
	hash: string;
	meta: {
		size: number;
		mimeType: string;
		filename: string;
		chunkCount: number;
	};
	chunks: BlobChunk[];
};
```

**Flow:**

1. Client stores blob locally
2. Client sends BLOB_UPLOAD to connected server(s)
3. Server stores chunks
4. Server adds itself to `_blobRegistry.holders`

### BLOB_REQUEST (11)

Request a blob by hash.

```typescript
type BlobRequestMessage = {
	type: 11;
	hash: string;
};
```

**Flow:**

1. Device sees BlobRef in Y.Doc
2. Device checks local store: doesn't have it
3. Device checks `_blobRegistry`: finds holders
4. Device sends BLOB_REQUEST to a holder
5. Holder responds with BLOB_CHUNKS

### BLOB_CHUNKS (12)

Response containing blob chunks.

```typescript
type BlobChunksMessage = {
	type: 12;
	hash: string;
	chunks: BlobChunk[];
};
```

**Flow:**

1. Server receives BLOB_REQUEST
2. Server reads chunks from local store
3. Server sends BLOB_CHUNKS
4. Client stores chunks locally
5. If client is a server, it adds itself to `_blobRegistry.holders`

### BLOB_HAVE (13)

Announce which blobs a peer has (for P2P discovery).

```typescript
type BlobHaveMessage = {
	type: 13;
	hashes: string[];
};
```

**Optional**: Used for proactive discovery in P2P scenarios.

## Complete Sync Flow

### Upload Flow (Phone → Server)

```
  PHONE                              SERVER
    │                                   │
    │  ┌───────────────────────────┐   │
    │  │ 1. Store locally (OPFS)   │   │
    │  │    sha256:abc → chunks    │   │
    │  └───────────────────────────┘   │
    │                                   │
    │  ┌───────────────────────────┐   │
    │  │ 2. Update Y.Doc:          │   │
    │  │    posts[1].attachment =  │   │
    │  │    { hash: "sha256:abc" } │   │
    │  └───────────────────────────┘   │
    │                                   │
    │  ── BLOB_UPLOAD ────────────────►│
    │     { hash, meta, chunks }       │
    │                                   │  ┌─────────────────────────┐
    │                                   │  │ 3. Store to filesystem  │
    │                                   │  │    /blobs/sha256:abc/   │
    │                                   │  └─────────────────────────┘
    │                                   │
    │                                   │  ┌─────────────────────────┐
    │                                   │  │ 4. Update _blobRegistry │
    │                                   │  │    holders += server    │
    │                                   │  └─────────────────────────┘
    │                                   │
```

### Download Flow (Desktop ← Server)

```
  DESKTOP                            SERVER
    │                                   │
    │  ┌───────────────────────────┐   │
    │  │ Y.Doc update arrives:     │   │
    │  │ posts[1].attachment =     │   │
    │  │ { hash: "sha256:abc" }    │   │
    │  └───────────────────────────┘   │
    │                                   │
    │  ┌───────────────────────────┐   │
    │  │ Check local: has it?  NO  │   │
    │  └───────────────────────────┘   │
    │                                   │
    │  ┌───────────────────────────┐   │
    │  │ Check registry:           │   │
    │  │ holders = ["server:3913"] │   │
    │  └───────────────────────────┘   │
    │                                   │
    │  ── BLOB_REQUEST ───────────────►│
    │     { hash: "sha256:abc" }       │
    │                                   │  ┌─────────────────────────┐
    │                                   │  │ Read from filesystem    │
    │                                   │  └─────────────────────────┘
    │                                   │
    │  ◄── BLOB_CHUNKS ────────────────│
    │      { hash, chunks }            │
    │                                   │
    │  ┌───────────────────────────┐   │
    │  │ Store locally             │   │
    │  │ /blobs/sha256:abc/        │   │
    │  └───────────────────────────┘   │
    │                                   │
    │  ┌───────────────────────────┐   │
    │  │ If server: add self to    │   │
    │  │ _blobRegistry.holders     │   │
    │  └───────────────────────────┘   │
    │                                   │
```

### Fallback Flow (Multiple Holders)

```
  PHONE                  LAPTOP A (down)       LAPTOP B (up)
    │                         ╳                     │
    │                                               │
    │  registry.holders = ["laptop-a", "laptop-b"] │
    │                                               │
    │  ── BLOB_REQUEST ───────►╳                   │
    │     (connection failed)                       │
    │                                               │
    │  ── BLOB_REQUEST ────────────────────────────►│
    │                                               │
    │  ◄── BLOB_CHUNKS ─────────────────────────────│
    │                                               │
```

## Message Encoding

Messages are encoded as binary using a simple format:

```
┌───────┬──────────────────────────────────────────┐
│ Byte  │ Content                                  │
├───────┼──────────────────────────────────────────┤
│ 0     │ Message type (10, 11, 12, or 13)        │
│ 1-N   │ MessagePack/CBOR encoded payload         │
└───────┴──────────────────────────────────────────┘
```

### Encoding Example

```typescript
import { encode, decode } from '@msgpack/msgpack';

function encodeBlobRequest(hash: string): Uint8Array {
	const payload = encode({ hash });
	const message = new Uint8Array(1 + payload.length);
	message[0] = BLOB_MSG.REQUEST; // 11
	message.set(payload, 1);
	return message;
}

function decodeBlobRequest(data: Uint8Array): { hash: string } {
	const payload = data.slice(1);
	return decode(payload) as { hash: string };
}
```

## Connection Management

### Provider Setup

```typescript
const blobSync = createBlobSyncProvider({
	serverUrl: 'ws://laptop-a.tailnet:3913/sync', // This server's URL (if server)
});
```

### Multiplexing with Yjs

Both Yjs and blob messages share the same WebSocket:

```typescript
ws.onmessage = (event) => {
	const data = new Uint8Array(event.data);
	const messageType = data[0];

	if (messageType < 10) {
		// Yjs message (0-3)
		handleYjsMessage(data);
	} else {
		// Blob message (10+)
		handleBlobMessage(data);
	}
};
```

## Server-Side Handler

```typescript
function handleBlobMessage(
	data: Uint8Array,
	sendToClient: (msg: Uint8Array) => void,
) {
	const type = data[0];

	switch (type) {
		case BLOB_MSG.UPLOAD: {
			const { hash, meta, chunks } = decodeBlobUpload(data);

			// Store chunks
			for (const chunk of chunks) {
				await contentStore.putChunk(hash, chunk);
			}

			// Announce in registry
			announceHaveBlob(hash, meta);
			break;
		}

		case BLOB_MSG.REQUEST: {
			const { hash } = decodeBlobRequest(data);

			// Read and send chunks
			const chunks = await contentStore.getAllChunks(hash);
			const response = encodeBlobChunks({ hash, chunks });
			sendToClient(response);
			break;
		}
	}
}
```

## Error Handling

### Request Timeout

```typescript
async function requestWithTimeout(
	ws: WebSocket,
	hash: string,
	timeout = 30000,
): Promise<Blob> {
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => {
			reject(new Error(`Timeout requesting ${hash}`));
		}, timeout);

		// ... handle response, clear timer on success
	});
}
```

### Retry with Backoff

```typescript
async function fetchWithRetry(
	hash: string,
	holders: string[],
	maxRetries = 3,
): Promise<Blob | null> {
	for (let attempt = 0; attempt < maxRetries; attempt++) {
		for (const holder of holders) {
			try {
				return await requestBlobFrom(holder, hash);
			} catch {
				continue;
			}
		}

		// Exponential backoff between full rounds
		await sleep(Math.pow(2, attempt) * 1000);
	}

	return null;
}
```

## Chunk Streaming (Large Files)

For very large files, chunks can be sent incrementally:

```typescript
// Server sends chunks one at a time
async function streamChunks(ws: WebSocket, hash: string) {
	const meta = await contentStore.getMeta(hash);

	for (let i = 0; i < meta.chunkCount; i++) {
		const chunk = await contentStore.getChunk(hash, i);
		ws.send(encodeBlobChunk({ hash, chunk }));

		// Yield to event loop
		await new Promise((r) => setTimeout(r, 0));
	}
}
```

## Related Documentation

- [Content Addressing](./content-addressing.md): How blobs are chunked
- [Registry](./registry.md): How holders are discovered
- [Network Topology](../architecture/network-topology.md): Connection patterns
