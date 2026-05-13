"use client";

import { useState } from "react";

type Sub = "analyze" | "graph" | "punchup";

const SUBS: { value: Sub; label: string; hint: string }[] = [
  {
    value: "analyze",
    label: "Analyze",
    hint: "Token counts, role/section coverage, variable usage",
  },
  {
    value: "graph",
    label: "Graph",
    hint: "Section relationships and prompt structure",
  },
  {
    value: "punchup",
    label: "Punchup",
    hint: "Tighten language, surface ambiguity, suggest rewrites",
  },
];

export function AnalysisPane() {
  const [sub, setSub] = useState<Sub>("analyze");
  const current = SUBS.find((s) => s.value === sub)!;
  return (
    <aside
      aria-label="Prompt analysis"
      className="flex h-full w-[348px] flex-shrink-0 flex-col border-l border-[var(--border)] bg-[var(--surface)]"
    >
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
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
        <div className="font-mono text-[10px] uppercase tracking-wider text-[var(--text-faint)]">
          {current.label} — coming soon
        </div>
        <div className="text-xs text-[var(--text-dim)]">{current.hint}</div>
      </div>
    </aside>
  );
}
