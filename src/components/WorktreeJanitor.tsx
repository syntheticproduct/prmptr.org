"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  deleteProjectWorktree,
  listProjectWorktrees,
  type WorktreeEntry,
  type JanitorListing,
} from "@/lib/tauri-fs";
import { formatError } from "@/lib/errors";

type LoadState =
  | { kind: "loading" }
  | { kind: "ok"; listing: JanitorListing }
  | { kind: "err"; message: string };

type Filter = "all" | "auto" | "numbered";

const DAY_MS = 24 * 60 * 60 * 1000;

function fmtAge(lastMs: number): string {
  if (!lastMs) return "—";
  const ageMs = Date.now() - lastMs;
  if (ageMs < 0) return "now";
  const days = Math.floor(ageMs / DAY_MS);
  if (days >= 365) return `${Math.floor(days / 365)}y`;
  if (days >= 30) return `${Math.floor(days / 30)}mo`;
  if (days >= 1) return `${days}d`;
  const hours = Math.floor(ageMs / (60 * 60 * 1000));
  if (hours >= 1) return `${hours}h`;
  const mins = Math.floor(ageMs / (60 * 1000));
  return `${mins}m`;
}

function fmtSize(n: number, capped: boolean): string {
  const tag = capped ? "≥" : "";
  if (n < 1024) return `${tag}${n}B`;
  if (n < 1024 * 1024) return `${tag}${Math.round(n / 1024)}K`;
  if (n < 1024 * 1024 * 1024) return `${tag}${(n / 1024 / 1024).toFixed(1)}M`;
  return `${tag}${(n / 1024 / 1024 / 1024).toFixed(1)}G`;
}

const STATUS_COLOR: Record<WorktreeEntry["status"], string> = {
  clean: "text-[var(--text-muted)]",
  dirty: "text-[var(--warning)]",
  "not-git": "text-[var(--text-muted)]",
  unknown: "text-[var(--text-muted)]",
};

const STATUS_LABEL: Record<WorktreeEntry["status"], string> = {
  clean: "clean",
  dirty: "dirty",
  "not-git": "no .git",
  unknown: "unknown",
};

