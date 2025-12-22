# Architecture Documentation

System architecture documentation for Epicenter's distributed sync system.

## Documents

| Document                                  | Description                                                      |
| ----------------------------------------- | ---------------------------------------------------------------- |
| [Network Topology](./network-topology.md) | Node types (client/server), connection rules, example topologies |
| [Device Identity](./device-identity.md)   | How devices identify themselves, server URLs, registry entries   |
| [Security](./security.md)                 | Security layers (Tailscale, content-addressing), threat model    |

## Quick Reference

### Node Types

| Type   | Runtime  | Can Accept Connections | Can Serve Blobs |
| ------ | -------- | ---------------------- | --------------- |
| Client | Browser  | No                     | No              |
| Server | Bun/Node | Yes                    | Yes             |

### Connection Rules

```
Client ──► Server     ✅
Client ──► Client     ❌
Server ──► Server     ✅
Server ──► Client     ❌
```

### Typical Setup

```
         ┌─────────┐           ┌─────────┐
         │LAPTOP A │           │LAPTOP B │
         │ Browser │           │ Browser │
         │    ▼    │           │    ▼    │
         │ Server ◄├───────────┼► Server │     ┌────────┐
         └────▲────┘           └────▲────┘     │ PHONE  │
              │                     │          │Browser │
              └─────────────────────┴──────────┴───┘
```

## Related Documentation

- [Blob System](../blobs/README.md): How binary files sync
- [SYNC_ARCHITECTURE.md](../../SYNC_ARCHITECTURE.md): Yjs sync details
