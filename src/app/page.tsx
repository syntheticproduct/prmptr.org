"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  isTauri,
  pickFileToOpen,
  pickFileToSave,
  readPromptFile,
  takeInitialPath,
  writePromptFile,
} from "@/lib/tauri-fs";
import { MilkdownEditor } from "@/components/MilkdownEditor";
import { FileMenu } from "@/components/FileMenu";
import { ToolsMenu } from "@/components/ToolsMenu";
import { CoworkSessions } from "@/components/CoworkSessions";
import { SessionExplorer } from "@/components/SessionExplorer";
import { ViewModeToggle, type ViewMode } from "@/components/ViewModeToggle";
import { FolderTreePane } from "@/components/FolderTreePane";
import {
  FrontmatterModeToggle,
  type FrontmatterMode,
} from "@/components/FrontmatterModeToggle";
import { FrontmatterPanel } from "@/components/FrontmatterPanel";
import { joinFrontmatter, parseFrontmatter } from "@/lib/frontmatter";
import type { CoworkSummary } from "@/lib/tauri-fs";
import { formatError } from "@/lib/errors";
import {
  DEV_DEFAULT_FILE,
  DEV_DEFAULT_FOLDER_ROOT,
  DEV_DEFAULT_VIEW_MODE,
} from "@/lib/dev-defaults";

const FRONTMATTER_MODE_KEY = "prmptr.frontmatter.mode";

function loadFrontmatterMode(): FrontmatterMode {
  if (typeof window === "undefined") return "hide";
  const v = window.localStorage.getItem(FRONTMATTER_MODE_KEY);
  if (v === "hide" || v === "code" || v === "properties") return v;
  return "hide";
}

type ToolStatus =
  | { kind: "idle" }
  | { kind: "running" }
  | { kind: "ok"; message: string }
  | { kind: "err"; message: string };

function basename(path: string): string {
  return path.split(/[\\/]/).pop() || path;
}

const toolbarBtn =
  "rounded-md px-2.5 py-1 text-xs font-medium text-[var(--text-dim)] transition hover:bg-[var(--surface-2)] hover:text-[var(--text)] disabled:cursor-not-allowed disabled:opacity-40";

// Shown on launch so the editor never starts empty. Demonstrates headings,
// XML pills (Anthropic-style block tags), inline code, and lists.
const SAMPLE = `# Untitled prompt

This is a sample. Start editing, click **New** for a blank canvas, or **Open** to load a file from your drive.

## Role

<role>
You are an expert at thoughtful, detailed writing.
</role>

## Instructions

<instructions>
1. Be direct.
2. Cite sources when claims are non-obvious.
3. Never invent details.
</instructions>

## Example

<example>
**User:** Summarize this paragraph in one sentence.
**Assistant:** [response]
</example>
`;