function FilterToggle({
  value,
  onChange,
}: {
  value: Filter;
  onChange: (v: Filter) => void;
}) {
  const opts: { value: Filter; label: string }[] = [
    { value: "all", label: "All" },
    { value: "auto", label: "Auto-named" },
    { value: "numbered", label: "Numbered" },
  ];
  return (
    <div className="flex overflow-hidden rounded-md ring-1 ring-[var(--border)]">
      {opts.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={`px-2 py-1 text-[11px] transition ${
            value === o.value
              ? "bg-[var(--surface-2)] text-[var(--text)]"
              : "text-[var(--text-dim)] hover:bg-[var(--surface-2)] hover:text-[var(--text)]"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function WorktreeJanitor() {
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [filter, setFilter] = useState<Filter>("auto");
  const [busyPath, setBusyPath] = useState<string | null>(null);
  const [opError, setOpError] = useState<string | null>(null);
  const [opMessage, setOpMessage] = useState<string | null>(null);

  const refresh = useCallback(() => {
    setState({ kind: "loading" });
    listProjectWorktrees()
      .then((listing) => setState({ kind: "ok", listing }))
      .catch((e) => setState({ kind: "err", message: formatError(e) }));
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Auto-clear ephemeral success message after a few seconds.
  useEffect(() => {
    if (!opMessage) return;
    const t = setTimeout(() => setOpMessage(null), 5000);
    return () => clearTimeout(t);
  }, [opMessage]);

  const handleDelete = useCallback(
    async (entry: WorktreeEntry) => {
      const needsForce = entry.status === "dirty";
      const intro = entry.category === "numbered"
        ? `"${entry.name}" is a numbered worktree (intentional parallel workspace). Delete anyway?`
        : needsForce
          ? `Delete ${entry.name}? It has uncommitted changes — they will be lost.`
          : `Delete ${entry.name}?`;
      const confirmMsg = `${intro}\n\nPath: ${entry.path}`;
      if (!window.confirm(confirmMsg)) return;
      setBusyPath(entry.path);
      setOpError(null);
      setOpMessage(null);
      try {
        const result = await deleteProjectWorktree(entry.path, needsForce);
        const via =
          result.method === "git-worktree-remove"
            ? "git worktree remove"
            : result.method === "git-worktree-remove-force"
              ? "git worktree remove --force"
              : "filesystem delete";
        setOpMessage(`Deleted ${entry.name} (${via})`);
        refresh();
      } catch (e) {
        setOpError(formatError(e));
      } finally {
        setBusyPath(null);
      }
    },
    [refresh],
  );

  const entries = state.kind === "ok" ? state.listing.entries : [];

  const visibleEntries = useMemo(() => {
    if (filter === "all") return entries;
    return entries.filter((e) => e.category === filter);
  }, [entries, filter]);

  const totals = useMemo(() => {
    const total = visibleEntries.reduce((acc, e) => acc + e.sizeBytes, 0);
    const anyCapped = visibleEntries.some((e) => e.sizeCapped);
    return { bytes: total, capped: anyCapped, count: visibleEntries.length };
  }, [visibleEntries]);

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-[var(--surface)]">
      <header className="flex flex-shrink-0 items-center justify-between border-b border-[var(--border)] px-4 py-2">
        <h2 className="font-mono text-sm text-[var(--text)]">
          Worktree janitor
          {state.kind === "ok" && (
            <span className="ml-2 text-xs text-[var(--text-muted)]">
              {visibleEntries.length} of {entries.length} ·{" "}
              {fmtSize(totals.bytes, totals.capped)} total
            </span>
          )}
        </h2>
        <div className="flex items-center gap-3">
          <FilterToggle value={filter} onChange={setFilter} />
          <button
            onClick={refresh}
            className="rounded px-2 py-0.5 text-[10px] text-[var(--text-dim)] transition hover:bg-[var(--surface-2)] hover:text-[var(--text)]"
            title="Re-scan"
          >
            Refresh
          </button>
        </div>
      </header>

      {opMessage && (
        <div className="flex-shrink-0 border-b border-[var(--border)] bg-[var(--success)]/10 px-4 py-1.5 text-[11px] text-[var(--success)]">
          {opMessage}
        </div>
      )}
      {opError && (
        <div className="flex-shrink-0 border-b border-[var(--border)] bg-[var(--danger)]/10 px-4 py-1.5 text-[11px] text-[var(--danger)]">
          {opError}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-auto">
        {state.kind === "loading" && (
          <div className="p-6 text-sm text-[var(--text-muted)]">Scanning…</div>
        )}
        {state.kind === "err" && (
          <div className="p-6 text-sm text-[var(--danger)]">{state.message}</div>
        )}
        {state.kind === "ok" && (
          <>
            {state.listing.truncated && (
              <div className="border-b border-[var(--border)] bg-[var(--warning)]/10 px-4 py-1.5 text-[11px] text-[var(--warning)]">
                Scan hit the time budget — re-run for a complete listing.
              </div>
            )}
            {visibleEntries.length === 0 ? (
              <div className="p-6 text-sm text-[var(--text-muted)]">
                {entries.length === 0
                  ? `No worktrees found under ${state.listing.scanRoots.join(", ") || "$HOME/projects/"}. Set PRMPTR_JANITOR_SCAN_ROOTS to add more.`
                  : `No worktrees match the "${filter}" filter.`}
              </div>
            ) : (
              <table className="w-full border-collapse font-mono text-[11px]">
                <thead className="sticky top-0 bg-[var(--surface-2)] text-[var(--text-dim)]">
                  <tr>
                    <th className="px-3 py-1.5 text-left font-medium">Project</th>
                    <th className="px-3 py-1.5 text-left font-medium">Name</th>
                    <th className="px-3 py-1.5 text-left font-medium">Branch</th>
                    <th className="px-3 py-1.5 text-left font-medium">Status</th>
                    <th className="px-3 py-1.5 text-right font-medium">Last activity</th>
                    <th className="px-3 py-1.5 text-right font-medium">Size</th>
                    <th className="px-3 py-1.5 text-right font-medium"></th>
                  </tr>
                </thead>
                <tbody>
                  {visibleEntries.map((e) => {
                    const numbered = e.category === "numbered";
                    return (
                      <tr
                        key={e.path}
                        className={`border-t border-[var(--border)] text-[var(--text)] ${
                          numbered ? "opacity-70" : ""
                        }`}
                        title={e.path}
                      >
                        <td className="whitespace-nowrap px-3 py-1.5 text-[var(--text-dim)]">
                          {e.project}
                        </td>
                        <td className="whitespace-nowrap px-3 py-1.5">
                          <span className={numbered ? "text-[var(--text-muted)]" : "text-[var(--accent)]"}>
                            {e.name}
                          </span>
                          {numbered && (
                            <span
                              className="ml-2 text-[10px] uppercase tracking-wider text-[var(--text-muted)]"
                              title="Numbered worktrees are intentional parallel workspaces"
                            >
                              ★ numbered
                            </span>
                          )}
                        </td>
                        <td className="whitespace-nowrap px-3 py-1.5 text-[var(--text-dim)]">
                          {e.branch ?? (
                            <span className="text-[var(--text-muted)]">—</span>
                          )}
                        </td>
                        <td className={`whitespace-nowrap px-3 py-1.5 ${STATUS_COLOR[e.status]}`}>
                          {STATUS_LABEL[e.status]}
                          {!e.registered && e.status !== "not-git" && (
                            <span
                              className="ml-1 text-[10px] text-[var(--warning)]"
                              title="Parent repo does not register this worktree — only filesystem delete is possible"
                            >
                              ⚠ orphaned
                            </span>
                          )}
                        </td>
                        <td className="whitespace-nowrap px-3 py-1.5 text-right text-[var(--text-dim)]">
                          {fmtAge(e.lastActivityMs)}
                        </td>
                        <td className="whitespace-nowrap px-3 py-1.5 text-right text-[var(--text-dim)]">
                          {fmtSize(e.sizeBytes, e.sizeCapped)}
                        </td>
                        <td className="whitespace-nowrap px-3 py-1.5 text-right">
                          <button
                            disabled={busyPath === e.path}
                            onClick={() => handleDelete(e)}
                            className="rounded px-2 py-0.5 text-[10px] text-[var(--text-dim)] transition hover:bg-[var(--danger)]/20 hover:text-[var(--danger)] disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            {busyPath === e.path ? "…" : "Delete"}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
            <div className="px-4 py-2 text-[10px] text-[var(--text-muted)]">
              Scanned: {state.listing.scanRoots.join(", ")}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
