# Epicenter Documentation

Technical documentation for the Epicenter package.

## Documentation Structure

```
docs/
├── architecture/       # System architecture
│   ├── network-topology.md    # Node types, connections
│   ├── device-identity.md     # Server URLs, identity
│   └── security.md            # Security model
│
├── blobs/              # Blob sync system
│   ├── README.md              # Overview
│   ├── content-addressing.md  # Chunking, hashing
│   ├── sync-protocol.md       # Message types, flow
│   └── registry.md            # Blob discovery
│
└── articles/           # Technical deep-dives
    ├── making-crdts-ergonomic-with-proxies.md
    ├── ytext-diff-sync.md
    └── ...
```

## Quick Links

### Architecture

- **[Network Topology](./architecture/network-topology.md)**: How devices connect (clients, servers, mesh)
- **[Device Identity](./architecture/device-identity.md)**: Server URLs and identity management
- **[Security](./architecture/security.md)**: Tailscale, content-addressing, threat model

### Blob System

- **[Blob Overview](./blobs/README.md)**: How blobs sync across devices
- **[Content Addressing](./blobs/content-addressing.md)**: Chunking, SHA-256, storage layout
- **[Sync Protocol](./blobs/sync-protocol.md)**: WebSocket messages, upload/download flow
- **[Registry](./blobs/registry.md)**: `_blobRegistry` Y.Map, holder discovery

### Technical Articles

Deep-dives into implementation details:

- [Making CRDTs Ergonomic with Proxies](./articles/making-crdts-ergonomic-with-proxies.md)
- [Y.Text Diff Sync](./articles/ytext-diff-sync.md)
- [Y.Array Diff Sync](./articles/yarray-diff-sync.md)
- [TypeScript Serialization Patterns](./articles/typescript-serialization-patterns.md)

## Related Files

- [SYNC_ARCHITECTURE.md](../SYNC_ARCHITECTURE.md): Multi-device Yjs sync architecture
- [README.md](../README.md): Package overview and API reference
- [AGENTS.md](../AGENTS.md): Development guidelines
