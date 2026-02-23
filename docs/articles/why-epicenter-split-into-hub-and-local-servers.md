# Why Epicenter Split Into Hub and Local Servers

Some operations need a single authority: authentication, API key storage, AI proxying. Others need to run on the user's machine: filesystem access, code execution, low-latency sync. Epicenter tried to make one server do both and it didn't work. The fix was splitting into two: a hub for coordination and a local server for execution.

```
┌───────────────────────────────────────────────────────┐
│  Hub Server (one instance, always on)                 │
│                                                       │
│  Auth         → Better Auth, session tokens, user DB  │
│  AI streaming → SSE to all providers, single key set  │
│  AI proxy     → OpenCode routes through hub           │
│  Sync relay   → Primary relay, all devices connect    │
│  API keys     → Env vars on the hub, nowhere else     │
└───────────────────────────┬───────────────────────────┘
                            │
              ┌─────────────┼─────────────────┐
              ▼             ▼                  ▼
┌──────────────────┐ ┌──────────────────┐ ┌────────────┐
│  Local Server    │ │  Local Server    │ │  Mobile    │
│  (MacBook)       │ │  (Desktop)       │ │  (no srv)  │
│                  │ │                  │ │            │
│  Workspace CRUD  │ │  Workspace CRUD  │ │  Connects  │
│  Code execution  │ │  Code execution  │ │  to hub    │
│  Local sync      │ │  Local sync      │ │  directly  │
└──────────────────┘ └──────────────────┘ └────────────┘
```

The hub handles auth, AI, and keys. Local servers handle workspaces and code execution. Neither tries to do the other's job.

## What broke with one server per device

Epicenter originally ran one Bun sidecar per desktop: sync, workspace CRUD, AI streaming, API keys, all in one process. Adding a second device meant two identical servers that both needed to answer the same questions: who authenticates? Who owns the API keys? Who handles AI?

Sync was fine; Yjs CRDTs kept workspace data in sync. API keys were not. You can't last-write-wins your way through key rotation: if you update your Anthropic key on one machine, the old key is immediately invalid everywhere. We tried three approaches (zero-knowledge vault, per-device encrypted stores, CRDT-synced secrets) and all of them were solving the wrong problem. The issue wasn't encryption. It was that peers can't agree on authority without consensus protocols, and consensus protocols are overkill for a personal workspace tool.

The authentication problem was worse. Local servers need to run arbitrary code (that's the point of a local-first coding tool), but if each local server also handles authentication, a compromised one is an auth server that can execute arbitrary code.

## How the proxy works

When OpenCode on your MacBook needs to call Anthropic, it sends the request to the hub with a session token. The hub validates the session, swaps in the real API key from its environment, and forwards the request. Keys never leave the hub.

```
OpenCode (MacBook)                    Hub                         Anthropic
     │                                 │                              │
     │  POST /proxy/anthropic/v1/...   │                              │
     │  Authorization: Bearer <token>  │                              │
     │────────────────────────────────►│                              │
     │                                 │  validate session            │
     │                                 │  read ANTHROPIC_API_KEY      │
     │                                 │  x-api-key: sk-ant-...       │
     │                                 │─────────────────────────────►│
     │                                 │◄─────────────────────────────│
     │◄────────────────────────────────│  stream SSE back             │
```

One set of keys, one place to configure them, no sync protocol.

## This maps directly to cloud extraction

Everything the hub does is stateless request handling: validate a token, look up a key, proxy a request, relay WebSocket messages. That's what Cloudflare Workers and Durable Objects are built for. The hub becomes a hosted service with zero architectural changes.

Everything the local server does requires the user's machine. You can't move filesystem access or code execution to the cloud. You shouldn't.

```
Self-hosted:  Hub = Bun binary on a VPS.         Local = Tauri sidecar (unchanged).
Cloud:        Hub = CF Workers + Durable Objects. Local = Tauri sidecar (unchanged).
```

Switching between self-hosted and cloud is changing one URL. The local servers are identical in both modes. "Local-first" doesn't mean "no servers." It means your data lives on your machine and you aren't dependent on a cloud service to function. The hub is a coordination point, not a dependency.
