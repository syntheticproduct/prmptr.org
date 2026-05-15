"use client";

import { useEffect, useState } from "react";
import { CoworkSessions } from "@/components/CoworkSessions";

type Sub = "chat" | "cowork" | "code";

// Literal labels include the surrounding quotes and the trailing " tab"
// at the user's request — they're meta-referential, not typo-like.
const SUBS: { value: Sub; label: string }[] = [
  { value: "chat", label: `"Chat" tab` },
  { value: "cowork", label: `"Cowork" tab` },
  { value: "code", label: `"Code" tab` },
];

const SUB_KEY = "prmptr.claudeDesktopSub";

function loadSub(): Sub {
  if (typeof window === "undefined") return "cowork";
  const v = window.localStorage.getItem(SUB_KEY);
  if (v === "chat" || v === "cowork" || v === "code") return v;
  // Default to cowork — the one with real content. Empty placeholders
  // would surprise existing users who land on this root tab.
  return "cowork";
}

function Placeholder({ label }: { label: string }) {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center bg-[var(--surface)] p-6 text-center">
      <div className="max-w-md">
        <h2 className="font-mono text-sm text-[var(--text-dim)]">{label}</h2>
        <p className="mt-2 text-xs text-[var(--text-muted)]">Coming soon.</p>
      </div>
    </div>
  );
}

export function ClaudeDesktopTab() {
  const [sub, setSub] = useState<Sub>("cowork");

  useEffect(() => {
    setSub(loadSub());
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(SUB_KEY, sub);
  }, [sub]);

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-[var(--bg)]">
      <div className="flex flex-shrink-0 items-center gap-0.5 border-b border-[var(--border)] px-2 py-1.5">
        {SUBS.map((s) => {
          const active = s.value === sub;
          return (
            <button
              key={s.value}
              onClick={() => setSub(s.value)}
              className={`rounded-md px-2.5 py-1 text-[11px] font-medium transition ${
                active
                  ? "bg-[var(--surface-2)] text-[var(--text)]"
                  : "text-[var(--text-dim)] hover:bg-[var(--surface-2)] hover:text-[var(--text)]"
              }`}
            >
              {s.label}
            </button>
          );
        })}
      </div>
      {sub === "chat" && <Placeholder label={`"Chat" tab`} />}
      {sub === "cowork" && <CoworkSessions />}
      {sub === "code" && <Placeholder label={`"Code" tab`} />}
    </div>
  );
}
