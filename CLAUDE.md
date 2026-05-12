# prmptr.org — Claude session brief

[`file://wsl.localhost/Ubuntu/home/camille/projects/prmptr.org/CLAUDE.md`](file://wsl.localhost/Ubuntu/home/camille/projects/prmptr.org/CLAUDE.md)

Camille's single source of truth. Edit directly. Loads into every Claude Code session in this repo. All relevant memories are inlined below so nothing depends on auto-loading other files.

---

## What this app is

Tauri (Rust + Next.js + Milkdown) desktop companion for prompt engineering: write, version, and analyze reusable LLM prompts. The current build is a **minimal editor + Cowork sessions browser**. The north-star vision is **the roadmap** (below).

---

## The roadmap — north-star design spec

When Camille says "the roadmap" / "specs" / "design", he means the high-fidelity design handoff at:

- Full spec README: [`file://wsl.localhost/Ubuntu/home/camille/.claude/projects/-home-camille/memory/refs/prmptr-roadmap/design_handoff_prmptr_companion/README.md`](file://wsl.localhost/Ubuntu/home/camille/.claude/projects/-home-camille/memory/refs/prmptr-roadmap/design_handoff_prmptr_companion/README.md)
- Reference prototype (NOT production code; recreate in our Tauri + Next.js + Milkdown stack): [`file://wsl.localhost/Ubuntu/home/camille/.claude/projects/-home-camille/memory/refs/prmptr-roadmap/design_handoff_prmptr_companion/design/`](file://wsl.localhost/Ubuntu/home/camille/.claude/projects/-home-camille/memory/refs/prmptr-roadmap/design_handoff_prmptr_companion/design/)
- Original zip was at `C:\Users\camil\Downloads\prmptr.org.zip` (may have been cleaned up).

### One-line shape

Three-column desktop layout in a custom window shell:

- **Titlebar 38px**, bg `#2b2926`, macOS-style traffic lights top-left (12×12px gap 8px: `#ff5f57` / `#febc2e` / `#28c840`), centered title `prmptr.org — <filename>` in JetBrains Mono 12.5px / 500 with `.org` in violet `#b89aff`
- **Sidebar 264px** (`#1c1b1a`): "New prompt" violet-tinted button (⌘N), search (⌘K), library grouped Pinned/Today/This week/Older, user footer
- **Editor center** (flex 1, `#161514`): 22px title input + meta row (`v4` version pill, token estimate, save state); transparent textarea over highlight `<pre>` for live `{{variable}}` (violet) + markdown heading (bold white)
- **Right pane 348px**: segmented `Analyze` / `Graph` / `Punchup` tabs
- **Status bar 28px**: chars · lines · vars · tokens · ready · UTF-8 · LF · save state

### Canonical palette (already in `src/app/globals.css` — "per the roadmap design spec")

- Bg `#161514`, elev `#1c1b1a` / `#232220` / `#2a2826` / `#322f2c`
- Text `#ece9e3` / `#b8b3aa` / `#807a71` / `#4f4a44`
- Accent violet `#b89aff` (var highlight bg `rgba(184,154,255,0.14)`)
- Section role colors: id `#6ecf9f`, ctx `#6ea3cf`, task `#b89aff`, constraint `#e8a26a`, output `#d97a8e`
- Borders `rgba(255,255,255,0.05)` / `0.09`

### Typography

JetBrains Mono for code / meta / keycaps / status. Helvetica/system sans for UI labels.

### Status

The roadmap is the north star, not a to-do list. Cherry-pick features per the conversation — don't try to ship it all at once (~2–3 weeks of work end-to-end).

---

## Platforms — all first-class

- **Windows desktop** — primary production target.
- **WSL2** — first-class for both development AND runtime. A Windows user living in WSL is a real user, not a dev edge case. The Tauri Linux build, run inside WSL, reads Windows-side Claude Desktop data via `/mnt/c/...` auto-detect (see `src-tauri/src/cowork.rs::wsl_cowork_candidates`). Don't optimize Windows at WSL's expense.
- **macOS / native Linux** — not actively shipped, but don't write code that's gratuitously Windows-only.

---

## Engineering values (heuristic for unsupervised decisions)

1. **Stable** — fail soft. Empty arrays + a warning banner beat a panic.
2. **Resilient** — handle missing files, locked DBs, multi-user installs, env quirks. Always have a fallback.
3. **Best practices** — types everywhere; tests for non-trivial logic; no dead code paths. Prefer editing over creating; no abstraction without a concrete second caller.
4. **Enterprise-grade** — no hardcoded usernames/paths; honor env overrides (`PRMPTR_COWORK_PATH`, `PRMPTR_COWORK_LOCALSTORAGE_PATH`); handle Microsoft Store + classic install variants; auto-detect platforms.

---

## Working principles

- **Drive to completion.** Default is "work as far as you can without stopping, make sensible decisions per the values above." Only pause for irreversible/risky operations (force-push, destructive deletes, prod writes) or genuine ambiguity. Don't bail at the first warning.
- **Self-test before claiming done.** Run tests, run the build, restart the dev server, click through. "Compiles" ≠ "works." If you can't verify a UI change yourself, say so explicitly.
- **Commit and push at milestones.** Camille's branches have crashed before — uncommitted work has been lost. Push early.
- **Read before you write.** Don't trust LLM training data on Next.js, Tauri, or this codebase's conventions. Read the file. Read `node_modules/next/dist/docs/` for Next.js specifics.

---

## Standing rules (formerly memory entries)

### File URL header — apply to EVERY file I write

Every file I create — `CLAUDE.md`, brief docs, scratch notes, any markdown a human will revisit — must start with a clickable `file://wsl.localhost/Ubuntu/...` URL on its own line, pointing at the file's own absolute path. Format:

```
[`file://wsl.localhost/Ubuntu/home/camille/path/to/file.md`](file://wsl.localhost/Ubuntu/home/camille/path/to/file.md)
```

**Why:** Camille works on Windows with WSL underneath. The `file://wsl.localhost/Ubuntu/<absolute-path>` URL is clickable from Windows Markdown viewers and opens the file in his editor. Without it he has to copy-paste paths into a file picker. He's asked for this before.

**Scope:** all markdown / text files I write. Skip for code (`.rs`, `.ts`, `.tsx`, `.css`) — there I use `file_path:line_number` references in chat instead.

### Save when asked — same turn, no deferring

When Camille says "save X under Y label so I can find it later" (or any equivalent — "remember this", "save this", "tag this", "label this"), I write `memory/<label>.md` (or update CLAUDE.md) in the same turn. No deferring, no skipping because "context will carry it." A dropped save = lost trust.

### Worktree icons — copy before building

`src-tauri/icons/*.png` and `src-tauri/icons/ios/` are gitignored (`.gitignore` line 50: `*.png`). Only `icon.icns`, `icon.ico`, and the Android XMLs are in git.

A fresh `.claude/worktrees/<name>/` will fail late in `cargo build` with `failed to open icon .../icons/32x32.png` after ~5 min of compiling. Copy them BEFORE starting the build:

```
cp /home/camille/projects/prmptr.org/src-tauri/icons/*.png <worktree>/src-tauri/icons/
cp -r /home/camille/projects/prmptr.org/src-tauri/icons/ios <worktree>/src-tauri/icons/
```

---

## Where things live

- **Rust backend** — `src-tauri/src/`
  - `cowork.rs` — Cowork session reader, pin-order from Local Storage LevelDB, WSL auto-detect
  - `lib.rs` — Tauri command wiring
- **Frontend** — `src/`
  - `app/page.tsx` — main shell
  - `components/CoworkSessions.tsx` — Cowork browser modal
  - `components/FolderTreePane.tsx` — left folder pane (resizable)
  - `lib/tauri-fs.ts` — invoke wrappers
- **Styles** — `src/app/globals.css` (canonical palette + typography, per the roadmap)
- **Memory** (auto-loads, may overlap with this file) — [`file://wsl.localhost/Ubuntu/home/camille/.claude/projects/-home-camille-projects-prmptr-org/memory/`](file://wsl.localhost/Ubuntu/home/camille/.claude/projects/-home-camille-projects-prmptr-org/memory/)

---

@AGENTS.md
