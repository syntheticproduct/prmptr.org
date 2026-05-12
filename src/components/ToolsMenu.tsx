"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { clipboardImageToPath } from "@/lib/tauri-fs";

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

function formatError(e: unknown): string {
  if (e && typeof e === "object" && "message" in e) {
    return String((e as { message: unknown }).message);
  }
  return String(e);
}

type Props = {
  onStatus: (s: Status) => void;
  onOpenCowork: () => void;
};

export function ToolsMenu({ onStatus, onOpenCowork }: Props) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // Close on outside click or Escape.
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

  const runClipboardImageToPath = useCallback(async () => {
    setOpen(false);
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
          className="absolute left-0 top-full z-20 mt-1 min-w-[280px] overflow-hidden rounded-md bg-[var(--surface-2)] shadow-lg ring-1 ring-[var(--border-strong)]"
        >
          <div className="border-b border-[var(--border)] px-3 py-1.5 text-[10px] font-medium uppercase tracking-wider text-[var(--text-muted)]">
            Clipboard
          </div>
          <button
            role="menuitem"
            onClick={runClipboardImageToPath}
            className="flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left transition hover:bg-[var(--surface-3)]"
          >
            <span className="text-xs text-[var(--text)]">Image → file path</span>
            <span className="text-[10px] text-[var(--text-muted)]">
              Save clipboard image to temp, replace clipboard with the saved path
            </span>
          </button>
          <div className="border-b border-t border-[var(--border)] px-3 py-1.5 text-[10px] font-medium uppercase tracking-wider text-[var(--text-muted)]">
            Claude
          </div>
          <button
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onOpenCowork();
            }}
            className="flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left transition hover:bg-[var(--surface-3)]"
          >
            <span className="text-xs text-[var(--text)]">Browse Cowork sessions</span>
            <span className="text-[10px] text-[var(--text-muted)]">
              List all your Claude Desktop Cowork chats and load a summary
            </span>
          </button>
          <button
            role="menuitem"
            onClick={async () => {
              setOpen(false);
              try {
                await invoke("open_global_settings_window");
              } catch (e) {
                onStatus({
                  kind: "err",
                  message:
                    e && typeof e === "object" && "message" in e
                      ? String((e as { message: unknown }).message)
                      : String(e),
                });
              }
            }}
            className="flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left transition hover:bg-[var(--surface-3)]"
          >
            <span className="text-xs text-[var(--text)]">Global Settings</span>
            <span className="text-[10px] text-[var(--text-muted)]">
              Open ~/.claude/ tree in a new window
            </span>
          </button>
        </div>
      )}
    </div>
  );
}
