# prmptr.org

A WYSIWYG markdown editor for prompt engineers. Built with Tauri + Next.js. MIT licensed.

**Status**: early. Working end-to-end (Milkdown editor, native file open/save, drag-drop) but rough.

## Why

The tooling for editing long, structured LLM prompts is bad. You either:
- Live in a textarea and squint at raw markdown, or
- Use a general-purpose editor (VS Code, Obsidian) that doesn't know prompts have headings + XML tags + structure that matters.

`prmptr` is what an editor built specifically for prompts looks like. XML tags as first-class citizens, byte-perfect markdown round-trip via remark, structural awareness coming next.

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

## Build

```bash
npm run tauri build
```

Produces an `.exe` (+ NSIS installer) on Windows, `.dmg` on macOS, `.deb`/`.AppImage` on Linux. Cross-compile to Windows from Linux works via the `x86_64-pc-windows-gnu` target + `mingw-w64`.

## Architecture

- **Frontend**: Next.js 16 (App Router, static export, all client components).
- **Editor**: [Milkdown](https://milkdown.dev) (ProseMirror + remark), with a custom inline-WYSIWYG theme.
- **Native shell**: [Tauri 2](https://tauri.app) — Rust backend, ~5MB binary.
- **File I/O**: custom Rust commands (`read_prompt_file` / `write_prompt_file`) with `thiserror`-based error handling, surfacing serializable errors to the React side.

## Roadmap

- [x] WYSIWYG editor (Milkdown)
- [x] Native file open/save with file picker
- [x] HTML5 drag-and-drop
- [x] CLI arg path-passing (`prmptr.exe foo.md` opens that file)
- [x] Frontmatter (YAML) round-trip preservation
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
