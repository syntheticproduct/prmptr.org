"use client";

import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { formatError } from "@/lib/errors";

type SideKind = "missing" | "file" | "dir" | "symlink" | "other" | "unknown";

type SideState = {
  path: string | null;
  kind: SideKind;
  hash: string | null;
  symlinkTarget: string | null;
  sizeBytes: number | null;
};

type Verdict =
  | "in-sync"
  | "drift"
  | "wsl-only"
  | "windows-only"
  | "both-missing"
  | "unknown";

type TargetCategory = "agents" | "memory" | "settings" | "mcp";

type TargetStatus = {
  label: string;
  rel: string;
  category: TargetCategory;
  isDir: boolean;
  note: string;
  wsl: SideState;
  windows: SideState;
  verdict: Verdict;
};

type BridgeStatus = {
  wslRoot: string | null;
  windowsRoot: string | null;
  isWsl: boolean;
  targets: TargetStatus[];
};

const verdictColor: Record<Verdict, string> = {
  "in-sync": "text-[#6ecf9f]",
  drift: "text-[#e8a26a]",
  "wsl-only": "text-[#6ea3cf]",
  "windows-only": "text-[#6ea3cf]",
  "both-missing": "text-[var(--text-muted)]",
  unknown: "text-[var(--text-muted)]",
};

const verdictLabel: Record<Verdict, string> = {
  "in-sync": "in sync",
  drift: "drift",
  "wsl-only": "WSL only",
  "windows-only": "Windows only",
  "both-missing": "both missing",
  unknown: "—",
};

const categoryLabel: Record<TargetCategory, string> = {
  agents: "Agents",
  memory: "Memory",
  settings: "Settings",
  mcp: "MCP",
};

function formatBytes(n: number | null): string {
  if (n == null) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export default function BridgePage() {
  const [status, setStatus] = useState<BridgeStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setRefreshing(true);
    setError(null);
    try {
      const data = await invoke<BridgeStatus>("bridge_status");
      setStatus(data);
    } catch (e) {
      setError(formatError(e));
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <main className="min-h-dvh bg-[var(--bg)] p-6 text-[var(--text)]">
      <div className="mx-auto max-w-5xl">
        <header className="mb-5 flex items-baseline justify-between gap-4">
          <div>
            <h1 className="font-mono text-lg font-medium">
              Bridge
              <span className="ml-2 text-[var(--text-muted)]">·</span>
              <span className="ml-2 font-sans text-xs text-[var(--text-muted)]">
                Windows ↔ WSL config sync
              </span>
            </h1>
          </div>
          <button
            onClick={() => void load()}
            disabled={refreshing}
            className="rounded-md bg-[var(--surface-2)] px-3 py-1 text-xs text-[var(--text)] ring-1 ring-[var(--border)] transition hover:bg-[var(--surface-3)] disabled:opacity-50"
          >
            {refreshing ? "Scanning…" : "Refresh"}
          </button>
        </header>

        {error && (
          <div className="mb-4 rounded-lg bg-[var(--surface)] p-4 text-sm text-[var(--danger)] ring-1 ring-[var(--border)]">
            {error}
          </div>
        )}

        {status && (
          <>
            <div className="mb-4 grid grid-cols-2 gap-3">
              <RootCard label="WSL" path={status.wslRoot} />
              <RootCard
                label={status.isWsl ? "Windows (auto-detected)" : "Windows"}
                path={status.windowsRoot}
                hint={
                  !status.isWsl
                    ? "Not running under WSL — Windows side detection skipped."
                    : undefined
                }
              />
            </div>

            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-mono text-xs uppercase tracking-wide text-[var(--text-muted)]">
                Share targets
              </h2>
              <span className="text-[10px] text-[var(--text-muted)]">
                {status.targets.length} entries
              </span>
            </div>

            <div className="space-y-2">
              {status.targets.map((t) => (
                <TargetRow key={t.rel} target={t} />
              ))}
            </div>

            <div className="mt-6 rounded-lg bg-[var(--surface)] p-4 text-[11px] text-[var(--text-muted)] ring-1 ring-[var(--border)]">
              <strong className="text-[var(--text-dim)]">Reconcile</strong>{" "}
              (one-click symlink) is coming next. For now this view is
              read-only — surface drift, then handle it manually with{" "}
              <code className="font-mono text-[var(--text-dim)]">ln -s</code>{" "}
              or{" "}
              <code className="font-mono text-[var(--text-dim)]">
                mklink /D
              </code>
              .
            </div>
          </>
        )}

        {!status && !error && (
          <div className="text-xs text-[var(--text-muted)]">Scanning…</div>
        )}
      </div>
    </main>
  );
}

function RootCard({
  label,
  path,
  hint,
}: {
  label: string;
  path: string | null;
  hint?: string;
}) {
  return (
    <div className="rounded-lg bg-[var(--surface)] p-3 ring-1 ring-[var(--border)]">
      <div className="text-[10px] uppercase tracking-wide text-[var(--text-muted)]">
        {label}
      </div>
      <div className="mt-1 truncate font-mono text-xs text-[var(--text)]">
        {path ?? "—"}
      </div>
      {hint && (
        <div className="mt-1 text-[10px] text-[var(--text-muted)]">{hint}</div>
      )}
    </div>
  );
}

function TargetRow({ target }: { target: TargetStatus }) {
  return (
    <div className="rounded-lg bg-[var(--surface)] p-3 ring-1 ring-[var(--border)]">
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <div className="flex items-baseline gap-2">
          <span className="font-mono text-sm text-[var(--text)]">
            {target.label}
          </span>
          <span className="rounded bg-[var(--surface-3)] px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-[var(--text-muted)]">
            {categoryLabel[target.category]}
          </span>
        </div>
        <span
          className={`font-mono text-[10px] uppercase tracking-wide ${
            verdictColor[target.verdict]
          }`}
        >
          {verdictLabel[target.verdict]}
        </span>
      </div>
      <div className="mb-2 text-[10px] text-[var(--text-muted)]">
        {target.note}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <SidePane label="WSL" side={target.wsl} />
        <SidePane label="Windows" side={target.windows} />
      </div>
    </div>
  );
}

function SidePane({ label, side }: { label: string; side: SideState }) {
  const isPresent = side.kind !== "missing" && side.kind !== "unknown";
  return (
    <div className="rounded bg-[var(--surface-2)] p-2">
      <div className="flex items-center justify-between">
        <span className="text-[9px] uppercase tracking-wide text-[var(--text-muted)]">
          {label}
        </span>
        <span
          className={`text-[10px] ${
            isPresent ? "text-[var(--text-dim)]" : "text-[var(--text-muted)]"
          }`}
        >
          {side.kind}
        </span>
      </div>
      <div
        className="mt-1 truncate font-mono text-[10px] text-[var(--text-dim)]"
        title={side.path ?? ""}
      >
        {side.path ?? "—"}
      </div>
      {side.kind === "symlink" && side.symlinkTarget && (
        <div
          className="mt-1 truncate font-mono text-[10px] text-[var(--accent)]"
          title={side.symlinkTarget}
        >
          → {side.symlinkTarget}
        </div>
      )}
      {side.kind === "file" && (
        <div className="mt-1 font-mono text-[10px] text-[var(--text-muted)]">
          {formatBytes(side.sizeBytes)}
          {side.hash && (
            <span className="ml-2 opacity-70">
              {side.hash.slice(0, 8)}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
