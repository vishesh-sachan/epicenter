# The Server Starts the Client, Not the Other Way Around

Your server picks port 3913. It's taken, so it tries 3914. That's taken too. It lands on 3915. Now the frontend needs to connect. How does it know the port?

The naive answer: have the client try 3913, then 3914, then 3915, incrementing until it finds the server. This is fragile. Another process could be listening on 3914, and now your client is talking to the wrong server. Race conditions, security holes, wasted time.

The real answer is simpler: don't start the client until the server knows its port. Then hand it over.

## The Parent Process Owns the Port

Users don't open frontends directly. They launch something: a CLI command, a desktop app, a system tray icon. That launcher is the parent process. It starts the server, gets the port back, and only then opens the client with that port baked in.

```
User runs CLI / clicks app
    │
    ▼
Parent process starts
    │
    ├── Start server ──► Server binds to port 3915
    │                         │
    │                         ▼
    │                    Returns actual port
    │
    ├── open("http://localhost:3915")
    │
    ▼
Browser opens, already connected
```

The server never broadcasts its port. The parent already knows it because the parent started the server. The client never guesses because the parent tells it exactly where to go. The browser tab doesn't exist until the server is ready to receive requests.

This is how most local dev tools work in practice. [Vibe Kanban](https://github.com/BloopAI/vibe-kanban) is a good example: you run `npx vibe-kanban`, the Rust backend binds to an available port, and the process opens your browser to `localhost:{port}`. [OpenCode](https://github.com/anomalyco/opencode) does the same thing with its client/server architecture: the CLI starts the server, then the TUI (or a web browser) connects to it. In both cases, the user runs one command and the port is handled internally.

For a CLI tool, the implementation is straightforward. Start the server, capture the port, open the browser:

```typescript
const port = await startServer({ defaultPort: 3913 });
open(`http://localhost:${port}`);
```

One function call to bind, one to open the browser. The frontend doesn't need the port passed as a query parameter or stored anywhere; it's already running on the right origin.

In a Tauri desktop app, the Rust backend is the parent process. It starts the server before the webview loads, then the frontend retrieves the port through Tauri's built-in IPC bridge:

```rust
#[tauri::command]
fn get_api_port(state: tauri::State<'_, AppState>) -> u16 {
    state.api_port
}
```

```typescript
const port = await invoke<number>('get_api_port');
const api = `http://localhost:${port}`;
```

The IPC channel that Tauri already provides is the port discovery mechanism. No extra infrastructure needed.

## When the Client Starts Independently

The parent process pattern works when the server controls the client's lifecycle. But sometimes the client and server start separately: a web dashboard that's already open when you restart the backend, multiple clients connecting at different times, or separate executables that don't share a process tree. In those cases, the port needs to be discoverable after the fact.

### Write the Port to a Known File

The server writes its port to a well-known path on startup. Any client that needs to connect reads that file.

```typescript
// Server writes on startup
const port = await bindToAvailablePort(3913);
await writeFile('~/.config/myapp/port', String(port));
```

```typescript
// Client reads on connect
const port = Number(await readFile('~/.config/myapp/port'));
```

Simple, works across processes, no network overhead. The downside is stale files: if the server crashes without cleaning up, the next client reads a dead port. A PID file alongside the port file handles this, but it's more machinery. PostgreSQL uses exactly this pattern with its `postmaster.pid` file, which stores the PID, port, and socket path in the data directory.

### Reserve a Discovery Port

Reserve one fixed port as a discovery endpoint. The server always tries to bind port 3913 for discovery, even if the actual API runs elsewhere.

```typescript
// Discovery server on fixed port
app.get('/discover', (req, res) => {
	res.json({ apiPort: actualPort });
});
```

The client hits `localhost:3913/discover`, gets the real port, and connects. This only fails if another process has already claimed 3913, which is unlikely for a niche port but not impossible.

The tradeoff: you still need one known port, so you haven't fully solved the "what if it's taken" problem. You've just made it much less likely to matter, since the discovery endpoint is tiny and rarely conflicts.

## Why the Client Shouldn't Guess

Having the client increment through ports looking for the server seems simple, but it breaks in quiet ways. A different application listening on an intermediate port will accept the connection. The client has no way to verify it found _your_ server without an additional handshake protocol, and at that point you've reinvented service discovery.

The startup sequence matters: something has to know the port first, and that something should tell everyone else. In most local apps, that's the parent process. The user starts the app, the app starts the server, and the server opens the client. The port flows downward through the process tree, never upward through guessing.
