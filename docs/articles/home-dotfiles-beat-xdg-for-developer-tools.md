# Home Dotfiles Beat XDG for Developer Tools

We wrote an article a few months ago arguing for XDG compliance. The position was that `~/.config/` is the correct place for application settings, `~/.local/share/` for data, and apps that dump dotfiles in `~/` are "bad citizens." That argument is technically correct and practically wrong for developer tools.

Here's what the tools developers actually use every day chose:

| Tool               | Config Location                                            | Convention                 |
| ------------------ | ---------------------------------------------------------- | -------------------------- |
| Claude Code        | `~/.claude/`                                               | Home dotfile               |
| Ollama             | `~/.ollama/`                                               | Home dotfile               |
| Cursor             | `~/.cursor/`                                               | Home dotfile               |
| OpenCode           | `~/.config/opencode/`                                      | XDG                        |
| Whispering (Tauri) | `~/Library/Application Support/com.bradenwong.whispering/` | Platform-specific app data |

Four out of five chose home dotfiles. The one that chose XDG is the one you have to remember the path for.

## Why XDG Loses in Practice

XDG solves a real problem: organizing config vs data vs cache into predictable locations. On a shared Linux server with 50 users, this matters. On a developer's personal machine running Ollama and Claude Code, nobody has ever thought "I wish this was in `~/.local/share/` instead of `~/`."

The XDG spec splits a single app's files across three directories. Your Claude Code config is in `~/.config/claude/`, your data in `~/.local/share/claude/`, your cache in `~/.cache/claude/`. Want to back up everything Claude-related? Search three places. Want to nuke it? Delete from three directories. Want to find it? Remember which bucket each file falls into.

Home dotfiles put everything in one place: `ls -la ~ | grep claude`. Done.

## Discoverability Is the Feature

The argument for `~/.config/` assumes users organize by file type: config here, data there, cache over there. Real developers organize by tool: "where's my Ollama stuff?" not "where's my configuration files?"

```bash
# XDG: three commands to find everything
ls ~/.config/ollama/
ls ~/.local/share/ollama/
ls ~/.cache/ollama/

# Home dotfile: one command
ls ~/.ollama/
```

This is why Claude, Ollama, and Cursor all chose home dotfiles over XDG. Discoverability matters more than spec compliance for tools developers interact with daily.

## Epicenter's Two-Level Convention

Epicenter has a wrinkle: it needs both project-local storage and global server config. A project's workspace data (Yjs documents, SQLite providers, markdown files) lives alongside the project. Server-wide config (API keys, encryption keys, allowed origins) is global.

```
~/.epicenter/              ← global server config
  └── server/
      ├── keys.db          ← encrypted API key store
      ├── master.key       ← AES-256 encryption key
      └── config.json      ← allowed origins, app tokens

<any-project>/.epicenter/  ← project-local workspace data
  └── providers/
      ├── persistence/     ← Yjs binary state
      ├── sqlite/          ← materialized query databases
      └── markdown/        ← human-readable file persistence
```

Same name, different scope. `~/.epicenter/` is your global Epicenter home; `<project>/.epicenter/` is that project's workspace data. The symmetry is intentional: if you're working with Epicenter, `.epicenter` is always the directory you're looking for. The only question is whether you're looking globally or locally.

This mirrors how Git works: `~/.gitconfig` is global, `<project>/.git/` is local. Nobody argues Git should put its global config in `~/.config/git/` (even though it technically supports that path, almost nobody uses it).

## When XDG Is Still Right

XDG works well for system-level services, daemons, and apps that genuinely benefit from separating config from data from cache. A desktop email client with gigabytes of cached attachments and a 2KB config file? XDG makes sense there; users back up `~/.config/` and skip `~/.cache/`.

Developer tools are different. Their "config" and "data" are intertwined: your `.claude/` directory has settings, history, transcripts, and todo files all mixed together. Splitting them across XDG directories would create friction without benefit.

## The Decision

Epicenter's global server config lives at `~/.epicenter/server/`. Home dotfile, not XDG. The same convention as Claude Code, Ollama, and Cursor, because we'd rather be easy to find than spec-compliant.

Project-local workspace data stays at `<project>/.epicenter/`, matching the existing convention already established in the codebase. Two scopes, one name, zero confusion.
