"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { clipboardImageToPath } from "@/lib/tauri-fs";
import { formatError } from "@/lib/errors";

type Status =
  | { kind: "idle" }
  | { kind: "running" }
  | { kind: "ok"; message: string }
  | { kind: "err"; message: string };

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

type Props = {
  onStatus: (s: Status) => void;
  onOpenCowork: () => void;
  onOpenSessionExplorer: () => void;
};

type SubKey = "code" | "cowork";

export function ToolsMenu({ onStatus, onOpenCowork, onOpenSessionExplorer }: Props) {
  const [open, setOpen] = useState(false);
  const [activeSub, setActiveSub] = useState<SubKey | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) {
      setActiveSub(null);
      return;
    }
    const onClick = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const closeAll = () => {
    setOpen(false);
    setActiveSub(null);
  };

  const runClipboardImageToPath = useCallback(async () => {
    closeAll();
    onStatus({ kind: "running" });
    try {
      const r = await clipboardImageToPath();
      onStatus({
        kind: "ok",
        message: `Clipboard → ${r.path} (${r.width}×${r.height}, ${formatBytes(r.bytesWritten)})`,
      });
    } catch (e) {
      onStatus({ kind: "err", message: formatError(e) });
    }
  }, [onStatus]);

  const openGlobalSettings = useCallback(async () => {
    closeAll();
    try {
      await invoke("open_global_settings_window");
    } catch (e) {
      onStatus({ kind: "err", message: formatError(e) });
    }
  }, [onStatus]);

  const parentItem =
    "flex w-full items-center justify-between gap-6 px-3 py-1.5 text-left text-xs transition";
  const submenuItem =
    "flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left transition hover:bg-[var(--surface-3)]";

  return (
    <div ref={rootRef} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className={`rounded-md px-2.5 py-1 text-xs font-medium transition ${
          open
            ? "bg-[var(--surface-2)] text-[var(--text)]"
            : "text-[var(--text-dim)] hover:bg-[var(--surface-2)] hover:text-[var(--text)]"
        }`}
      >
        Tools <span className="text-[var(--text-muted)]">▾</span>
      </button>
      {open && (
        <div
          role="menu"
          className="absolute left-0 top-full z-20 mt-1 min-w-[200px] overflow-visible rounded-md bg-[var(--surface-2)] py-1 shadow-lg ring-1 ring-[var(--border-strong)]"
        >
          {/* Claude Code submenu */}
          <div
            className="relative"
            onMouseEnter={() => setActiveSub("code")}
          >
            <button
              role="menuitem"
              aria-haspopup="menu"
              aria-expanded={activeSub === "code"}
              onClick={() => setActiveSub((s) => (s === "code" ? null : "code"))}
              className={`${parentItem} ${
                activeSub === "code"
                  ? "bg-[var(--surface-3)] text-[var(--text)]"
                  : "text-[var(--text)] hover:bg-[var(--surface-3)]"
              }`}
            >
              <span>Claude Code</span>
              <span className="text-[var(--text-muted)]">▸</span>
            </button>
            {activeSub === "code" && (
              <div
                role="menu"
                className="absolute left-full top-0 z-30 ml-1 min-w-[280px] overflow-hidden rounded-md bg-[var(--surface-2)] py-1 shadow-lg ring-1 ring-[var(--border-strong)]"
              >
                <button
                  role="menuitem"
                  onClick={openGlobalSettings}
                  className={submenuItem}
                >
                  <span className="text-xs text-[var(--text)]">Global Settings</span>
                  <span className="text-[10px] text-[var(--text-muted)]">
                    Open ~/.claude/ tree in a new window
                  </span>
                </button>
                <button
                  role="menuitem"
                  onClick={() => {
                    closeAll();
                    onOpenSessionExplorer();
                  }}
                  className={submenuItem}
                >
                  <span className="text-xs text-[var(--text)]">Session explorer</span>
                  <span className="text-[10px] text-[var(--text-muted)]">
                    Browse Claude Code sessions across this repo's worktrees
                  </span>
                </button>
              </div>
            )}
          </div>

          {/* Claude Cowork submenu */}
          <div
            className="relative"
            onMouseEnter={() => setActiveSub("cowork")}
          >
            <button
              role="menuitem"
              aria-haspopup="menu"
              aria-expanded={activeSub === "cowork"}
              onClick={() => setActiveSub((s) => (s === "cowork" ? null : "cowork"))}
              className={`${parentItem} ${
                activeSub === "cowork"
                  ? "bg-[var(--surface-3)] text-[var(--text)]"
                  : "text-[var(--text)] hover:bg-[var(--surface-3)]"
              }`}
            >
              <span>Claude Cowork</span>
              <span className="text-[var(--text-muted)]">▸</span>
            </button>
            {activeSub === "cowork" && (
              <div
                role="menu"
                className="absolute left-full top-0 z-30 ml-1 min-w-[280px] overflow-hidden rounded-md bg-[var(--surface-2)] py-1 shadow-lg ring-1 ring-[var(--border-strong)]"
              >
                <button
                  role="menuitem"
                  onClick={() => {
                    closeAll();
                    onOpenCowork();
                  }}
                  className={submenuItem}
                >
                  <span className="text-xs text-[var(--text)]">Browse sessions</span>
                  <span className="text-[10px] text-[var(--text-muted)]">
                    List all your Claude Desktop Cowork chats and load a summary
                  </span>
                </button>
                <button
                  role="menuitem"
                  onClick={runClipboardImageToPath}
                  className={submenuItem}
                >
                  <span className="text-xs text-[var(--text)]">Image → file path</span>
                  <span className="text-[10px] text-[var(--text-muted)]">
                    Save clipboard image to temp, replace clipboard with the saved path
                  </span>
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
