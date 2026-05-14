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
};

export function ToolsMenu({ onStatus }: Props) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
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

  const closeAll = () => setOpen(false);

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

  const openBridge = useCallback(async () => {
    closeAll();
    try {
      await invoke("open_bridge_window");
    } catch (e) {
      onStatus({ kind: "err", message: formatError(e) });
    }
  }, [onStatus]);

  const menuItem =
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
          className="absolute left-0 top-full z-20 mt-1 min-w-[280px] overflow-hidden rounded-md bg-[var(--surface-2)] py-1 shadow-lg ring-1 ring-[var(--border-strong)]"
        >
          <button
            role="menuitem"
            onClick={openGlobalSettings}
            className={menuItem}
          >
            <span className="text-xs text-[var(--text)]">Global Settings</span>
            <span className="text-[10px] text-[var(--text-muted)]">
              Open ~/.claude/ tree in a new window
            </span>
          </button>
          <button
            role="menuitem"
            onClick={openBridge}
            className={menuItem}
          >
            <span className="text-xs text-[var(--text)]">Bridge</span>
            <span className="text-[10px] text-[var(--text-muted)]">
              Windows ↔ WSL config sync inspector
            </span>
          </button>
          <button
            role="menuitem"
            onClick={runClipboardImageToPath}
            className={menuItem}
          >
            <span className="text-xs text-[var(--text)]">Image → file path</span>
            <span className="text-[10px] text-[var(--text-muted)]">
              Save clipboard image to temp, replace clipboard with the saved path
            </span>
          </button>
        </div>
      )}
    </div>
  );
}
