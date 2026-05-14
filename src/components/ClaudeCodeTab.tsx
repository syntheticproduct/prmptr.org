"use client";

import { useEffect, useState } from "react";
import { SessionExplorer } from "@/components/SessionExplorer";
import { WorktreeJanitor } from "@/components/WorktreeJanitor";
import { BridgePane } from "@/components/BridgePane";
import { Library } from "@/components/Library";

type Sub = "library" | "sessions" | "janitor" | "bridge";

const SUBS: { value: Sub; label: string }[] = [
  { value: "library", label: "Library" },
  { value: "sessions", label: "Session explorer" },
  { value: "janitor", label: "Worktree janitor" },
  { value: "bridge", label: "Bridge" },
];

const SUB_KEY = "prmptr.claudeCodeSub";

function loadSub(): Sub {
  if (typeof window === "undefined") return "library";
  const v = window.localStorage.getItem(SUB_KEY);
  if (v === "library" || v === "sessions" || v === "janitor" || v === "bridge")
    return v;
  return "library";
}

export function ClaudeCodeTab() {
  const [sub, setSub] = useState<Sub>("library");

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
      {sub === "library" && <Library />}
      {sub === "sessions" && <SessionExplorer />}
      {sub === "janitor" && <WorktreeJanitor />}
      {sub === "bridge" && <BridgePane />}
    </div>
  );
}
