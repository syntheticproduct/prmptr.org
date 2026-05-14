# prmptr.org

A Tauri desktop companion for prompt engineering. Edit prompts in a WYSIWYG markdown view, browse the conversations stored by Claude Desktop's Cowork mode and Claude Code's CLI, and reconcile their outputs with your local workspace. MIT licensed.

**Status**: actively evolving. The four root tabs (Prompt Engineering, Markdown Editing, Claude Cowork, Claude Code) are wired end-to-end. Cross-platform, with Windows as the primary target and WSL2 as a first-class development *and* runtime environment — when run inside WSL2, the app auto-detects the Windows-side Claude install via `/mnt/c/…`.

## Why

The tooling for editing long, structured LLM prompts is bad. You either:
- Live in a textarea and squint at raw markdown, or
- Use a general-purpose editor (VS Code, Obsidian) that doesn't know prompts have headings + XML tags + structure that matters.

Worse, the *artifacts* you produce alongside those prompts — Claude Desktop's Cowork sessions, Claude Code's CLI session logs, the output files they generate — live in a scattered set of OS-specific sandboxed locations that no single editor surfaces.

`prmptr` is what an editor built specifically for prompt engineering looks like. XML tags as first-class citizens, byte-perfect markdown round-trip via remark, and a built-in browser for the surrounding Claude session metadata so you can navigate your own prompt-engineering history.

## Features

### Editor (Prompt Engineering / Markdown Editing tabs)
- WYSIWYG markdown via [Milkdown](https://milkdown.dev) (ProseMirror + remark) with byte-perfect round-trip.
- YAML frontmatter parsing, editing, and round-trip preservation; toggle between show/hide modes.
- Native file open/save with file picker, HTML5 drag-and-drop, and CLI arg path-passing (`prmptr.exe foo.md`).
- Folder tree pane for navigating a workspace, with unsaved-changes guards on every navigation action.
- Analysis pane for structural inspection of the current prompt.

### Claude Cowork tab
- Reads Claude Desktop's per-session metadata from `local-agent-mode-sessions/<org>/<user>/<session-id>/`.
- Auto-detects the Microsoft Store sandbox path (`%LOCALAPPDATA%\Packages\Claude_pzs8sxrjxfjjc\LocalCache\Roaming\Claude\…`) and classic install variants.
- From inside WSL2, auto-probes the Windows-side install at `/mnt/c/…`.
- Pin-order honored from Chromium Local Storage LevelDB; sortable columns; multi-select bulk archive / unarchive.
- "Open session in a new window" launches a focused per-session viewer.

### Claude Code tab
- Session Explorer reads Claude Code CLI session JSONL logs.
- **Bridge** sub-tab (WSL-only): reconciles files between Claude session outputs and a Windows-side workspace — per-row copy / symlink (with backup of any clobbered file) / reveal in file manager.
- Worktree Janitor scans `~/projects/*/.claude/worktrees/*/`, distinguishes intentional numbered worktrees from auto-generated ones, and prunes safely (`git worktree remove` first, `fs::remove_dir_all` fallback).

### Quality of life
- Windows accessibility text-scale slider honored — chrome scales without dragging the editor body.
- Reveal-in-file-manager across Explorer / Finder / native Linux.
- WSL-aware clipboard fallback — image-via-PowerShell when WSLg's bridge doesn't forward image MIME types.
- Global Settings window — collapsible view of `~/.claude/*` paths.
- Layout state (active tab, frontmatter mode, last-selected view) persisted across launches.

### Platforms
- **Windows desktop** — primary production target.
- **WSL2** — first-class for both development *and* runtime. The Bridge feature is exclusive to this environment.
- **macOS / native Linux** — buildable, but not actively shipped.

## Run from source

```bash
git clone https://github.com/syntheticproduct/prmptr.org
cd prmptr.org
npm install
npm run tauri dev
```

Requires Rust ([rustup](https://rustup.rs/)) and on Linux the usual Tauri system deps:

```bash
sudo apt install libwebkit2gtk-4.1-dev libxdo-dev libssl-dev \
                 libayatana-appindicator3-dev librsvg2-dev pkgconf
```

For color emoji in titles when running `tauri dev` inside WSL2:

```bash
sudo apt install fonts-noto-color-emoji
```

## Build

```bash
npm run tauri build
```

Produces an `.exe` (+ NSIS installer) on Windows, `.dmg` on macOS, `.deb`/`.AppImage` on Linux.

Cross-compile to Windows from Linux works via the `x86_64-pc-windows-gnu` target + `mingw-w64` and `makensis`:

```bash
npm run tauri build -- --target x86_64-pc-windows-gnu --bundles nsis
```

NSIS install mode is `currentUser`, so the resulting installer drops the app under `%LOCALAPPDATA%\prmptr.org\` without UAC and supports silent install (`prmptr.org_<version>_x64-setup.exe /S`).

## Architecture

- **Frontend**: Next.js 16 (App Router, static export, all client components).
- **Editor**: [Milkdown](https://milkdown.dev) (ProseMirror + remark), with a custom inline-WYSIWYG theme.
- **Native shell**: [Tauri 2](https://tauri.app) — Rust backend, ~5MB binary.
- **Rust modules** under [`src-tauri/src/`](src-tauri/src/):
  - `file.rs` — file open/save with `thiserror`-based error surfaces.
  - `cowork.rs` — Claude Cowork session reader (Microsoft Store + classic + WSL auto-detect).
  - `claude_sessions.rs` — Claude Code CLI session log reader.
  - `bridge.rs` — output ↔ workspace reconciliation (copy / symlink / backup), WSL-only.
  - `worktrees.rs` — git worktree discovery and safe cleanup.
  - `reveal.rs` — cross-platform show-in-file-manager.
  - `clipboard.rs` — clipboard with WSL image fallback via PowerShell.
  - `global_settings.rs` — `~/.claude/*` reader + dedicated Settings window.
  - `text_scale.rs` — Windows accessibility text-scale probe.
  - `path_safety.rs` — path canonicalization / containment checks.

## Roadmap

- [x] WYSIWYG editor (Milkdown)
- [x] Native file open/save with file picker
- [x] HTML5 drag-and-drop
- [x] CLI arg path-passing (`prmptr.exe foo.md` opens that file)
- [x] Frontmatter (YAML) round-trip preservation
- [x] Folder tree pane + unsaved-changes guards
- [x] Four-tab shell (Prompt Engineering / Markdown Editing / Cowork / Code)
- [x] Claude Cowork session browser with Microsoft Store + WSL auto-detect
- [x] Claude Code Session Explorer (CLI JSONL logs)
- [x] Bridge: reconcile session outputs with local workspaces (WSL)
- [x] Worktree Janitor
- [x] Global Settings window
- [x] CI hardening (icons committed, LF enforcement, audit job)
- [ ] Claude integration: critique current prompt
- [ ] Structural side panel: section outline + cross-references
- [ ] Variable extraction: detect `{var}` placeholders, prompt for values
- [ ] Code signing (Azure Trusted Signing) + Microsoft Store

## Documentation

- [`CONTRIBUTING.md`](CONTRIBUTING.md) — developer setup, coding conventions, build & release workflow.
- [`SECURITY.md`](SECURITY.md) — security policy, threat model, vulnerability reporting.
- [`PRIVACY.md`](PRIVACY.md) — exactly which files the app reads/writes and what crosses the network (today: nothing).
- [`CHANGELOG.md`](CHANGELOG.md) — Keep-A-Changelog history.

## License

MIT — see [LICENSE](LICENSE).
