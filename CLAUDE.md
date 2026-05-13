# prmptr.org — Claude session brief

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

### Clickable file paths in CHAT OUTPUT — every file I name

Every file path I name in my reply to Camille must be a clickable markdown link with a `file://wsl.localhost/Ubuntu/<absolute-path>` target. This applies to **chat output only** — do NOT put URLs inside file contents.

Format:

```markdown
[`src-tauri/src/cowork.rs`](file://wsl.localhost/Ubuntu/home/camille/projects/prmptr.org/.claude/worktrees/session1/src-tauri/src/cowork.rs)
```

**Why:** Camille reads chat in a Windows terminal that supports clickable hyperlinks. Plain paths force copy-paste; `file://wsl.localhost/Ubuntu/...` URLs open the file directly in his default app.

**Apply to:** every chat reply, every file mention (md, code, config). Include `path:line` references — visible text shows the line, link goes to the file.

**Don't apply to:** file CONTENTS. Don't stuff URLs into CLAUDE.md or memory bodies. Don't apply to paths inside shell commands (`cd /path/...`).

**Worktree paths:** when the same file exists in multiple worktrees, link to the one matching the current working directory of the session.

### Save when asked — same turn, no deferring

When Camille says "save X under Y label so I can find it later" (or any equivalent — "remember this", "save this", "tag this", "label this"), I write `memory/<label>.md` (or update CLAUDE.md) in the same turn. No deferring, no skipping because "context will carry it." A dropped save = lost trust.

### Commit WIP freely during worktree ops

When syncing worktrees, rebasing, merging, or any op that needs a clean tree, commit dirty changes in-place as `WIP: <brief summary>` rather than asking what to do with them. Don't stash, don't skip.

**Why:** Camille said verbatim "assume all work in progress can be saved to main. I take responsibility. I never leave work halfway done and if I do it's on me." Don't interrupt bulk worktree operations with "what about this dirty tree?" questions.

**How:** During bulk ops, commit modified/untracked files as `WIP: <what was being worked on>`. Flag the WIP commits in the summary so he can amend or squash later if he wants.

### Worktree icons — copy before building

`src-tauri/icons/*.png` and `src-tauri/icons/ios/` are gitignored (`.gitignore` line 50: `*.png`). Only `icon.icns`, `icon.ico`, and the Android XMLs are in git.

A fresh `.claude/worktrees/<name>/` will fail late in `cargo build` with `failed to open icon .../icons/32x32.png` after ~5 min of compiling. Copy them BEFORE starting the build:

```
cp /home/camille/projects/prmptr.org/src-tauri/icons/*.png <worktree>/src-tauri/icons/
cp -r /home/camille/projects/prmptr.org/src-tauri/icons/ios <worktree>/src-tauri/icons/
```

### Numbered worktree sessions are intentional

`.claude/worktrees/session1`, `session2`, `session3`, `session4` are **intentional parallel workspaces Camille uses for concurrent Claude Code sessions.** They are NOT clutter, NOT empty backups, NOT safe to delete. Even when one looks empty or sits behind main, leave it alone.

Auto-generated-looking names (e.g. `elegant-singing-fairy`, `piped-drifting-hickey`) — different story, usually safe to clean.

Catching a numbered session up to main is fine; deleting one is not unless Camille explicitly asks.

### WSL dev setup — one-time fixes

When running `npm run tauri dev` inside WSL2:

1. **Install color emoji font** (else titles with emojis render as boxes):
   ```
   sudo apt install fonts-noto-color-emoji
   ```
   Verify: `fc-list | grep -i emoji` should show `NotoColorEmoji.ttf`. Affects WSL dev only — Windows production builds use WebView2 + Segoe UI Emoji and are fine.

2. **Expected harmless console noise** under WSLg — don't chase these as bugs:
   ```
   libEGL warning: failed to get driver name for fd -1
   MESA: error: ZINK: failed to choose pdev
   libEGL warning: egl: failed to create dri2 screen
   ```
   These are GPU passthrough trying hardware GL, failing, falling back to software rendering (which works). If something else also breaks, that something-else is the real issue.

### File ownership & redundancy preference

- **CLAUDE.md is Camille's** — only edit it when asked. Don't auto-inject content. The Vercel `<!-- BEGIN:nextjs-agent-rules -->` block in `AGENTS.md` is the kind of auto-managed content he wants to AVOID — keep new content in CLAUDE.md, not AGENTS.md.
- **Redundancy > deduplication** — Camille explicitly said "duplicated content can only help given that you 'forget' pretty consistently." Don't propose merging memory + CLAUDE.md. Don't dedupe.
- **Mirror new memory into CLAUDE.md** — whenever a memory file is created (by me or by Camille's auto-memory linter), inline its substance into CLAUDE.md the same turn. Same source, two homes.

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

[`file://wsl.localhost/Ubuntu/home/camille/projects/prmptr.org/CLAUDE.md`](file://wsl.localhost/Ubuntu/home/camille/projects/prmptr.org/CLAUDE.md)

# Standing rules

## Every file I write gets a clickable `file://` URL at the top

Every markdown / doc / brief file I create or edit (memory entries, CLAUDE.md itself, scratch docs, anything user-facing on disk) must include a clickable `file://wsl.localhost/Ubuntu/...` URL on its own line near the top, pointing at the file's own absolute path.

**Format** — markdown link with the URL as both text and href:

```
[`file://wsl.localhost/Ubuntu/home/camille/path/to/file.md`](file://wsl.localhost/Ubuntu/home/camille/path/to/file.md)
```

Place it directly under the H1 or frontmatter, on its own line.

**Why:** Camille works on Windows over WSL. The `file://wsl.localhost/Ubuntu/<absolute-path>` URL renders as a clickable link in his Windows tools (Markdown viewers, Claude Desktop, etc.) and opens the file directly. Without it he has to copy-paste paths into a file picker.

**Scope:**
- Apply to: every `.md` / doc file written or edited via Write/Edit. If editing an existing markdown file that lacks the header URL, add it.
- Skip: source code files (`.rs`, `.ts`, `.tsx`, `.css`, `.json`, etc.) — those use `file_path:line_number` references in chat replies instead.
- Use the canonical main-checkout path when one exists, not a worktree-specific path.

Mirrored from `memory/feedback_file_url_header.md` per the "mirror memories into CLAUDE.md" rule in `memory/feedback_file_truth_ownership.md`.
