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

function basename(path: string): string {
  return path.split(/[\\/]/).pop() || path;
}

function formatError(e: unknown): string {
  if (e && typeof e === "object" && "message" in e) {
    return String((e as { message: unknown }).message);
  }
  return String(e);
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
        if (!cancelled && path) await loadFromPath(path);
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

  // Keyboard shortcuts: Cmd/Ctrl+S = save, Cmd/Ctrl+O = open, Cmd/Ctrl+N = new
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      if (e.key === "s") {
        e.preventDefault();
        void handleSave();
      } else if (e.key === "o") {
        e.preventDefault();
        void handleOpen();
      } else if (e.key === "n") {
        e.preventDefault();
        handleNew();
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
            <button onClick={handleNew} className={toolbarBtn}>
              New
            </button>
            {tauri ? (
              <>
                <button
                  onClick={handleOpen}
                  disabled={busy !== null}
                  className={toolbarBtn}
                >
                  {busy === "open" ? "…" : "Open"}
                </button>
                <button
                  onClick={handleSave}
                  disabled={busy !== null || (!text && !openPath)}
                  className={toolbarBtn}
                >
                  {busy === "save" ? "…" : "Save"}
                </button>
              </>
            ) : (
              <span className="px-2 text-[10px] text-[var(--text-muted)]">
                file ops require desktop app
              </span>
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
          // Only clear when leaving the host, not when crossing child boundaries
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
        <MilkdownEditor
          key={editorEpoch}
          defaultValue={text}
          onChange={setText}
        />
        {dragActive && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-[var(--bg)]/60 text-sm text-[var(--text-dim)]">
            Drop file to open
          </div>
        )}
      </div>

      <footer className="flex flex-shrink-0 items-center justify-between border-t border-[var(--border)] px-3 py-1 text-[10px] text-[var(--text-muted)]">
        <span>
          {stats.chars.toLocaleString()} chars · {stats.lines.toLocaleString()} lines
        </span>
        {error ? (
          <span className="truncate text-[var(--danger)]">{error}</span>
        ) : openPath ? (
          <span className="truncate">{openPath}</span>
        ) : (
          <span>not saved</span>
        )}
      </footer>
    </main>
  );
}
