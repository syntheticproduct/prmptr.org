"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  archiveSessions,
  deleteClaudeSession,
  deleteCoworkSession,
  listClaudeSessionsGlobal,
  listCoworkSessions,
  revealInFileManager,
  setCoworkArchived,
  unarchiveSessions,
  type ClaudeSessionSummary,
  type CoworkSummary,
} from "@/lib/tauri-fs";
import { formatError } from "@/lib/errors";

// Unified row shape. The original `raw` object stays on the row for the
// action callbacks that need fields the unified view doesn't expose
// (e.g. opening a Cowork window needs the title).
type LibraryRow =
  | {
      kind: "code";
      key: string;
      id: string;
      title: string;
      whenUnixMs: number | null;
      project: string;
      worktreeLabel: string;
      isCurrentRepo: boolean;
      isArchived: boolean;
      sourcePath: string;
      sizeBytes: number;
      turns: number;
      raw: ClaudeSessionSummary;
    }
  | {
      kind: "cowork";
      key: string;
      id: string;
      title: string;
      whenUnixMs: number | null;
      project: string;
      worktreeLabel: string;
      isCurrentRepo: boolean;
      isArchived: boolean;
      isStarredNative: boolean;
      sourcePath: string;
      raw: CoworkSummary;
    };

type LoadState =
  | { kind: "loading" }
  | { kind: "ok"; rows: LibraryRow[]; mainRepoRoot: string | null }
  | { kind: "err"; message: string };

type SourceFilter = "all" | "code" | "cowork";

const PIN_KEY = "prmptr.library.pins";

function loadPins(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(PIN_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    if (Array.isArray(arr)) return new Set(arr.filter((x) => typeof x === "string"));
    return new Set();
  } catch {
    return new Set();
  }
}

function savePins(pins: Set<string>): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(PIN_KEY, JSON.stringify([...pins]));
  } catch {
    /* quota / private mode — pinning silently no-ops */
  }
}