export default function Home() {
  const [text, setText] = useState(SAMPLE);
  const [openPath, setOpenPath] = useState<string | null>(null);
  // savedContent === null means truly untitled+empty; if non-null, dirty when
  // text diverges from it. Starting at SAMPLE means the sample is "clean"
  // until the user edits it.
  const [savedContent, setSavedContent] = useState<string | null>(SAMPLE);
  const [tauri, setTauri] = useState(false);
  const [busy, setBusy] = useState<"open" | "save" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [toolStatus, setToolStatus] = useState<ToolStatus>({ kind: "idle" });
  const [coworkOpen, setCoworkOpen] = useState(false);
  const [sessionExplorerOpen, setSessionExplorerOpen] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>(
    DEV_DEFAULT_VIEW_MODE ?? "single",
  );
  const [frontmatterMode, setFrontmatterMode] =
    useState<FrontmatterMode>("hide");

  // Hydrate persisted frontmatter mode after mount to avoid SSR/client mismatch.
  useEffect(() => {
    setFrontmatterMode(loadFrontmatterMode());
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(FRONTMATTER_MODE_KEY, frontmatterMode);
  }, [frontmatterMode]);

  // Split current text into raw frontmatter (preserved verbatim) and body.
  // Body is what the editor sees; reassembly on edit keeps frontmatter intact.
  const { prefix: fmPrefix, frontmatter, body } = useMemo(
    () => parseFrontmatter(text),
    [text],
  );

  // Auto-clear successful tool status after a few seconds.
  useEffect(() => {
    if (toolStatus.kind !== "ok") return;
    const t = setTimeout(() => setToolStatus({ kind: "idle" }), 6000);
    return () => clearTimeout(t);
  }, [toolStatus]);

  // Bumped each time we want to remount the editor with a new initial value
  // (Milkdown is uncontrolled — defaultValueCtx is read once at construction).
  const [editorEpoch, setEditorEpoch] = useState(0);

  useEffect(() => {
    setTauri(isTauri());
  }, []);

  // On startup, consume any file path passed via CLI args (file association,
  // `prmptr.exe foo.md`, etc.) and load it.
  useEffect(() => {
    if (!tauri) return;
    let cancelled = false;
    (async () => {
      try {
        const path = await takeInitialPath();
        if (cancelled) return;
        if (path) {
          await loadFromPath(path);
        } else if (DEV_DEFAULT_FILE) {
          await loadFromPath(DEV_DEFAULT_FILE);
        }
      } catch {
        /* no CLI path or backend not ready — ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tauri]);

  const dirty = savedContent === null
    ? text.length > 0 // truly untitled — any content counts as unsaved
    : text !== savedContent;

  const stats = useMemo(() => {
    const lines = text === "" ? 0 : text.split("\n").length;
    return { chars: text.length, lines };
  }, [text]);

  const confirmDiscard = useCallback(() => {
    if (!dirty) return true;
    return window.confirm("You have unsaved changes. Discard them?");
  }, [dirty]);

  const loadFromPath = useCallback(async (path: string) => {
    setError(null);
    try {
      const file = await readPromptFile(path);
      setText(file.content);
      setOpenPath(file.path);
      setSavedContent(file.content);
      setEditorEpoch((n) => n + 1);
    } catch (e) {
      setError(formatError(e));
    }
  }, []);

  // FolderTreePane bypasses handleOpen, so guard at the call site here.
  // Startup CLI-arg auto-load and File→Open already pass through their own
  // discard checks (or have nothing to discard), so loadFromPath itself
  // stays guard-free.
  const openFromTree = useCallback(
    async (path: string) => {
      if (!confirmDiscard()) return;
      await loadFromPath(path);
    },
    [confirmDiscard, loadFromPath],
  );

  const handleCoworkSelect = useCallback(
    (s: CoworkSummary): boolean => {
      if (!confirmDiscard()) return false;
      const created = s.createdAt ? new Date(s.createdAt).toLocaleString() : "unknown";
      const lastActive = s.lastActivityAt
        ? new Date(s.lastActivityAt).toLocaleString()
        : "unknown";
      const meta = [
        `**Created**: ${created}`,
        `**Last active**: ${lastActive}`,
        s.model ? `**Model**: \`${s.model}\`` : null,
        s.isStarred ? "**★ Starred**" : null,
        s.isArchived ? "**Archived**" : null,
        s.cwd ? `**Working folder**: \`${s.cwd}\`` : null,
        `**Session ID**: \`${s.sessionId}\``,
      ]
        .filter(Boolean)
        .join(" · ");

      const body = `# ${s.title}\n\n${meta}\n\n## Initial prompt\n\n${
        s.initialMessage ?? "_(none recorded)_"
      }\n`;

      setText(body);
      setOpenPath(null);
      setSavedContent(null);
      setError(null);
      setEditorEpoch((n) => n + 1);
      return true;
    },
    [confirmDiscard],
  );

  // HTML5 drag-drop. Tauri's OS-level drag-drop (dragDropEnabled: true) was
  // unreliable on WSLg and tied us to platform-specific behavior — HTML5
  // fires in any webview. Tradeoff: no OS file path, so a dropped file
  // becomes "untitled" until the user Save-As.
  const loadFromDroppedFile = useCallback(
    async (file: File) => {
      if (!confirmDiscard()) return;
      setError(null);
      try {
        const content = await file.text();
        setText(content);
        setOpenPath(null);
        setSavedContent(null);
        setEditorEpoch((n) => n + 1);
      } catch (e) {
        setError(formatError(e));
      }
    },
    [confirmDiscard],
  );

  const handleNew = () => {
    if (!confirmDiscard()) return;
    setText("");
    setOpenPath(null);
    setSavedContent(null);
    setError(null);
    setEditorEpoch((n) => n + 1);
  };

  const handleOpen = async () => {
    if (!confirmDiscard()) return;
    setBusy("open");
    try {
      const path = await pickFileToOpen();
      if (path) await loadFromPath(path);
    } finally {
      setBusy(null);
    }
  };

  const handleSave = async () => {
    setError(null);
    setBusy("save");
    try {
      let target = openPath;
      if (!target) {
        target = await pickFileToSave();
        if (!target) return;
      }
      await writePromptFile(target, text);
      setOpenPath(target);
      setSavedContent(text);
    } catch (e) {
      setError(formatError(e));
    } finally {
      setBusy(null);
    }
  };

  const handleSaveAs = async () => {
    setError(null);
    setBusy("save");
    try {
      const target = await pickFileToSave(openPath ?? undefined);
      if (!target) return;
      await writePromptFile(target, text);
      setOpenPath(target);
      setSavedContent(text);
    } catch (e) {
      setError(formatError(e));
    } finally {
      setBusy(null);
    }
  };

  const handleExit = async () => {
    if (!confirmDiscard()) return;
    try {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      await getCurrentWindow().close();
    } catch (e) {
      setError(formatError(e));
    }
  };

  // Keyboard shortcuts: Cmd/Ctrl+S = save, +Shift = save as, +O = open,
  // +N = new, +Q = exit.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      const key = e.key.toLowerCase();
      if (key === "s" && e.shiftKey) {
        e.preventDefault();
        void handleSaveAs();
      } else if (key === "s") {
        e.preventDefault();
        void handleSave();
      } else if (key === "o") {
        e.preventDefault();
        void handleOpen();
      } else if (key === "n") {
        e.preventDefault();
        handleNew();
      } else if (key === "q") {
        e.preventDefault();
        void handleExit();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openPath, savedContent, text, dirty]);

  return (
    <main className="flex h-dvh flex-col bg-[var(--bg)] text-[var(--text)]">
      <header className="flex flex-shrink-0 items-center justify-between gap-3 border-b border-[var(--border)] px-3 py-2">
        <div className="flex items-center gap-3">
          <span className="font-mono text-sm font-medium tracking-tight">
            prmptr<span className="text-[var(--accent)]">.org</span>
          </span>
          <div className="flex items-center gap-0.5">
            {tauri ? (
              <>
                <FileMenu
                  onNew={handleNew}
                  onOpen={handleOpen}
                  onSave={handleSave}
                  onSaveAs={handleSaveAs}
                  onExit={handleExit}
                  busy={busy}
                  canSave={Boolean(text) || Boolean(openPath)}
                />
                <ToolsMenu
                  onStatus={setToolStatus}
                  onOpenCowork={() => setCoworkOpen(true)}
                  onOpenSessionExplorer={() => setSessionExplorerOpen(true)}
                />
                <ViewModeToggle value={viewMode} onChange={setViewMode} />
                <FrontmatterModeToggle
                  value={frontmatterMode}
                  onChange={setFrontmatterMode}
                />
              </>
            ) : (
              <>
                <button onClick={handleNew} className={toolbarBtn}>
                  New
                </button>
                <span className="px-2 text-[10px] text-[var(--text-muted)]">
                  file ops require desktop app
                </span>
              </>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 text-xs text-[var(--text-muted)]">
          {openPath ? (
            <span className="truncate text-[var(--text-dim)]">{basename(openPath)}</span>
          ) : (
            <span className="text-[var(--text-muted)]">untitled</span>
          )}
          {dirty && <span className="text-[var(--warning)]">●</span>}
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        {viewMode === "folder" && (
          <FolderTreePane
            onOpenFile={openFromTree}
            selectedPath={openPath}
            initialRoot={DEV_DEFAULT_FOLDER_ROOT}
          />
        )}

        {(viewMode === "single" || viewMode === "folder") && (
          <div
            className={`prmptr-editor-host relative min-h-0 flex-1 overflow-y-auto transition ${
              dragActive ? "ring-2 ring-inset ring-[var(--accent)]" : ""
            }`}
            onDragEnter={(e) => {
              e.preventDefault();
              if (e.dataTransfer.types.includes("Files")) setDragActive(true);
            }}
            onDragOver={(e) => {
              e.preventDefault();
              e.dataTransfer.dropEffect = "copy";
              if (e.dataTransfer.types.includes("Files")) setDragActive(true);
            }}
            onDragLeave={(e) => {
              if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
              setDragActive(false);
            }}
            onDrop={(e) => {
              e.preventDefault();
              setDragActive(false);
              const file = e.dataTransfer.files?.[0];
              if (file) void loadFromDroppedFile(file);
            }}
          >
            <FrontmatterPanel mode={frontmatterMode} frontmatter={frontmatter} />
            <MilkdownEditor
              key={editorEpoch}
              defaultValue={body}
              onChange={(newBody) => setText(joinFrontmatter(fmPrefix, newBody))}
            />
            {dragActive && (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-[var(--bg)]/60 text-sm text-[var(--text-dim)]">
                Drop file to open
              </div>
            )}
          </div>
        )}

        {(viewMode === "cowork" || viewMode === "history") && (
          <div className="flex min-h-0 flex-1 items-center justify-center bg-[var(--bg)] text-sm text-[var(--text-muted)]">
            <div className="max-w-md text-center">
              <div className="mb-2 font-mono text-xs uppercase tracking-wider text-[var(--text-faint)]">
                {viewMode} view
              </div>
              <div className="text-[var(--text-dim)]">
                {viewMode === "cowork"
                  ? "Inline Cowork browser — coming soon. For now, use Tools → Browse Cowork sessions."
                  : "History view — coming soon. Recent prompts from ~/.claude/history.jsonl."}
              </div>
            </div>
          </div>
        )}
      </div>

      <footer className="flex flex-shrink-0 items-center justify-between border-t border-[var(--border)] px-3 py-1 text-[10px] text-[var(--text-muted)]">
        <span>
          {stats.chars.toLocaleString()} chars · {stats.lines.toLocaleString()} lines
        </span>
        {toolStatus.kind === "running" ? (
          <span className="truncate text-[var(--text-dim)]">working…</span>
        ) : toolStatus.kind === "ok" ? (
          <span className="truncate text-[var(--success)]">{toolStatus.message}</span>
        ) : toolStatus.kind === "err" ? (
          <span className="truncate text-[var(--danger)]">{toolStatus.message}</span>
        ) : error ? (
          <span className="truncate text-[var(--danger)]">{error}</span>
        ) : openPath ? (
          <span className="truncate">{openPath}</span>
        ) : (
          <span>not saved</span>
        )}
      </footer>

      <CoworkSessions
        open={coworkOpen}
        onClose={() => setCoworkOpen(false)}
        onSelect={handleCoworkSelect}
      />

      <SessionExplorer
        open={sessionExplorerOpen}
        onClose={() => setSessionExplorerOpen(false)}
      />
    </main>
  );
}
