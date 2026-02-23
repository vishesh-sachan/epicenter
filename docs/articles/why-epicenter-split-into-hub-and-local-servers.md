# Why Epicenter Split Into Hub and Local Servers

Epicenter started with one server per device. Each desktop ran a Bun sidecar: sync relay, workspace CRUD, AI streaming, API keys, all in one process. It worked fine for a single machine. The moment a second device entered the picture, every assumption fell apart.

The problem wasn't technical complexity. It was authority. When you have two identical servers, which one owns the API keys? Which one authenticates users? Which one handles AI inference? We spent months trying to make peers work and kept hitting the same wall: you can't have multiple authorities for things that need a single source of truth.

## One server per device sounds clean until it isn't

The original architecture looked reasonable on paper:

```
Desktop A (Tauri)                    Desktop B (Tauri)
  └── Bun sidecar :3913               └── Bun sidecar :3913
      ├── Sync relay                       ├── Sync relay
      ├── Workspace API                    ├── Workspace API
      ├── AI streaming                     ├── AI streaming
      └── API key store                    └── API key store
```

The peers ran into some problems, and the only solution was extracting *some* but not all plugins into .

Each sidecar was self-contained. You could run Epicenter on your MacBook, configure your OpenAI key, and everything worked. Then you'd sit down at your desktop and need to configure the same keys again. And again on your work laptop.

Sync handled data fine; Yjs CRDTs kept your workspace tables in sync across devices. But API keys aren't CRDT-friendly data. You can't last-write-wins your way through key rotation. If you update your Anthropic key on one machine, the old key is immediately invalid everywhere. A CRDT that eventually converges isn't good enough when "eventually" means your other devices are making failed API calls with a revoked key.

## We tried three approaches to distributed keys

The first attempt was a zero-knowledge vault. Each device encrypts keys with a master key derived from the user's password. The server only holds ciphertext. Cryptographically elegant, completely wrong for this use case. The server needs to read the API key to call Anthropic on your behalf. Zero-knowledge means the server can't do the one thing it needs to do.

```
USER PASSWORD
      │
      ▼ (PBKDF2)
┌────────────────────┐
│  Key Encryption Key│ ─── Wraps Master Key ─── Stored in Postgres
└────────────────────┘
      │
      ▼ (AES-GCM)
┌────────────────────┐
│  Encrypted API Key │ ─── Synced via Yjs
└────────────────────┘

Problem: the server can't unwrap this to call providers.
```

The second attempt was a per-device encrypted key store. Each sidecar stores keys in `~/.epicenter/server/keys.json`, encrypted with AES-256-GCM using an auto-generated master key. This works for a single machine but doesn't solve multi-device. You're back to configuring keys on every device, and now you also have N master keys to worry about.

The third attempt was syncing encrypted keys via the CRDT layer with a shared secret. This got complicated fast: key derivation, rotation protocols, conflict resolution for encrypted blobs. We were building a distributed key management system when all we wanted was "store my Anthropic key somewhere safe and use it when I ask for AI."

## The real problem was authority, not encryption

Every approach assumed the devices were peers. But peers can't agree on authority without consensus protocols, and consensus protocols are overkill for a personal workspace tool. We kept trying to make each local server capable of everything: authentication, AI inference, key management, code execution. Each server was simultaneously a client and a server, which made every interaction ambiguous.

The authentication problem was worse. We wanted local servers to run arbitrary code: write scripts, execute them, interact with the filesystem. That's the whole point of a local-first coding tool. But if each local server also handles authentication, a compromised local server is an authentication server that can execute arbitrary code. The security boundary was nonexistent.

Then we asked: what if we stopped pretending the devices are equal?

## Two tiers, not one

The answer was separating what needs central authority from what needs local execution:

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

The hub does everything that needs a single authority: authentication, key storage, AI inference. Local servers do everything that needs to be close to the user: workspace operations, filesystem access, code execution. Neither tries to do the other's job.

API keys live as environment variables on the hub. One place, one set of keys, no sync protocol. When your MacBook's OpenCode needs to call Anthropic, it sends the request to the hub with a session token. The hub validates the session, swaps in the real API key, and forwards the request. The key never leaves the hub.

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

## This maps cleanly to cloud extraction

The split wasn't just about solving the multi-device problem. We'd been thinking about offering a hosted version of Epicenter, and the hub/local architecture maps directly to that.

Everything the hub does is stateless request handling: validate a token, look up a key, proxy a request, relay WebSocket messages. That's exactly what Cloudflare Workers and Durable Objects are good at. The hub becomes a cloud service with zero architectural changes.

Everything the local server does requires the user's machine: reading their filesystem, executing their code, fast sub-millisecond sync between the Tauri webview and the Y.Doc. You can't move that to the cloud, and you shouldn't. It's the whole point of local-first.

```
┌─────────────────────────────────────────────────────────┐
│                   Self-hosted                           │
│                                                         │
│  Hub: Bun binary on a home server or VPS               │
│  Local: Tauri sidecar on each desktop                  │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│                   Cloud (Epicenter hosted)              │
│                                                         │
│  Hub: CF Workers + Durable Objects (same API surface)  │
│  Local: Tauri sidecar on each desktop (unchanged)      │
└─────────────────────────────────────────────────────────┘
```

Users who self-host run the hub as a compiled Bun binary. Users who don't want to manage infrastructure use our hosted hub. The local servers are identical in both cases. Switching between self-hosted and cloud is changing one URL.

## What we learned

The instinct to make every node equal is strong, especially in local-first software where decentralization is a core value. But "local-first" doesn't mean "no servers." It means your data lives on your machine and you aren't dependent on a cloud service to function. The hub is a coordination point, not a dependency: local servers keep working offline, data stays in your Y.Doc, and the hub syncs it when it's available.

The key insight was that some operations genuinely need a single authority (auth, key management, AI proxying) and others genuinely need local execution (filesystem access, code execution, low-latency sync). Trying to make one server do both well is how you end up with three failed attempts at distributed key management.