function fmtWhen(ms: number | null): string {
  if (!ms) return "—";
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fmtAbs(ms: number | null): string {
  if (!ms) return "unknown";
  return new Date(ms).toLocaleString();
}

function lastSeg(p: string, n = 2): string {
  return p.split(/[\\/]/).filter(Boolean).slice(-n).join("/");
}

// Derive the current main repo root path from the Claude Code rows. Any
// row marked isCurrentRepo with the "(main)" worktree label carries the
// canonical path. Used to flag Cowork rows whose cwd sits under that root.
function inferMainRepoRoot(rows: ClaudeSessionSummary[]): string | null {
  const hit = rows.find((r) => r.isCurrentRepo && r.worktree === "(main)");
  if (hit) return hit.projectDecoded.replace(/ \(approx\)$/, "");
  // Fall back to a worktree-style row: strip the `.claude/worktrees/...`
  // tail to recover the repo root.
  const wt = rows.find((r) => r.isCurrentRepo && r.worktree !== "(main)");
  if (!wt) return null;
  const decoded = wt.projectDecoded.replace(/ \(approx\)$/, "");
  const idx = decoded.indexOf("/.claude/worktrees/");
  return idx >= 0 ? decoded.slice(0, idx) : null;
}

function coworkInCurrentRepo(cwd: string | null, mainRepoRoot: string | null): boolean {
  if (!cwd || !mainRepoRoot) return false;
  // Tolerate path separators across platforms; compare prefixes.
  const norm = (s: string) => s.replace(/\\/g, "/").toLowerCase();
  const a = norm(cwd);
  const b = norm(mainRepoRoot);
  return a === b || a.startsWith(b + "/");
}

export function Library() {
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [query, setQuery] = useState("");
  const [source, setSource] = useState<SourceFilter>("all");
  const [thisRepoOnly, setThisRepoOnly] = useState(false);
  const [starredOnly, setStarredOnly] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [pins, setPins] = useState<Set<string>>(() => loadPins());
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [opError, setOpError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(() => {
    setState({ kind: "loading" });
    setOpError(null);
    // Cowork failures are non-fatal — the Library still works even if the
    // Cowork directory can't be located (e.g. user only has Claude Code).
    const codeP = listClaudeSessionsGlobal(true).catch((e) => {
      throw new Error(`Claude Code: ${formatError(e)}`);
    });
    const coworkP = listCoworkSessions()
      .then((l) => l.sessions)
      .catch(() => [] as CoworkSummary[]);

    Promise.all([codeP, coworkP])
      .then(([codeRows, coworkRows]) => {
        const mainRepoRoot = inferMainRepoRoot(codeRows);

        const code: LibraryRow[] = codeRows.map((s) => ({
          kind: "code",
          key: `code:${s.sourcePath}`,
          id: s.id,
          title: s.topic || "(no human prompt)",
          whenUnixMs: s.whenUnixMs || null,
          project: s.projectDecoded,
          worktreeLabel: s.worktree,
          isCurrentRepo: s.isCurrentRepo,
          isArchived: s.archived,
          sourcePath: s.sourcePath,
          sizeBytes: s.sizeBytes,
          turns: s.turns,
          raw: s,
        }));

        const cowork: LibraryRow[] = coworkRows.map((s) => ({
          kind: "cowork",
          key: `cowork:${s.sourcePath}`,
          id: s.sessionId,
          title: s.title || "(untitled)",
          whenUnixMs: s.lastActivityAt,
          project: s.cwd ?? "(unknown)",
          worktreeLabel: s.model ?? "cowork",
          isCurrentRepo: coworkInCurrentRepo(s.cwd, mainRepoRoot),
          isArchived: s.isArchived,
          isStarredNative: s.isStarred,
          sourcePath: s.sourcePath,
          raw: s,
        }));

        const merged = [...code, ...cowork].sort((a, b) => {
          const av = a.whenUnixMs ?? 0;
          const bv = b.whenUnixMs ?? 0;
          return bv - av;
        });
        setState({ kind: "ok", rows: merged, mainRepoRoot });
      })
      .catch((e) => setState({ kind: "err", message: formatError(e) }));
  }, []);

  useEffect(() => {
    refresh();
    const t = setTimeout(() => inputRef.current?.focus(), 50);
    return () => clearTimeout(t);
  }, [refresh]);

  const isPinned = useCallback(
    (row: LibraryRow): boolean => {
      if (pins.has(row.key)) return true;
      if (row.kind === "cowork" && row.isStarredNative) return true;
      return false;
    },
    [pins],
  );

  const togglePin = useCallback((row: LibraryRow) => {
    setPins((prev) => {
      const next = new Set(prev);
      if (next.has(row.key)) next.delete(row.key);
      else next.add(row.key);
      savePins(next);
      return next;
    });
  }, []);

  const filtered = useMemo(() => {
    if (state.kind !== "ok") return [] as LibraryRow[];
    const q = query.trim().toLowerCase();
    return state.rows.filter((r) => {
      if (source !== "all" && r.kind !== source) return false;
      if (thisRepoOnly && !r.isCurrentRepo) return false;
      if (!showArchived && r.isArchived) return false;
      if (starredOnly && !isPinned(r)) return false;
      if (!q) return true;
      const hay = `${r.title}\n${r.project}\n${r.worktreeLabel}\n${r.id}`.toLowerCase();
      return hay.includes(q);
    });
  }, [state, query, source, thisRepoOnly, showArchived, starredOnly, isPinned]);

  const counts = useMemo(() => {
    if (state.kind !== "ok")
      return { total: 0, code: 0, cowork: 0, currentRepo: 0, archived: 0 };
    let code = 0,
      cowork = 0,
      currentRepo = 0,
      archived = 0;
    for (const r of state.rows) {
      if (r.kind === "code") code++;
      else cowork++;
      if (r.isCurrentRepo) currentRepo++;
      if (r.isArchived) archived++;
    }
    return { total: state.rows.length, code, cowork, currentRepo, archived };
  }, [state]);

  // ───── Row actions ─────────────────────────────────────────────────────

  const reopenRow = useCallback(async (row: LibraryRow) => {
    if (row.kind === "cowork") {
      try {
        await invoke("open_cowork_session_window", {
          sessionId: row.id,
          title: row.title,
        });
      } catch (e) {
        setOpError(`open: ${formatError(e)}`);
      }
      return;
    }
    try {
      await revealInFileManager(row.sourcePath);
    } catch (e) {
      setOpError(`reveal: ${formatError(e)}`);
    }
  }, []);

  const archiveRow = useCallback(
    async (row: LibraryRow) => {
      setOpError(null);
      setBusyKey(row.key);
      try {
        if (row.kind === "code") {
          const fn = row.isArchived ? unarchiveSessions : archiveSessions;
          const r = await fn([row.sourcePath]);
          if (r.failed.length > 0) {
            setOpError(r.failed[0]?.reason ?? "unknown failure");
          }
        } else {
          const r = await setCoworkArchived([row.sourcePath], !row.isArchived);
          if (r.failed.length > 0) {
            setOpError(r.failed[0]?.reason ?? "unknown failure");
          }
        }
        refresh();
      } catch (e) {
        setOpError(formatError(e));
      } finally {
        setBusyKey(null);
      }
    },
    [refresh],
  );

  const deleteRow = useCallback(
    async (row: LibraryRow) => {
      const noun = row.kind === "code" ? "Claude Code session" : "Cowork session";
      if (
        !window.confirm(
          `Permanently delete this ${noun}?\n\n${row.title}\n\nThis cannot be undone — the file on disk will be removed.`,
        )
      ) {
        return;
      }
      setOpError(null);
      setBusyKey(row.key);
      try {
        if (row.kind === "code") {
          await deleteClaudeSession(row.sourcePath);
        } else {
          await deleteCoworkSession(row.sourcePath);
        }
        // Drop any local pin so the key doesn't linger forever.
        setPins((prev) => {
          if (!prev.has(row.key)) return prev;
          const next = new Set(prev);
          next.delete(row.key);
          savePins(next);
          return next;
        });
        refresh();
      } catch (e) {
        setOpError(formatError(e));
      } finally {
        setBusyKey(null);
      }
    },
    [refresh],
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-[var(--surface)]">
      <header className="flex flex-shrink-0 items-center justify-between border-b border-[var(--border)] px-4 py-2">
        <div className="flex items-center gap-3">
          <h2 className="font-mono text-sm text-[var(--text)]">Library</h2>
          {state.kind === "ok" && (
            <span className="text-[10px] text-[var(--text-muted)]">
              {filtered.length}/{counts.total} shown · {counts.code} CC ·{" "}
              {counts.cowork} CW · {counts.currentRepo} this repo
              {counts.archived > 0 && <> · {counts.archived} archived</>}
            </span>
          )}
        </div>
        <SourceToggle value={source} onChange={setSource} />
      </header>

      {/* Filter row */}
      <div className="flex flex-wrap items-center gap-2 border-b border-[var(--border)] px-4 py-2">
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search title, project path, worktree, id…"
          className="min-w-[200px] flex-1 rounded-md bg-[var(--bg)] px-3 py-1.5 text-xs text-[var(--text)] outline-none ring-1 ring-transparent placeholder:text-[var(--text-muted)] focus:ring-[var(--accent)]/40"
        />
        <label className="flex items-center gap-1 text-[10px] text-[var(--text-dim)]">
          <input
            type="checkbox"
            checked={thisRepoOnly}
            onChange={(e) => setThisRepoOnly(e.target.checked)}
            className="accent-[var(--accent)]"
          />
          this repo
        </label>
        <label className="flex items-center gap-1 text-[10px] text-[var(--text-dim)]">
          <input
            type="checkbox"
            checked={starredOnly}
            onChange={(e) => setStarredOnly(e.target.checked)}
            className="accent-[var(--accent)]"
          />
          ★ only
        </label>
        <label className="flex items-center gap-1 text-[10px] text-[var(--text-dim)]">
          <input
            type="checkbox"
            checked={showArchived}
            onChange={(e) => setShowArchived(e.target.checked)}
            className="accent-[var(--accent)]"
          />
          show archived
        </label>
      </div>

      {opError && (
        <div className="flex-shrink-0 border-b border-[var(--border)] bg-[var(--danger)]/10 px-4 py-1.5 text-[11px] text-[var(--danger)]">
          {opError}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-auto">
        {state.kind === "loading" && (
          <div className="p-6 text-sm text-[var(--text-muted)]">
            Scanning sessions…
          </div>
        )}
        {state.kind === "err" && (
          <div className="p-6 text-sm text-[var(--danger)]">{state.message}</div>
        )}
        {state.kind === "ok" && filtered.length === 0 && (
          <div className="p-6 text-sm text-[var(--text-muted)]">
            No sessions match.
          </div>
        )}
        {state.kind === "ok" && filtered.length > 0 && (
          <table className="w-full border-collapse font-mono text-[11px]">
            <thead className="sticky top-0 bg-[var(--surface-2)] text-[var(--text-dim)]">
              <tr>
                <th className="w-10 px-2 py-1.5 text-center font-medium">Src</th>
                <th className="w-6 px-1 py-1.5 text-center font-medium">★</th>
                <th className="px-2 py-1.5 text-left font-medium">Title</th>
                <th className="w-32 px-2 py-1.5 text-left font-medium">When</th>
                <th className="px-2 py-1.5 text-left font-medium">Project</th>
                <th className="w-32 px-2 py-1.5 text-left font-medium">Worktree / model</th>
                <th className="w-36 px-2 py-1.5 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((row) => (
                <LibraryRowView
                  key={row.key}
                  row={row}
                  pinned={isPinned(row)}
                  busy={busyKey === row.key}
                  onTogglePin={togglePin}
                  onReopen={reopenRow}
                  onArchive={archiveRow}
                  onDelete={deleteRow}
                />
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function LibraryRowView({
  row,
  pinned,
  busy,
  onTogglePin,
  onReopen,
  onArchive,
  onDelete,
}: {
  row: LibraryRow;
  pinned: boolean;
  busy: boolean;
  onTogglePin: (r: LibraryRow) => void;
  onReopen: (r: LibraryRow) => void;
  onArchive: (r: LibraryRow) => void;
  onDelete: (r: LibraryRow) => void;
}) {
  const srcBadge =
    row.kind === "code" ? (
      <span
        className="rounded-sm bg-[var(--accent)]/15 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wider text-[var(--accent)]"
        title="Claude Code"
      >
        CC
      </span>
    ) : (
      <span
        className="rounded-sm bg-[var(--warning)]/15 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wider text-[var(--warning)]"
        title="Claude Cowork"
      >
        CW
      </span>
    );

  return (
    <tr
      onDoubleClick={() => onReopen(row)}
      className={`border-t border-[var(--border)] text-[var(--text)] hover:bg-[var(--surface-2)] ${
        row.isArchived ? "opacity-60" : ""
      }`}
    >
      <td className="px-2 py-1.5 text-center">{srcBadge}</td>
      <td className="px-1 py-1.5 text-center">
        <button
          onClick={() => onTogglePin(row)}
          className={`text-[12px] leading-none transition ${
            pinned
              ? "text-[var(--warning)]"
              : "text-[var(--text-muted)] hover:text-[var(--text-dim)]"
          }`}
          title={pinned ? "Unpin" : "Pin"}
          aria-label={pinned ? "Unpin" : "Pin"}
        >
          {pinned ? "★" : "☆"}
        </button>
      </td>
      <td className="max-w-0 truncate px-2 py-1.5" title={row.title}>
        {row.title}
        {!row.isCurrentRepo && (
          <span
            className="ml-2 text-[9px] uppercase tracking-wider text-[var(--text-muted)]"
            title="Session is not part of the currently open repo"
          >
            other
          </span>
        )}
      </td>
      <td
        className="whitespace-nowrap px-2 py-1.5 text-[var(--text-dim)]"
        title={fmtAbs(row.whenUnixMs)}
      >
        {fmtWhen(row.whenUnixMs)}
      </td>
      <td
        className="max-w-0 truncate px-2 py-1.5 text-[var(--text-muted)]"
        title={row.project}
      >
        {lastSeg(row.project, 3)}
      </td>
      <td
        className="truncate px-2 py-1.5 text-[var(--text-dim)]"
        title={row.worktreeLabel}
      >
        {row.worktreeLabel}
      </td>
      <td className="whitespace-nowrap px-2 py-1.5 text-right">
        <div className="inline-flex items-center gap-1">
          <RowButton
            label={row.kind === "cowork" ? "Open" : "Reveal"}
            title={
              row.kind === "cowork"
                ? "Open this session in a Cowork window"
                : "Reveal the session JSONL in your file manager"
            }
            onClick={() => onReopen(row)}
          />
          <RowButton
            label={row.isArchived ? "Unarchive" : "Archive"}
            disabled={busy}
            onClick={() => onArchive(row)}
            title={
              row.kind === "cowork"
                ? "Toggle the session's isArchived flag (Claude Desktop may revert this if the session is open)"
                : "Move the JSONL between ~/.claude/projects and ~/.claude/projects-archive"
            }
          />
          <RowButton
            label="Delete"
            disabled={busy}
            danger
            onClick={() => onDelete(row)}
            title="Hard-delete the session files on disk"
          />
        </div>
      </td>
    </tr>
  );
}

function RowButton({
  label,
  onClick,
  disabled,
  danger,
  title,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
  title?: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`rounded px-1.5 py-0.5 text-[10px] transition disabled:cursor-not-allowed disabled:opacity-40 ${
        danger
          ? "text-[var(--text-muted)] hover:bg-[var(--danger)]/15 hover:text-[var(--danger)]"
          : "text-[var(--text-dim)] hover:bg-[var(--surface-3)] hover:text-[var(--text)]"
      }`}
    >
      {label}
    </button>
  );
}

function SourceToggle({
  value,
  onChange,
}: {
  value: SourceFilter;
  onChange: (v: SourceFilter) => void;
}) {
  const opts: { value: SourceFilter; label: string }[] = [
    { value: "all", label: "All" },
    { value: "code", label: "Code" },
    { value: "cowork", label: "Cowork" },
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
