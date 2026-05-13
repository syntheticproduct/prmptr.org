# Privacy

prmptr.org is a local desktop editor. It runs as a normal user-mode process on your own machine. It reads files you point it at, and a small set of well-defined files belonging to Claude Code and Claude Desktop. **It does not send anything off your machine.**

If you work in a regulated environment, this page is for you (and for your security team).

## What goes over the network

**Nothing, today.** The released binary has zero outbound HTTP. You can verify this by running `tcpdump`, `Wireshark`, or any host firewall — prmptr opens no sockets to the outside.

When AI features land in a future release ("critique current prompt", "extract variables"), those will be **opt-in**, will route through providers the user explicitly configures, and will be documented in this file with the exact endpoints and what data is sent.

## What prmptr.org reads from disk

Beyond the file you explicitly open or save:

| Path                                                                                       | What it is                                                                                                                                                | Why prmptr reads it                                                                                       | Written? |
|--------------------------------------------------------------------------------------------|-----------------------------------------------------------------------------------------------------------------------------------------------------------|-----------------------------------------------------------------------------------------------------------|----------|
| `~/.claude.json`                                                                           | Claude Code's per-user config (project list, auth state).                                                                                                  | Read-only display in the Global Settings window.                                                          | No       |
| `~/.claude/` (CLAUDE.md, settings.json, history.jsonl, projects/, todos/, plans/, …)       | Claude Code's working tree.                                                                                                                                | Read-only inventory display in the Global Settings window. File contents are truncated for very large files. | No       |
| `~/.claude/projects/<encoded>/*.jsonl`                                                     | Per-session Claude Code transcripts.                                                                                                                       | Indexed and shown in the Session Explorer for the current project.                                       | No       |
| `~/.claude/projects-archive/`                                                              | prmptr.org's own archive root (created on first archive operation).                                                                                       | Sessions are moved here when the user archives them in the Session Explorer.                              | Yes (move) |
| `%APPDATA%\Claude\local-agent-mode-sessions\` (Win) <br> Microsoft Store equivalent under `%LOCALAPPDATA%\Packages\Claude_pzs8sxrjxfjjc\…` <br> `/mnt/c/Users/<u>/AppData/...` (WSL) | Claude Desktop Cowork session metadata (one JSON per session). | Listed in the Cowork browser. Updates a single `isArchived` field on user request. | Yes (one field) |
| `%APPDATA%\Claude\Local Storage\leveldb\*.{log,ldb}`                                       | Claude Desktop's Chromium Local Storage.                                                                                                                  | Read as opaque bytes (no LevelDB lock taken) to recover the sidebar's pin order. The DB itself is not modified. | No       |
| `%TEMP%\prmptr-clips\clip-<ts>.png`                                                        | Temp directory the app creates for clipboard-image-to-file conversions.                                                                                   | Used when you paste an image into the editor.                                                             | Yes (own dir) |

The app never reads:

- Network credentials, browser cookies, password managers, SSH keys, or any other secret store.
- Any file in `~/.ssh`, `~/.config`, `~/.aws`, `~/Documents`, etc., unless you explicitly open it.

For the exact commands that touch the filesystem, see [`src-tauri/src/lib.rs`](src-tauri/src/lib.rs)'s `invoke_handler` block. Every command shows up there; there is no hidden surface area.

## What prmptr.org writes to disk

- The file you explicitly Save (always).
- One `isArchived` boolean inside a Claude Cowork session JSON, when you archive/unarchive a session in the Cowork browser. All other fields are preserved verbatim.
- A `.png` file in `%TEMP%\prmptr-clips\` when you paste an image. These accumulate; clear `%TEMP%` to remove them.
- One move-or-rename per session when you archive/unarchive a Claude Code session.

That is the complete list.

## Logging

prmptr.org uses `tauri-plugin-log` in debug builds only. Production builds today do not write log files to disk. When structured logging ships to release builds, log files will land under the platform-standard log directory (`%LOCALAPPDATA%\prmptr\logs\` on Windows, `~/.local/share/prmptr/logs/` on Linux, `~/Library/Logs/prmptr/` on macOS) and will never contain file contents — only paths, sizes, and error types.

## Environment-variable overrides

For testing or unusual installs, the app respects four read-only environment variables:

- `PRMPTR_COWORK_PATH` — point at an alternate Claude Cowork session root.
- `PRMPTR_COWORK_LOCALSTORAGE_PATH` — point at an alternate Local Storage leveldb dir.
- `PRMPTR_CLAUDE_HOME` — point at an alternate `~/.claude/` home for the Global Settings inspector.
- `PRMPTR_CLAUDE_ARCHIVE_PATH` — change where Session Explorer archive moves go.

These are deliberate user-trusted overrides; the same user that set the env var is the one running the process.

## Reporting a privacy concern

Same channel as security: **camille.lambert+prmptr-security@gmail.com**. See [`SECURITY.md`](SECURITY.md).
