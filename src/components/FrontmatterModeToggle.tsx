"use client";

import { useEffect, useRef, useState } from "react";

export type FrontmatterMode = "hide" | "code" | "properties";

const OPTIONS: { value: FrontmatterMode; label: string; hint: string }[] = [
  {
    value: "hide",
    label: "Hide frontmatter",
    hint: "Strip YAML from view, preserve on save",
  },
  {
    value: "code",
    label: "Code block",
    hint: "Show raw YAML in a monospace block above the editor",
  },
  {
    value: "properties",
    label: "Properties panel",
    hint: "Render YAML keys as a labeled key/value strip",
  },
];

type Props = {
  value: FrontmatterMode;
  onChange: (v: FrontmatterMode) => void;
};

export function FrontmatterModeToggle({ value, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const current = OPTIONS.find((o) => o.value === value) ?? OPTIONS[0];

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

  return (
    <div ref={rootRef} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        title="How to display YAML frontmatter in .md files"
        className={`rounded-md px-2.5 py-1 text-xs font-medium transition ${
          open
            ? "bg-[var(--surface-2)] text-[var(--text)]"
            : "text-[var(--text-dim)] hover:bg-[var(--surface-2)] hover:text-[var(--text)]"
        }`}
      >
        {current.label} <span className="text-[var(--text-muted)]">▾</span>
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-20 mt-1 min-w-[260px] overflow-hidden rounded-md bg-[var(--surface-2)] shadow-lg ring-1 ring-[var(--border-strong)]"
        >
          {OPTIONS.map((opt) => {
            const active = opt.value === value;
            return (
              <button
                key={opt.value}
                role="menuitemradio"
                aria-checked={active}
                onClick={() => {
                  onChange(opt.value);
                  setOpen(false);
                }}
                className={`flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left transition hover:bg-[var(--surface-3)] ${
                  active ? "bg-[var(--surface-3)]" : ""
                }`}
              >
                <span className="flex w-full items-center justify-between text-xs text-[var(--text)]">
                  {opt.label}
                  {active && <span className="text-[var(--accent)]">●</span>}
                </span>
                <span className="text-[10px] text-[var(--text-dim)]">
                  {opt.hint}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
