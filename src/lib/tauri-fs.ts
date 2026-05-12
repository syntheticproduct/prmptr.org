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

// List Cowork-mode session summaries from disk. Throws CoworkError on
// failure (kind: "NotFound" or "Io").
export async function listCoworkSessions(): Promise<CoworkSummary[]> {
  return invoke<CoworkSummary[]>("list_cowork_sessions");
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
