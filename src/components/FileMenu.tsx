"use client";

import { useEffect, useRef, useState } from "react";

type Props = {
  onNew: () => void;
  onOpen: () => void;
  onSave: () => void;
  onSaveAs: () => void;
  onExit: () => void;
  busy: "open" | "save" | null;
  canSave: boolean;
};

const modKey = typeof navigator !== "undefined" && /Mac|iP(hone|ad|od)/.test(navigator.platform) ? "⌘" : "Ctrl";

export function FileMenu({ onNew, onOpen, onSave, onSaveAs, onExit, busy, canSave }: Props) {
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

  const item =
    "flex w-full items-center justify-between gap-6 px-3 py-1.5 text-left text-xs text-[var(--text)] transition hover:bg-[var(--surface-3)] disabled:cursor-not-allowed disabled:opacity-40";

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
        File <span className="text-[var(--text-muted)]">▾</span>
      </button>
      {open && (
        <div
          role="menu"
          className="absolute left-0 top-full z-20 mt-1 min-w-[200px] overflow-hidden rounded-md bg-[var(--surface-2)] py-1 shadow-lg ring-1 ring-[var(--border-strong)]"
        >
          <button
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onNew();
            }}
            className={item}
          >
            <span>New</span>
            <span className="text-[10px] text-[var(--text-muted)]">{modKey}+N</span>
          </button>
          <button
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onOpen();
            }}
            disabled={busy !== null}
            className={item}
          >
            <span>{busy === "open" ? "Opening…" : "Open…"}</span>
            <span className="text-[10px] text-[var(--text-muted)]">{modKey}+O</span>
          </button>
          <button
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onSave();
            }}
            disabled={busy !== null || !canSave}
            className={item}
          >
            <span>{busy === "save" ? "Saving…" : "Save"}</span>
            <span className="text-[10px] text-[var(--text-muted)]">{modKey}+S</span>
          </button>
          <button
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onSaveAs();
            }}
            disabled={busy !== null || !canSave}
            className={item}
          >
            <span>Save As…</span>
            <span className="text-[10px] text-[var(--text-muted)]">{modKey}+Shift+S</span>
          </button>
          <div className="my-1 h-px bg-[var(--border)]" />
          <button
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onExit();
            }}
            className={item}
          >
            <span>Exit</span>
            <span className="text-[10px] text-[var(--text-muted)]">{modKey}+Q</span>
          </button>
        </div>
      )}
    </div>
  );
}
