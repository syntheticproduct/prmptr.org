# Changelog

All notable changes to prmptr.org are documented here. This project follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Enterprise-grade project scaffolding: `SECURITY.md`, `PRIVACY.md`, `CONTRIBUTING.md`, `CHANGELOG.md`.
- Toolchain pinning: `.nvmrc`, `rust-toolchain.toml`, `.editorconfig`, `.npmrc`, `engines.node` in `package.json`.
- Bundle metadata for Windows installers: publisher, copyright, homepage, short/long description, file associations, stable WiX `upgradeCode` GUID for in-place upgrades.
- Cargo release profile (`lto = "thin"`, `panic = "abort"`, `strip = "symbols"`) and a Clippy/rustfmt lint baseline (`unsafe_code = "forbid"`, `unwrap_used` and friends set to `warn`).
- `scripts/bump-version.mjs` — one-command version sync across `package.json`, `Cargo.toml`, and `tauri.conf.json`.
- Restrictive Content-Security-Policy in `tauri.conf.json` (was `null`).
- Path-allowlist validation on every Rust command that takes a `PathBuf` from the renderer.
- Per-window scoped Tauri capabilities; the `global-settings` window no longer gets file-system commands it doesn't use.
- Structured logging (`log::warn!` / `log::error!`) on every error-but-don't-fail code path in the backend.
- GitHub Actions CI: `tsc --noEmit`, ESLint, `cargo fmt --check`, `cargo clippy -D warnings`, `cargo test`, frontmatter unit tests, Playwright e2e on each push and PR.
- GitHub Actions release: tagged commits produce signed-ready Windows/macOS/Linux installers via `tauri-apps/tauri-action`, attached to the GitHub Release.
- Dependabot for npm + cargo.

### Changed

- `formatError(e: unknown): string` is now imported from `src/lib/errors.ts` instead of being redefined in six components.
- The hardcoded dev-only file path in `src/lib/dev-defaults.ts` reads from `NEXT_PUBLIC_PRMPTR_DEV_FILE` instead of being baked into source.

## [0.1.0] — initial public state

Pre-history: WYSIWYG editor (Milkdown + remark), native file open/save with file picker, HTML5 drag-and-drop, CLI arg path-passing (`prmptr.exe foo.md`), Cowork sessions browser, Session Explorer with archive, Global Settings inspector, frontmatter unit tests, Playwright e2e suite.

[Unreleased]: https://github.com/syntheticproduct/prmptr.org/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/syntheticproduct/prmptr.org/releases/tag/v0.1.0
