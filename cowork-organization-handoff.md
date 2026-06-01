# Cowork tab organization - prior-art handoff

This document captures the read/write surface and tooling we have already built in this project (`prmptr.org`) for inspecting and manipulating the Cowork tab of Claude Desktop on Windows. It is intended as prior-art context for a separate, deeper research run focused on technical feasibility, durability across Claude Desktop updates, and the gaps we have not solved.

Code references are to the working tree at `/home/camille/projects/prmptr.org` and use the current `main` commit (`36f01d4` or later). Line numbers are accurate at the time of writing but may drift.

Claude Desktop build under inspection: Microsoft Store install on Windows 11, package family name `Claude_pzs8sxrjxfjjc`. Exact app version string not currently captured by our tooling.

---

## Section 1 - Read access

### Filesystem layout

Claude Desktop stores per-Cowork-session metadata as JSON files on disk. Two install variants are supported by our reader:

1. Microsoft Store install (the variant we have actually verified):
   - Windows path: `%LOCALAPPDATA%\Packages\Claude_pzs8sxrjxfjjc\LocalCache\Roaming\Claude\local-agent-mode-sessions\<orgId>\<userId>\`
   - WSL equivalent: `/mnt/c/Users/<user>/AppData/Local/Packages/Claude_pzs8sxrjxfjjc/LocalCache/Roaming/Claude/local-agent-mode-sessions/<orgId>/<userId>/`

2. Classic (non-Store) install (path supported in code, not directly verified by us because we are on the Store install):
   - Windows path: `%APPDATA%\Claude\local-agent-mode-sessions\<orgId>\<userId>\`
   - WSL equivalent: `/mnt/c/Users/<user>/AppData/Roaming/Claude/local-agent-mode-sessions/<orgId>/<userId>/`

The two-level `<orgId>/<userId>/` nesting matches the user's logged-in Anthropic org and user IDs. Both are UUIDs. We do not currently parse what they mean beyond using them as directory keys.

Auto-detection logic lives in `src-tauri/src/cowork.rs::cowork_root` and `src-tauri/src/cowork.rs::wsl_cowork_candidates`. It probes both install variants per Windows user under `/mnt/c/Users/` when running inside WSL, skipping reserved pseudo-users (`Public`, `Default`, `Default User`, `All Users`). Two environment-variable overrides exist:

- `PRMPTR_COWORK_PATH` - explicit override of the `local-agent-mode-sessions` root.
- `PRMPTR_COWORK_LOCALSTORAGE_PATH` - explicit override of the Local Storage leveldb directory (used for pin-order reads).

### Per-session file shape

For each session there are three sibling artifacts under `<orgId>/<userId>/`:

1. `local_<sessionUuid>.json` - the metadata file we read.
2. `local_<sessionUuid>.json.bak` - a sibling backup written by Claude Desktop. We skip it on read.
3. `local_<sessionUuid>/` - a directory holding the session's runtime artifacts:
   - `audit.jsonl` - turn-by-turn log of the session, JSON-Lines format.
   - `outputs/` - work products Claude wrote during the session.
   - `uploads/` - files the user provided to the session.
   - `.claude/` - Claude-internal config for that session.
   - `.audit-key` - small (~75 byte) file presumed to be an audit-log signing key. Contents not parsed by us.

### Conversation metadata schema

The fields we successfully parse from the per-session `.json` are listed in `src-tauri/src/cowork.rs::RawSession` (lines 71-92). All fields are optional in our parser (`#[serde(default)]`) so missing fields are tolerated. Keys on disk are camelCase:

| Field | Type | Use |
|---|---|---|
| `sessionId` | string (`local_<uuid>`) | Stable identifier. We fall back to the filename stem if the field is missing. |
| `title` | string | Sidebar label. |
| `createdAt` | int64 (ms) | Creation timestamp. |
| `lastActivityAt` | int64 (ms) | Drives default Recents ordering (we sort descending by this). |
| `model` | string | Model used. Not used for placement, just displayed. |
| `isStarred` | bool | Pinned-section membership. |
| `isArchived` | bool | Archived flag. Hidden from default Recents view in our UI; whether Claude Desktop itself hides archived sessions from its own sidebar is not independently verified. |
| `cwd` | string | Working directory for the session. |
| `initialMessage` | string | First user message - used as a preview/snippet. |

Additional fields almost certainly exist in the JSON (model parameters, slash commands, MCP tools, system messages, etc.) but we have not parsed them. Our writer (see Section 2) preserves them verbatim by treating the file as untyped JSON during mutation.

What is "Cowork" vs other Claude Desktop surfaces: the directory name itself (`local-agent-mode-sessions`) is the discriminator. Cowork mode sessions live here. We have not inspected what surface(s) live elsewhere under `…/Claude/`. The chat history of the regular (non-Cowork) Claude Desktop sidebar is likely elsewhere; we have not located it.

