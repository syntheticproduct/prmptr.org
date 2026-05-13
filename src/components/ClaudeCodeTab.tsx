"use client";

import { useState } from "react";
import { SessionExplorer } from "@/components/SessionExplorer";

type Sub = "sessions";

const SUBS: { value: Sub; label: string }[] = [
  { value: "sessions", label: "Session explorer" },
];

export function ClaudeCodeTab() {
  const [sub, setSub] = useState<Sub>("sessions");
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
      {sub === "sessions" && <SessionExplorer />}
    </div>
  );
}
