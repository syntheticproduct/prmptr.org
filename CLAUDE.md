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
