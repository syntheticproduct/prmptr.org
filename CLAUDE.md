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
[`src-tauri/src/cowork.rs`](file://wsl.localhost/Ubuntu/home/camille/projects/prmptr.org/.claude/worktrees/worktree1/src-tauri/src/cowork.rs)
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

### Default build target — Windows, no asking

When Camille says "build", "release", "install locally", or anything similar in this repo, default to a **Windows** build. Don't ask which platform.

Cross-compile from WSL with the GNU target (MinGW + NSIS already installed):

```
npm run tauri build -- --target x86_64-pc-windows-gnu --bundles nsis
```

Artifacts land in `src-tauri/target/x86_64-pc-windows-gnu/release/bundle/nsis/*.exe`. "Install locally" = launch that `.exe` from Windows (`cmd.exe /c start ...` from WSL works). No Rust on Windows; no MSVC build path. WSL has `x86_64-pc-windows-gnu` target installed and `/usr/bin/x86_64-w64-mingw32-gcc` + `/usr/bin/makensis`.

### Always build + silent install + launch when done

After completing any task in this repo, run the full **build → silent install → launch** loop on Windows as part of "done" — Camille shouldn't have to ask each time. He verifies features by clicking through the installed app, not by reading diffs, and "build only" leaves the install + launch on his plate.

**How (all three steps, every time):**

1. **Build** — `npm run tauri build -- --target x86_64-pc-windows-gnu --bundles nsis`. Copy icons first in fresh worktrees (rule further down).

2. **Silent install** — copy the artifact to a Windows-side dir first (a `cmd.exe` invocation from a `\\wsl.localhost\...` cwd rejects with "UNC paths not supported"), then:
   ```
   cp src-tauri/target/x86_64-pc-windows-gnu/release/bundle/nsis/prmptr.org_<ver>_x64-setup.exe /mnt/c/Users/camil/Downloads/
   powershell.exe -NoProfile -Command "Start-Process -Wait -PassThru -FilePath 'C:\Users\camil\Downloads\prmptr.org_<ver>_x64-setup.exe' -ArgumentList '/S' -WorkingDirectory 'C:\Users\camil\Downloads'"
   ```
   `/S` is NSIS silent mode. Don't use `cmd.exe /c start /wait ... /S` from a WSL cwd — surfaces a "Windows cannot find '\\\\'" dialog to Camille.

3. **Launch** — Tauri NSIS currentUser installs land at `C:\Users\camil\AppData\Local\prmptr.org\prmptr.exe` (no `\Programs\` subfolder; that's a different installer convention):
   ```
   powershell.exe -NoProfile -Command "Start-Process -FilePath 'C:\Users\camil\AppData\Local\prmptr.org\prmptr.exe' -WorkingDirectory 'C:\Users\camil\AppData\Local\prmptr.org'"
   ```

**Skip the loop when:** the turn made no code change (chat-only, planning, research), Camille explicitly says "don't build," or the work is WIP/experimental that won't actually run yet. When in doubt, run it.

Report the installer path AND launched PID in the wrap-up so Camille knows which build is in front of him.

### Trunk-based discipline across worktrees

`main` on origin is the integration point. The four numbered worktrees each sit on their own branch (`worktree-1`–`worktree-4`) — those branches exist as ephemeral perches to satisfy git's "one worktree per branch" rule, not as meaningful divergent lines of work. After every push cycle a worktree branch is equal to main again.

The flow, run from inside the numbered worktree:

1. **Pull main first.** `git pull origin main` — with `pull.rebase=true` set, this rebases the worktree branch onto current `origin/main`. Start every micro-feature from fresh main.
2. **Work and commit** on the worktree branch. Multiple small commits are fine.
3. **Cheap sanity check** (see next rule).
4. **Push the worktree branch's tip directly to main.** `git push origin HEAD:main` — `HEAD:main` means "take whatever this branch is pointing at and push it as `origin/main`." Lands as a fast-forward.

If the push is rejected as non-fast-forward, another worktree got there first. Re-pull (`git pull origin main` rebases your work onto the new main) and re-push. Repeat until it lands.

After a successful push, the worktree branch and `origin/main` are equal — no cleanup needed, no merge commits in history. The next micro-feature starts at step 1 again.

### Sanity check before every push

"Compiles" still ≠ "works" per the working principles, but a syntax/type break propagating to every other worktree's next pull is the bug to prevent. Run before every `git push origin HEAD:main`:

- Frontend changes touched: `npx tsc --noEmit`
- Rust changes touched: `cargo check` (from `src-tauri/`)
- Either, when in doubt: both.

Skip the full `npm run build` — too slow for the loop. The cheap check catches the breakage class that would poison other worktrees on their next pull. If the cheap check fails, fix and re-check before pushing. Never push a known-red tree.

### Conflicts during pull/rebase — halt and alert

If `git pull origin main` hits a rebase conflict:

- **Truly trivial** (whitespace-only; import order; clearly compatible edits in unrelated parts of the same file): resolve it, continue the rebase, proceed. The bar for "trivial" is "I'd bet a coffee Camille would do it the same way."
- **Anything else**: `git rebase --abort`. Print a loud, clear message in chat — which file, which hunk, which worktree, what was being worked on. Then stop and wait. Don't guess at semantic merges that involve code another worktree is touching.

The existing WIP rule still applies for uncommitted work that blocks the pull — commit it as `WIP: <summary>` first.

### Worktree icons — copy before building

`src-tauri/icons/*.png` and `src-tauri/icons/ios/` are gitignored (`.gitignore` line 50: `*.png`). Only `icon.icns`, `icon.ico`, and the Android XMLs are in git.

A fresh `.claude/worktrees/<name>/` will fail late in `cargo build` with `failed to open icon .../icons/32x32.png` after ~5 min of compiling. Copy them BEFORE starting the build:

```
cp /home/camille/projects/prmptr.org/src-tauri/icons/*.png <worktree>/src-tauri/icons/
cp -r /home/camille/projects/prmptr.org/src-tauri/icons/ios <worktree>/src-tauri/icons/
```

### Numbered worktrees are intentional

`.claude/worktrees/worktree1`, `worktree2`, `worktree3`, `worktree4` are **intentional parallel workspaces Camille uses for concurrent Claude Code sessions.** They are NOT clutter, NOT empty backups, NOT safe to delete. Even when one looks empty or sits behind main, leave it alone.

Auto-generated-looking names (e.g. `elegant-singing-fairy`, `piped-drifting-hickey`) — different story, usually safe to clean.

Catching a numbered worktree up to main is fine; deleting one is not unless Camille explicitly asks.

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
