# Contributing to prmptr.org

Thanks for your interest. prmptr.org is early-stage open source — drive-by patches, bug reports, and design feedback are all welcome.

## Quick start

```bash
git clone https://github.com/syntheticproduct/prmptr.org
cd prmptr.org
nvm use            # uses .nvmrc
npm install
npm run tauri dev
```

You'll need Rust ([rustup](https://rustup.rs/)) — the [`rust-toolchain.toml`](rust-toolchain.toml) will auto-install the pinned version on first build.

On Linux you also need:

```bash
sudo apt install libwebkit2gtk-4.1-dev libxdo-dev libssl-dev \
                 libayatana-appindicator3-dev librsvg2-dev pkgconf
```

## Project layout

- **`src/`** — Next.js 16 (App Router) frontend. All components are `"use client"` because the production build is a static export consumed by Tauri.
- **`src/components/`** — React components. Discriminated-union state machines for async (`{ kind: "idle" | "loading" | "ok" | "err"; … }`); no Redux/Zustand.
- **`src/lib/`** — Pure TypeScript helpers (`tauri-fs.ts` for invoke wrappers, `frontmatter.ts`, `errors.ts`).
- **`src-tauri/`** — Rust backend.
- **`src-tauri/src/`** — One module per concern (`file.rs`, `cowork.rs`, `claude_sessions.rs`, `clipboard.rs`, `global_settings.rs`). Each module owns its own `thiserror`-derived error type with a hand-written `Serialize` impl so errors round-trip type-safely to the JS side.
- **`src-tauri/capabilities/`** — Per-window Tauri capability ACLs. Tighten before adding new windows; default to deny.
- **`tests/e2e/`** — Playwright end-to-end specs. Run with `npm run test:e2e`.

## Running checks

Before pushing, run the same gates CI runs:

```bash
npm run check            # tsc --noEmit + eslint
npm run test:unit        # frontmatter and other ts unit tests
cargo fmt --check --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings
npm run test:rust        # cargo test
npm run test:e2e         # Playwright (slower, needs a built app for some specs)
```

## Coding conventions

- **No `any` and no `as any` in TypeScript.** Build a typed boundary at every IPC call; see `src/lib/tauri-fs.ts`.
- **No `unwrap()` or `expect()` in Rust outside tests** unless the failure path is genuinely unreachable in production (e.g., a `Mutex::lock` immediately after construction). Clippy is set to warn on both; treat new warnings as a code smell.
- **No `unsafe`.** The crate sets `unsafe_code = "forbid"`.
- **Errors are typed enums.** Each module's commands return `Result<T, ModuleError>` where `ModuleError` is a `thiserror::Error` with a manual `Serialize` impl emitting `{ kind, message }`. Don't return `Result<_, String>` from a new command.
- **Paths from the renderer are untrusted.** Any new `#[tauri::command]` that takes a `PathBuf` must call `validate_path()` (or the local equivalent) before touching disk.
- **Defaults > config.** New behavior should work with zero env vars set. Env vars exist as escape hatches for unusual installs, not as the happy path.

## Commits and PRs

- Use Conventional Commit-shape prefixes when natural: `feat:`, `fix:`, `chore:`, `docs:`, `test:`. Not enforced.
- Squash-and-merge by default. Keep PR titles short; put the "why" in the body.
- Reference the issue you're fixing in the PR body when one exists.

## Building Windows binaries

Even on Linux/WSL the project cross-compiles to Windows out of the box:

```bash
npm run tauri build -- --target x86_64-pc-windows-gnu --bundles nsis
```

Artifacts land in `src-tauri/target/x86_64-pc-windows-gnu/release/bundle/nsis/*.exe`. The MinGW toolchain (`x86_64-w64-mingw32-gcc`) and `makensis` must be on `$PATH`.

## Versioning and releases

`npm run version:bump <new-version | patch | minor | major>` synchronises the version across `package.json`, `Cargo.toml`, and `tauri.conf.json`. Don't bump by hand — the three files will drift.

Tag-driven releases (`git tag vX.Y.Z && git push --tags`) trigger `.github/workflows/release.yml`, which builds installers and attaches them to the GitHub Release.

## Security

Found a vulnerability? Email **camille.lambert+prmptr-security@gmail.com** — see [`SECURITY.md`](SECURITY.md). Don't open a public issue for security problems.

## License

Contributions are accepted under the project's [MIT License](LICENSE). By submitting a PR you assert that the work is yours to license under those terms.
