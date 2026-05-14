import { invoke } from "@tauri-apps/api/core";
import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";

export type FileMetadata = {
  sizeBytes: number;
  lineCount: number;
  wordCount: number;
  modifiedUnixMs: number;
};

export type PromptFile = {
  path: string;
  content: string;
  metadata: FileMetadata;
};

export type FileError = {
  kind: "Io" | "SystemTime";
  message: string;
};

const FILTERS = [
  { name: "Markdown / text", extensions: ["md", "markdown", "txt"] },
  { name: "All files", extensions: ["*"] },
];

export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export async function pickFileToOpen(): Promise<string | null> {
  const selected = await openDialog({
    multiple: false,
    directory: false,
    filters: FILTERS,
  });
  return typeof selected === "string" ? selected : null;
}

export async function pickFolderToOpen(): Promise<string | null> {
  const selected = await openDialog({
    multiple: false,
    directory: true,
  });
  return typeof selected === "string" ? selected : null;
}

export type DirChild = {
  name: string;
  path: string;
  isDir: boolean;
  isHidden: boolean;
};

export async function listDir(path: string): Promise<DirChild[]> {
  return invoke<DirChild[]>("list_dir", { path });
}

export async function pickFileToSave(defaultPath?: string): Promise<string | null> {
  const selected = await saveDialog({
    filters: FILTERS,
    defaultPath,
  });
  return selected ?? null;
}

export async function readPromptFile(path: string): Promise<PromptFile> {
  return invoke<PromptFile>("read_prompt_file", { path });
}

export async function writePromptFile(path: string, content: string): Promise<FileMetadata> {
  return invoke<FileMetadata>("write_prompt_file", { path, content });
}

// Consume the file path passed on the command line (one-shot). Returns null
// after first call, or if the app was launched with no file argument.
export async function takeInitialPath(): Promise<string | null> {
  return invoke<string | null>("take_initial_path");
}

export type ClipboardImageResult = {
  path: string;
  width: number;
  height: number;
  bytesWritten: number;
};

export type CoworkSummary = {
  sessionId: string;
  title: string;
  createdAt: number | null;
  lastActivityAt: number | null;
  model: string | null;
  isStarred: boolean;
  isArchived: boolean;
  cwd: string | null;
  initialMessage: string | null;
  sourcePath: string;
};

export type CoworkListing = {
  sessions: CoworkSummary[];
  // Session IDs (`local_<uuid>` form) in the exact top-of-sidebar order
  // Claude Desktop persists. May be a subset of the starred sessions —
  // anything starred but not listed here renders below in the default sort.
  pinnedOrder: string[];
  // If pin order couldn't be read (locked DB, missing dir, schema change),
  // this carries a short explanation; pinnedOrder will be empty.
  pinnedOrderWarning: string | null;
};

// List Cowork-mode session summaries from disk. Throws CoworkError on
// failure to enumerate the sessions themselves; pin-order failures are
// non-fatal and surface via `pinnedOrderWarning`.
export async function listCoworkSessions(): Promise<CoworkListing> {
  return invoke<CoworkListing>("list_cowork_sessions");
}

export type ArchiveOutcome = {
  updated: number;
  failed: { path: string; reason: string }[];
};

// Bulk set isArchived on the given session JSON files. Each path comes from
// CoworkSummary.sourcePath. Doesn't fail-fast — returns per-path outcome.
export async function setCoworkArchived(
  paths: string[],
  archived: boolean,
): Promise<ArchiveOutcome> {
  return invoke<ArchiveOutcome>("set_cowork_archived", { paths, archived });
}

// Read clipboard image, save as PNG in OS temp, replace clipboard with the
// file path as text. Returns metadata on success; throws ClipboardError
// (shape: { kind, message }) on failure including the no-image case.
export async function clipboardImageToPath(): Promise<ClipboardImageResult> {
  return invoke<ClipboardImageResult>("clipboard_image_to_path");
}

export type ClaudeSessionSummary = {
  id: string;
  whenUnixMs: number;
  sizeBytes: number;
  turns: number;
  worktree: string;
  topic: string;
  sourcePath: string;
  archived: boolean;
  source: "active" | "archive";
  projectDecoded: string;
};

// List Claude Code session JSONL files belonging to this project's tree
// (main repo + git worktrees). Sorted newest-first by file mtime. Pass
// includeArchived=true to also scan ~/.claude/projects-archive/ (or the
// path in PRMPTR_CLAUDE_ARCHIVE_PATH).
export async function listClaudeSessions(
  includeArchived: boolean,
): Promise<ClaudeSessionSummary[]> {
  return invoke<ClaudeSessionSummary[]>("list_claude_sessions", {
    includeArchived,
  });
}

export type ArchiveResult = {
  moved: { from: string; to: string }[];
  failed: { path: string; reason: string }[];
};

// Move sessions from active → archive. Returns per-path success/failure;
// never throws on individual moves. Collisions get a unix-timestamp suffix.
export async function archiveSessions(paths: string[]): Promise<ArchiveResult> {
  return invoke<ArchiveResult>("archive_sessions", { paths });
}

// Reverse of archiveSessions — same shape, same fail-soft semantics.
export async function unarchiveSessions(paths: string[]): Promise<ArchiveResult> {
  return invoke<ArchiveResult>("unarchive_sessions", { paths });
}

export type WorktreeCategory = "numbered" | "auto";
export type WorktreeStatus = "clean" | "dirty" | "not-git" | "unknown";
export type WorktreeDeleteMethod =
  | "git-worktree-remove"
  | "git-worktree-remove-force"
  | "filesystem-remove";

export type WorktreeEntry = {
  name: string;
  path: string;
  project: string;
  projectPath: string;
  category: WorktreeCategory;
  status: WorktreeStatus;
  sizeBytes: number;
  sizeCapped: boolean;
  lastActivityMs: number;
  branch: string | null;
  registered: boolean;
};

export type JanitorListing = {
  entries: WorktreeEntry[];
  scanRoots: string[];
  truncated: boolean;
};

// Walks $HOME/projects/*/.claude/worktrees/* (override:
// PRMPTR_JANITOR_SCAN_ROOTS, colon-separated). Numbered worktrees sort
// last; oldest auto-named ones first.
export async function listProjectWorktrees(): Promise<JanitorListing> {
  return invoke<JanitorListing>("list_project_worktrees");
}

export type WorktreeDeleteOutcome = {
  deleted: string;
  method: WorktreeDeleteMethod;
};

// Delete a single worktree. Prefers `git worktree remove`; `force=true`
// is required when there are uncommitted changes. Path must resolve to
// `*/.claude/worktrees/*` — backend rejects anything else.
export async function deleteProjectWorktree(
  path: string,
  force: boolean,
): Promise<WorktreeDeleteOutcome> {
  return invoke<WorktreeDeleteOutcome>("delete_project_worktree", { path, force });
}

export type ClaudeMessageBrief = {
  role: "user" | "assistant";
  text: string;
  timestamp: string | null;
};

// Read the last `maxMessages` visible exchanges (user + assistant text) from
// a session JSONL, in chronological order. Skips tool_use/tool_result/etc.
export async function readClaudeSessionTail(
  path: string,
  maxMessages: number,
): Promise<ClaudeMessageBrief[]> {
  return invoke<ClaudeMessageBrief[]>("read_claude_session_tail", {
    path,
    maxMessages,
  });
}
