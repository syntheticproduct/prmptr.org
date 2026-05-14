"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
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

type BridgeAction =
  | "copy-windows-to-wsl"
  | "copy-wsl-to-windows"
  | "symlink-wsl-to-windows";

type BridgeActionResult = {
  status: TargetStatus;
  backupPath: string | null;
};

type PendingAction = {
  rel: string;
  action: BridgeAction;
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

const actionLabel: Record<BridgeAction, string> = {
  "copy-windows-to-wsl": "Copy Windows → WSL",
  "copy-wsl-to-windows": "Copy WSL → Windows",
  "symlink-wsl-to-windows": "Symlink WSL → Windows",
};

const actionBlurb: Record<BridgeAction, string> = {
  "copy-windows-to-wsl":
    "Replace the WSL side with a snapshot of the Windows side. The previous WSL content is moved to a .prmptr-backup-<ms> sibling.",
  "copy-wsl-to-windows":
    "Replace the Windows side with a snapshot of the WSL side. The previous Windows content is moved to a .prmptr-backup-<ms> sibling.",
  "symlink-wsl-to-windows":
    "Replace the WSL path with a Linux symlink to the Windows path so both runtimes share one config. The previous WSL content is moved to a .prmptr-backup-<ms> sibling.",
};

function formatBytes(n: number | null): string {
  if (n == null) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function sideExists(s: SideState): boolean {
  return s.kind !== "missing" && s.kind !== "unknown";
}

function allowedActions(t: TargetStatus, isWsl: boolean): BridgeAction[] {
  if (!isWsl) return [];
  const out: BridgeAction[] = [];
  if (sideExists(t.windows)) out.push("copy-windows-to-wsl");
  if (sideExists(t.wsl)) out.push("copy-wsl-to-windows");
  // Symlink target must exist; the WSL link replaces whatever is there.
  if (sideExists(t.windows)) out.push("symlink-wsl-to-windows");
  return out;
}

export function BridgePane() {
  const [status, setStatus] = useState<BridgeStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [lastBackup, setLastBackup] = useState<string | null>(null);

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

  const runPending = useCallback(async () => {
    if (!pending) return;
    setBusy(true);
    setActionError(null);
    try {
      const result = await invoke<BridgeActionResult>("bridge_action", {
        rel: pending.rel,
        action: pending.action,
      });
      setLastBackup(result.backupPath);
      // Splice the updated row into the existing status so the user sees
      // the new verdict without losing the rest of the list.
      setStatus((prev) =>
        prev
          ? {
              ...prev,
              targets: prev.targets.map((t) =>
                t.rel === result.status.rel ? result.status : t,
              ),
            }
          : prev,
      );
      setPending(null);
    } catch (e) {
      setActionError(formatError(e));
    } finally {
      setBusy(false);
    }
  }, [pending]);

  const pendingTarget = useMemo(() => {
    if (!pending || !status) return null;
    return status.targets.find((t) => t.rel === pending.rel) ?? null;
  }, [pending, status]);

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-4">
      <div className="mx-auto max-w-5xl">
        <header className="mb-4 flex items-baseline justify-between gap-4">
          <div>
            <h2 className="font-mono text-sm font-medium">
              Bridge
              <span className="ml-2 text-[var(--text-muted)]">·</span>
              <span className="ml-2 font-sans text-[11px] text-[var(--text-muted)]">
                Windows ↔ WSL config sync
              </span>
            </h2>
          </div>
          <button
            onClick={() => void load()}
            disabled={refreshing}
            className="rounded-md bg-[var(--surface-2)] px-2.5 py-1 text-[11px] text-[var(--text)] ring-1 ring-[var(--border)] transition hover:bg-[var(--surface-3)] disabled:opacity-50"
          >
            {refreshing ? "Scanning…" : "Refresh"}
          </button>
        </header>

        {error && (
          <div className="mb-3 rounded-lg bg-[var(--surface)] p-3 text-xs text-[var(--danger)] ring-1 ring-[var(--border)]">
            {error}
          </div>
        )}

        {actionError && (
          <div className="mb-3 flex items-start justify-between gap-3 rounded-lg bg-[var(--surface)] p-3 text-xs text-[var(--danger)] ring-1 ring-[var(--border)]">
            <span className="break-words">{actionError}</span>
            <button
              type="button"
              onClick={() => setActionError(null)}
              className="text-[10px] text-[var(--text-muted)] hover:text-[var(--text)]"
            >
              dismiss
            </button>
          </div>
        )}

        {lastBackup && (
          <div className="mb-3 flex items-start justify-between gap-3 rounded-lg bg-[var(--surface)] p-3 text-xs text-[#6ecf9f] ring-1 ring-[var(--border)]">
            <span className="break-all font-mono text-[11px]">
              Previous content backed up to {lastBackup}
            </span>
            <button
              type="button"
              onClick={() => setLastBackup(null)}
              className="text-[10px] text-[var(--text-muted)] hover:text-[var(--text)]"
            >
              dismiss
            </button>
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

            <div className="mb-2 flex items-center justify-between">
              <h3 className="font-mono text-[10px] uppercase tracking-wide text-[var(--text-muted)]">
                Share targets
              </h3>
              <span className="text-[10px] text-[var(--text-muted)]">
                {status.targets.length} entries
              </span>
            </div>

            <div className="space-y-2">
              {status.targets.map((t) => (
                <TargetRow
                  key={t.rel}
                  target={t}
                  isWsl={status.isWsl}
                  busy={busy}
                  onPick={(action) =>
                    setPending({ rel: t.rel, action })
                  }
                />
              ))}
            </div>

            <div className="mt-5 rounded-lg bg-[var(--surface)] p-3 text-[10px] text-[var(--text-muted)] ring-1 ring-[var(--border)]">
              <strong className="text-[var(--text-dim)]">Reconcile</strong>{" "}
              actions run from inside WSL and rename the existing destination
              to a{" "}
              <code className="font-mono text-[var(--text-dim)]">
                .prmptr-backup-&lt;ms&gt;
              </code>{" "}
              sibling before writing. Nothing is deleted. Outside WSL the
              menu is hidden — use{" "}
              <code className="font-mono text-[var(--text-dim)]">ln -s</code>{" "}
              or{" "}
              <code className="font-mono text-[var(--text-dim)]">
                mklink /D
              </code>{" "}
              manually.
            </div>
          </>
        )}

        {!status && !error && (
          <div className="text-xs text-[var(--text-muted)]">Scanning…</div>
        )}
      </div>

      {pending && pendingTarget && (
        <ConfirmDialog
          pending={pending}
          target={pendingTarget}
          busy={busy}
          onConfirm={() => void runPending()}
          onCancel={() => (busy ? undefined : setPending(null))}
        />
      )}
    </div>
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

function TargetRow({
  target,
  isWsl,
  busy,
  onPick,
}: {
  target: TargetStatus;
  isWsl: boolean;
  busy: boolean;
  onPick: (action: BridgeAction) => void;
}) {
  const actions = useMemo(
    () => allowedActions(target, isWsl),
    [target, isWsl],
  );
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
        <div className="flex items-center gap-3">
          <span
            className={`font-mono text-[10px] uppercase tracking-wide ${
              verdictColor[target.verdict]
            }`}
          >
            {verdictLabel[target.verdict]}
          </span>
          {isWsl && (
            <ReconcileMenu
              actions={actions}
              disabled={busy}
              onPick={onPick}
            />
          )}
        </div>
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

function ReconcileMenu({
  actions,
  disabled,
  onPick,
}: {
  actions: BridgeAction[];
  disabled: boolean;
  onPick: (action: BridgeAction) => void;
}) {
  const [open, setOpen] = useState(false);
  if (actions.length === 0) {
    return (
      <span className="text-[10px] text-[var(--text-muted)]">
        nothing to do
      </span>
    );
  }
  return (
    <div className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={disabled}
        className="rounded-md border border-[var(--border)] px-2 py-1 text-[10px] uppercase tracking-wide text-[var(--text-dim)] transition hover:bg-[var(--surface-2)] hover:text-[var(--text)] disabled:cursor-not-allowed disabled:opacity-40"
      >
        Reconcile ▾
      </button>
      {open && (
        <>
          <div
            className="fixed inset-0 z-10"
            onClick={() => setOpen(false)}
          />
          <div className="absolute right-0 z-20 mt-1 w-72 overflow-hidden rounded-md border border-[var(--border)] bg-[var(--surface-2)] shadow-lg ring-1 ring-[var(--border)]">
            {actions.map((a) => (
              <button
                key={a}
                type="button"
                onClick={() => {
                  setOpen(false);
                  onPick(a);
                }}
                className="flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left transition hover:bg-[var(--surface-3)]"
              >
                <span className="font-mono text-[11px] text-[var(--text)]">
                  {actionLabel[a]}
                </span>
                <span className="text-[10px] text-[var(--text-muted)]">
                  {actionBlurb[a]}
                </span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function ConfirmDialog({
  pending,
  target,
  busy,
  onConfirm,
  onCancel,
}: {
  pending: PendingAction;
  target: TargetStatus;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-[var(--bg)]/70">
      <div className="w-[460px] rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 shadow-2xl ring-1 ring-[var(--border)]">
        <div className="mb-2 font-mono text-sm text-[var(--text)]">
          {actionLabel[pending.action]}
        </div>
        <div className="mb-3 text-[11px] text-[var(--text-dim)]">
          {actionBlurb[pending.action]}
        </div>
        <div className="mb-4 rounded-md bg-[var(--surface-2)] p-2 font-mono text-[11px] text-[var(--text)]">
          <div className="mb-1 text-[10px] uppercase tracking-wider text-[var(--text-muted)]">
            {target.label}
          </div>
          <div className="break-all text-[var(--text-dim)]">
            Windows: {target.windows.path ?? "—"}
          </div>
          <div className="break-all text-[var(--text-dim)]">
            WSL: {target.wsl.path ?? "—"}
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="rounded-md px-3 py-1 text-[11px] text-[var(--text-dim)] transition hover:bg-[var(--surface-2)] hover:text-[var(--text)] disabled:opacity-40"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className="rounded-md bg-[var(--accent)] px-3 py-1 text-[11px] font-medium text-[var(--bg)] transition hover:opacity-90 disabled:opacity-40"
          >
            {busy ? "Working…" : "Reconcile"}
          </button>
        </div>
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