### Sidebar placement and ordering

- Recents section: drawn from sessions where `isArchived` is false (we sort by `lastActivityAt` descending in our reader; whether the actual Claude Desktop sidebar uses the same key is presumed but not confirmed).
- Pinned section: drawn from sessions where `isStarred` is true.
- Pinned ordering: NOT stored in the per-session JSON. It lives in Chromium Local Storage at:
  - Microsoft Store: `%LOCALAPPDATA%\Packages\Claude_pzs8sxrjxfjjc\LocalCache\Roaming\Claude\Local Storage\leveldb\`
  - Classic: `%APPDATA%\Claude\Local Storage\leveldb\`
- The order is encoded as a JSON array of strings of the form `"cowork:local_<uuid>"` under a `pinnedOrder` key inside a larger Zustand persist blob.

Our extraction strategy is a byte-scan of the LevelDB `.ldb` and `.log` data files (see `src-tauri/src/cowork.rs::extract_latest_pinned_order` at lines 414-433). We deliberately do NOT use a proper LevelDB client because:

1. The DB is locked by Claude Desktop while it is running.
2. On WSL, the LOCK file refuses to be read when WSL is bridging it from the Windows side.
3. We do not write to LevelDB, so a full client is unnecessary.

The byte-scan looks for the literal `"pinnedOrder":[` byte sequence, walks the array body with quote and bracket awareness (`find_array_end` at lines 438-468), and extracts every `cowork:local_<uuid>` token (`extract_session_ids` at lines 473-495). When multiple occurrences are present (LevelDB log files append), we pick the one in the most-recently-modified file, and within a file we pick the last occurrence in byte order. There are unit tests at lines 706-786 exercising the array parser and ID extraction.

### Grouping/folder/tag metadata

To our knowledge, no `tag`, `folder`, `groupId`, or similar grouping field appears in the per-session schema we have parsed. The data model appears flat: each session is a sibling JSON under `<orgId>/<userId>/`. We have not exhaustively dumped every field in a session JSON, so it is possible a grouping field exists and we have not noticed it. This is one of the open questions (Section 6).

---

## Section 2 - Write and reorganize access

All writes are direct file edits. We do not use IPC with Claude Desktop, do not call any accessibility API, do not write to LevelDB.

### Operations we have implemented and successfully exercised

| Operation | Mechanism | Code location | Claude Desktop state required |
|---|---|---|---|
| Toggle `isArchived` (archive/unarchive) | Direct JSON edit | `cowork.rs::set_cowork_archived` (lines 542-581), `cowork.rs::write_archived_field` (lines 583-593). | Either. See caveat below. |
| Hard-delete a session | `fs::remove_file` + sibling cleanup | `cowork.rs::delete_cowork_session` (lines 663-700). Removes `local_<id>.json`, `.bak`, and the sibling directory. | Either. |
| Open a single Cowork session in its own viewer window inside prmptr | Tauri webview window | `cowork.rs::open_cowork_session_window` (lines 599-654). | Either - this is internal to prmptr, no Claude Desktop side effect. |

The archive write is the only field mutation we currently perform. The implementation reads the full JSON as `serde_json::Value`, mutates only the `isArchived` key, and writes the serialized result back. Every other field in the JSON (model parameters, slashCommands, MCP tools, system messages, etc.) is preserved byte-equivalent through `serde_json::to_string`, modulo any whitespace normalization that the serializer applies.

Path safety: all writers funnel input paths through `src-tauri/src/path_safety.rs::validate_under_root`, which canonicalizes the path and rejects anything that resolves outside the detected cowork root. This is enforced so a malicious or buggy frontend cannot coerce these commands into mutating arbitrary JSON files elsewhere on disk.

### Operations we have NOT implemented as writes

- Pinning / unpinning a session (toggling `isStarred`): we read the field, we do not currently have a command that writes it. The same JSON-edit mechanism as archiving would extend trivially. Caveat: the `pinnedOrder` LevelDB entry would not be updated, which may produce inconsistent sidebar state in Claude Desktop until the user manually re-pins or restarts.
- Reordering pinned sessions: would require writing to the LevelDB `pinnedOrder` array. We have not attempted this. See Section 3.
- Tagging or grouping: no schema for this. Adding a new field is untried. See Section 3.
- Renaming (changing `title`): same JSON-edit mechanism would apply; not implemented.

### Caveat documented in code about concurrent writes

From `cowork.rs` lines 540-541:

> Caveat: if Claude Desktop has the session open it may re-serialize the file on session close and overwrite our change. UI should warn.

In practice, the safest sequence is to perform writes when Claude Desktop is either fully closed, or has the affected session(s) not currently in view. We do not have a programmatic way to know whether a given session is "open" inside Claude Desktop.

### Tauri command surface (registered in `src-tauri/src/lib.rs::run` at line 87)

The following Cowork-related commands are exposed to the frontend via `tauri::generate_handler!`:

- `list_cowork_sessions` - returns `CoworkListing { sessions, pinnedOrder, pinnedOrderWarning }`.
- `set_cowork_archived` - takes `(paths: Vec<PathBuf>, archived: bool)`, returns per-path success/failure.
- `open_cowork_session_window` - opens a per-session viewer window inside prmptr.
- `delete_cowork_session` - hard-delete one session and its sibling artifacts.

TypeScript bindings: `src/lib/tauri-fs.ts` at lines 115-188. Types: `CoworkSummary`, `CoworkListing`, `ArchiveOutcome`, `FailedUpdate`.

---

## Section 3 - Not yet tried or cautious areas

### Writing to the LevelDB pinnedOrder

We have not attempted this. Concerns:

1. LevelDB lock contention: the DB is held by Claude Desktop while it is running. Writes would require either closing Claude Desktop or using a LevelDB-aware writer that respects the lock protocol, which would still race against Claude.
2. Binary format risk: the `pinnedOrder` value lives inside a larger Zustand persist blob with its own schema. Editing only the `pinnedOrder` substring at the byte level (mirroring our read strategy) is fragile because the surrounding JSON's length-prefix or hash, if any, may not match after the edit. We have not characterized whether the persist blob is checksummed or just raw JSON.
3. Out-of-band risk: a successful write may be silently overwritten by Claude Desktop's next persist cycle.
4. WSL: the LOCK file behavior under `/mnt/c` is already broken for reads; writes are presumed worse.

### Adding new fields to per-session JSON (custom `tags`, `folder`, etc.)

Untested. Specific unknowns:

1. Whether Claude Desktop preserves unknown fields when it re-serializes the JSON on its own write, or strips them.
2. Whether Claude Desktop validates the schema and rejects/quarantines the file if it sees unrecognized keys.
3. Whether the JSON is also mirrored to a server-side store (Claude.ai web), which would either (a) push the unknown field upstream, (b) drop it on sync, or (c) reject the entire write. We do not know whether any mirror exists. See open questions.

### Hiding from the sidebar by mechanism other than `isArchived`

We assume `isArchived: true` removes the session from the default Recents view in Claude Desktop's sidebar, based on the field name. We have not independently verified this in Claude Desktop's UI. There may also be a separate sidebar-visibility flag (`isHidden`, `isDeleted`, etc.) that we have not encountered yet.

### Modifying audit log or outputs

We do not touch `audit.jsonl`, `outputs/`, `uploads/`, `.claude/`, or `.audit-key` under the per-session directory. The `.audit-key` file suggests integrity-signed audit logging, which would mean mutations to `audit.jsonl` are detectable.

### Renaming files vs editing JSON

We have not tested whether renaming `local_<oldUuid>.json` to `local_<newUuid>.json` and rewriting the internal `sessionId` field is treated as the same session by Claude Desktop, a different session, or an error condition.

---

## Section 4 - Things that have broken or behaved unexpectedly

This is the thinnest section. Most of our prior-art is exploratory rather than failure-driven. Known issues:

- LevelDB LOCK file unreadable under WSL: documented in `cowork.rs` lines 360-361. Reading LOCK fails on Linux when WSL bridges the Windows file. We work around it by skipping non-data files (LOCK, LOG, MANIFEST-*, CURRENT) entirely and only scanning `.ldb` / `.log` data files as opaque bytes.
- Some `.ldb` / `.log` files are intermittently locked by Claude Desktop while it is running. We catch and log the IO error, continue with the remaining files, and surface a `pinnedOrderWarning` to the frontend if NO data file in the directory produced a parseable `pinnedOrder`.
- We have not observed Claude Desktop overwriting our `isArchived` writes in the current Microsoft Store build, but the code comment at lines 540-541 documents this as a known theoretical risk.

Claude Desktop version-specific breakages: we do not have a version log of breakages, because we have only observed one Claude Desktop release through this tooling so far (the Microsoft Store build current as of mid-May 2026). Exact build/version string is not captured by our tooling.

---

## Section 5 - Tooling inventory

All paths relative to `/home/camille/projects/prmptr.org`.

| File | Language | Lines | Purpose | State |
|---|---|---|---|---|
| `src-tauri/src/cowork.rs` | Rust | 810 | Core read+write+delete library. Path discovery, JSON parsing, LevelDB byte-scanning, archive mutation, hard delete, viewer window launch. Includes unit tests for the byte parser and an opt-in live integration test gated on `PRMPTR_COWORK_PATH`. | Working. |
| `src-tauri/src/path_safety.rs` | Rust | (small helper) | Path canonicalization and containment check used to confine writes under the resolved cowork root. | Working. |
| `src-tauri/src/lib.rs` | Rust | - | Registers the Tauri command surface. Cowork registrations at lines 93-96. | Working. |
| `src/components/CoworkSessions.tsx` | TypeScript / React | 492 | Main UI for listing Cowork sessions: sortable columns, multi-select, archive/unarchive (bulk and per-row), "show archived" toggle, "starred only" toggle, "open session in new window" action. Honors `pinnedOrder` from the backend for the Pinned section's row order. | Working. |
| `src/components/ClaudeDesktopTab.tsx` | TypeScript / React | 75 | The root-tab shell that mounts the three sub-tabs `"Chat" tab`, `"Cowork" tab`, `"Code" tab`. Defaults to the Cowork sub-tab on first launch. Chat and Code sub-tabs are intentional placeholders ("Coming soon") - they are visual scaffolding, not implemented surfaces. | Cowork sub-tab working; Chat and Code are placeholders. |
| `src/app/cowork-viewer/page.tsx` | TypeScript / React | 96 | Standalone per-session viewer rendered in its own Tauri window (`/cowork-viewer?id=<sessionId>`). Reads the session by re-listing and filtering by ID; falls back to a synthesized body if the session is gone. | Working. |
| `src/components/Library.tsx` | TypeScript / React | - | Unified browser combining Claude Code session logs and Cowork sessions in one list. | Working. |
| `src/lib/tauri-fs.ts` | TypeScript | - | `invoke()` wrappers + type declarations for `CoworkSummary`, `CoworkListing`, `ArchiveOutcome`, `FailedUpdate`. | Working. |
| `tests/e2e/cowork-and-folder.mjs` | Node test runner + Playwright | 316 | End-to-end UI tests against a mocked Tauri layer. Asserts pin-order rendering, archive visibility toggle, per-row click invocation of the viewer-window command, and that no page errors fire during the walkthrough. Mocks `list_cowork_sessions` and captures calls to `set_cowork_archived` and `open_cowork_session_window`. | Working. |

External dependencies introduced for the Cowork code path:

- `serde` / `serde_json` - already pulled in by the rest of the Tauri backend.
- `thiserror` - error enum derive.
- `log` - logging.
- No new crate is dedicated to Cowork. No LevelDB library. No SQLite. No Chromium IPC.

---

## Section 6 - Open questions

1. Does Claude Desktop preserve unknown JSON fields written into `local_<id>.json` across its own writes, or does it strip/quarantine them on next persist? This is the gating question for whether adding a custom `tags` or `folder` field is viable as a hidden-but-tolerated extension point.

2. Does Claude Desktop checksum or hash-validate the Zustand persist blob inside Local Storage LevelDB? If yes, byte-edit-level writes to `pinnedOrder` are not viable and the only durable path is closing Claude Desktop and writing through a real LevelDB client.

3. Are there sibling LevelDB keys we have not enumerated that also affect sidebar state - e.g. `recentOrder`, `archivedSet`, `filterState`, `hiddenSet`? We have only searched for `"pinnedOrder":[`. A broader audit of the persist blob's keyspace would help.

4. Is the `local-agent-mode-sessions` data strictly local, or is some subset mirrored to Claude.ai web? If the latter, two consequences: (a) a server-side schema constrains what fields can survive, and (b) writes done while offline may be reconciled or rolled back on next sync.

5. Does archiving (`isArchived: true`) actually hide the session from Claude Desktop's own sidebar Recents, or is there a separate visibility flag? Our UI hides archived rows by default, but we have not independently confirmed Claude Desktop's behavior.

6. What does the `.audit-key` file represent, and does any Cowork tab mutation we perform break audit-log signing in a way that would prevent the session from being re-opened or replayed? We do not currently parse `audit.jsonl` or `.audit-key`.

7. Is there a sanctioned extension surface coming from Anthropic (plugin API, MCP-style organization hook, etc.) that would obviate this entire approach? Knowing this would prevent investing further in fragile file-edit tooling.

8. Long-term stability of the LevelDB byte-scan for `pinnedOrder` across future Claude Desktop releases: the persist blob format is controlled by Zustand's `persist` middleware and Claude's chosen storage layer. Any change to the wrapping format (encryption, encoding, schema versioning) breaks the byte-scan silently.

9. What is the `<orgId>/<userId>/` nesting convention? Specifically: if a single Windows user is logged into multiple Anthropic accounts in Claude Desktop, do multiple `<userId>` directories appear under a single `<orgId>`, or multiple `<orgId>` directories at the top level? Our walker handles both, but we have only observed the single-account case.

10. Schema fields we have NOT parsed but are likely present in the JSON: anything related to model/system parameters, MCP tools attached, slash command bindings, included files, branch/fork relationships between sessions. A full enumeration of the JSON keys actually present in a representative session would expand the legible surface for any future organization scheme.
