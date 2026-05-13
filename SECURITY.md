# Security Policy

## Supported Versions

prmptr.org is pre-1.0 software. Security fixes ship on the **latest** released version. Older versions are not patched.

| Version | Supported |
|---------|-----------|
| Latest  | Yes       |
| Older   | No        |

## Reporting a Vulnerability

If you find a security issue, please **do not** open a public GitHub issue or pull request.

Email: **camille.lambert+prmptr-security@gmail.com**

Please include:

- A description of the issue and its impact
- Steps to reproduce
- The version (build hash or installer filename is fine)
- Your contact information for follow-up
- Whether you would like to be credited in the fix announcement

You should expect an initial reply within **5 business days**. We aim to ship a fix or mitigation within **30 days** of confirmation for issues with a published exploit path, and within **90 days** for issues that require non-trivial design changes. We coordinate disclosure with the reporter when timelines need to shift.

## Scope

In scope:

- The Tauri desktop application binary (`prmptr.exe`, `prmptr.app`, the Linux binaries) and the bundled web frontend.
- The Rust commands exposed via `tauri::generate_handler!` in [`src-tauri/src/lib.rs`](src-tauri/src/lib.rs).
- The installer (NSIS / MSI on Windows, `.dmg` / `.deb` / `.AppImage` / `.rpm` elsewhere).

Out of scope:

- Vulnerabilities in third-party services we read from but do not modify (e.g. Claude Desktop's session storage). Report those upstream.
- Social-engineering attacks that require the user to download and run an installer from a non-official source. Always verify installer signatures and the publisher field.
- Issues that require the attacker to already have write access to the user's home directory, AppData, or shell environment.
- Outdated dependencies without a demonstrated exploit path against prmptr.org. We watch Dependabot for these.

## Threat model

prmptr.org runs as the **user's own process**, in the user's session, with the user's filesystem permissions. It does not run as a service, it does not bind to network ports, and it does not phone home — the binary has no outbound HTTP at all today.

The realistic attack vectors we design against:

1. **Malicious markdown opened in the editor.** A `.md` file is data, not code. The editor renders markdown via Milkdown / ProseMirror — no script execution, no live HTML evaluation. CSP is set to default-deny in the production webview.
2. **Path-traversal in Rust commands.** Commands that take a `PathBuf` argument (file open/save, archive moves) canonicalize and bounds-check before touching disk. See `validate_path()` callsites in [`src-tauri/src/file.rs`](src-tauri/src/file.rs) and [`src-tauri/src/cowork.rs`](src-tauri/src/cowork.rs).
3. **Compromised installer / supply chain.** Installers shipped from the official GitHub Releases page are built by GitHub Actions from a tagged commit, with the build provenance recorded in the workflow run. Verify the publisher field, the GitHub Actions run URL on the release page, and (when published) the code-signing signature before installing.

## What we explicitly do NOT do

- We do not collect telemetry. The binary makes no outbound HTTP calls.
- We do not ship a built-in updater that fetches and runs arbitrary code. (When an updater ships, it will verify Ed25519 signatures on every update bundle.)
- We do not register a URL handler or shell extension that could be triggered by a remote site.

## Data prmptr.org reads

prmptr.org is a local editor; it touches the user's own files. For full detail of every path the app reads on disk and why, see [`PRIVACY.md`](PRIVACY.md).
